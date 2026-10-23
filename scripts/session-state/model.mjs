import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { entryRules, hash, timestamp, validateState, validateTask } from "./schema.mjs";

export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const encode = (value) => JSON.stringify(value, null, 2) + "\n";
export function createState(task, now = new Date().toISOString()) {
  validateTask(task);
  return validateState({ schemaVersion: 1, revision: 0, updatedAt: now, task,
    progress: "in-progress", pr: null, checks: [], reviews: [], retries: [],
    attestations: [], evidence: [], sessions: [] });
}

export function documentSnapshot(state, documentId, root) {
  const doc = state.task.documents.find((item) => item.id === documentId);
  if (!doc) throw new Error("Unknown document ID");
  const bytes = fs.readFileSync(path.resolve(root, doc.path));
  return { id: doc.id, sha256: digest(bytes), content: bytes.toString("utf8") };
}

function sessionFor(state, id) {
  const session = state.sessions.find((item) => item.id === id);
  if (!session) throw new Error("Start this session before recording reads or heartbeats");
  return session;
}

function operational(state) {
  const { progress, pr, checks, reviews, retries, attestations, evidence } = state;
  return { progress, pr, checks, reviews, retries, attestations, evidence };
}

export function heartbeat(state, sessionId, root, now = new Date().toISOString()) {
  const session = sessionFor(state, sessionId);
  const documents = [];
  for (const doc of state.task.documents) {
    const prior = session.reads.find((item) => item.documentId === doc.id);
    try {
      const { sha256 } = documentSnapshot(state, doc.id, root);
      if (prior?.sha256 !== sha256) documents.push({ id: doc.id, path: doc.path, sha256, reason: prior ? "changed" : "unread" });
    } catch (error) {
      documents.push({ id: doc.id, path: doc.path, reason: "unavailable", error: error.message });
    }
  }
  const current = operational(state);
  const previous = session.checkpoint === null ? null : JSON.parse(session.checkpoint);
  const delta = Object.fromEntries(Object.entries(current).filter(([key, value]) => !previous || JSON.stringify(previous[key]) !== JSON.stringify(value)));
  return { documents, delta, contextReady: documents.length === 0,
    retryActions: documents.length === 0 ? retryActions(state, now) : [], checkpoint: JSON.stringify(current) };
}

export function retryActions(state, now) {
  if (state.pr?.state !== "open" || state.progress === "done") return [];
  return state.retries.filter((item) => item.status === "scheduled" && item.used === 0
    && Date.parse(item.notBefore) <= Date.parse(now)
    && state.reviews.some((review) => review.id === item.reviewId && review.head === state.pr.head && review.status === "rate-limited"))
    .map((item) => ({ reviewId: item.reviewId, action: "reserve-before-external-request", notBefore: item.notBefore }));
}

export function completionGaps(state) {
  const gaps = [];
  if (state.pr?.state !== "merged" || !state.pr.mergeCommit) gaps.push("owner-merge");
  for (const [kind, ids] of Object.entries(state.task.requirements)) {
    for (const id of ids) {
      const item = state[kind].find((entry) => entry.id === id && entry.head === state.pr?.head);
      const passed = item && (kind === "evidence" || (kind === "attestations" ? item.result === "pass" : item.status === "pass"));
      if (!passed) gaps.push(`${kind}:${id}`);
    }
  }
  return gaps;
}

function keys(event, expected) {
  if (Object.keys(event).sort().join() !== ["type", ...expected].sort().join()) throw new Error("Unexpected or missing event fields");
}

function upsert(items, value, key = "id") {
  const index = items.findIndex((item) => item[key] === value[key]);
  if (index === -1) items.push(value);
  else items[index] = value;
}

export function transition(input, event, { root, now = new Date().toISOString() } = {}) {
  validateState(input);
  if (!timestamp(now)) throw new Error("Expected a UTC timestamp");
  const state = structuredClone(input);
  if (state.progress === "done") throw new Error("Completed state is immutable; create a separate task for new work");
  switch (event.type) {
    case "start-session": {
      keys(event, ["sessionId"]);
      if (state.sessions.some((item) => item.id === event.sessionId)) throw new Error("Session already exists; resume with its ID");
      state.sessions.push({ id: event.sessionId, startedAt: now, reads: [], checkpoint: null });
      break;
    }
    case "ack-read": {
      keys(event, ["sessionId", "documentId", "sha256"]);
      const session = sessionFor(state, event.sessionId);
      const current = documentSnapshot(state, event.documentId, root);
      if (!hash(event.sha256) || current.sha256 !== event.sha256) throw new Error("Document changed since reading; read it again before acknowledging");
      upsert(session.reads, { documentId: event.documentId, sha256: current.sha256, readAt: now }, "documentId");
      break;
    }
    case "heartbeat": {
      keys(event, ["sessionId"]);
      sessionFor(state, event.sessionId).checkpoint = heartbeat(state, event.sessionId, root, now).checkpoint;
      break;
    }
    case "observe-pr": {
      keys(event, ["pr"]);
      const prior = state.pr;
      state.pr = event.pr;
      validateState(state);
      if (Date.parse(event.pr.observedAt) > Date.parse(now)) throw new Error("Future PR observation");
      if (prior && (prior.number !== event.pr.number || prior.url !== event.pr.url || Date.parse(prior.observedAt) > Date.parse(event.pr.observedAt))) throw new Error("PR identity changed or observation is stale");
      if (prior?.state === "merged" && JSON.stringify(prior) !== JSON.stringify(event.pr)) throw new Error("Merged PR observation is terminal");
      if (event.pr.state !== "open" || (prior && prior.head !== event.pr.head)) {
        for (const item of state.retries) if (item.status === "scheduled") item.status = "cancelled";
      }
      break;
    }
    case "record-check":
    case "record-review":
    case "record-attestation":
    case "record-evidence": {
      keys(event, ["entry"]);
      const kind = event.type.slice("record-".length);
      if (!entryRules[kind](event.entry)) throw new Error(`Invalid ${kind} schema`);
      if (!state.pr || event.entry.head !== state.pr.head) throw new Error("Evidence must identify the current PR head");
      const collection = kind === "evidence" ? "evidence" : `${kind}s`;
      const previous = state[collection].find((entry) => entry.id === event.entry.id);
      const clock = kind === "attestation" ? "receivedAt" : kind === "evidence" ? "recordedAt" : "observedAt";
      if (Date.parse(event.entry[clock]) > Date.parse(now) || (previous && Date.parse(previous[clock]) > Date.parse(event.entry[clock]))) throw new Error("Stale or future evidence");
      upsert(state[collection], event.entry);
      if (kind === "review" && event.entry.status !== "rate-limited") {
        const retry = state.retries.find((item) => item.reviewId === event.entry.id);
        if (retry?.status === "scheduled") retry.status = "cancelled";
      }
      break;
    }
    case "schedule-retry": {
      keys(event, ["reviewId", "notBefore", "ref"]);
      if (state.pr?.state !== "open") throw new Error("Only an open PR can schedule a retry");
      if (state.retries.some((item) => item.reviewId === event.reviewId)) throw new Error("Retry already scheduled, cancelled or consumed; at most one retry per review");
      if (!state.reviews.some((item) => item.id === event.reviewId && item.head === state.pr.head && item.status === "rate-limited")) throw new Error("Retry needs a current rate-limit observation");
      state.retries.push({ reviewId: event.reviewId, used: 0, notBefore: event.notBefore, status: "scheduled", ref: event.ref });
      break;
    }
    case "consume-retry": {
      keys(event, ["reviewId", "sessionId"]);
      if (!heartbeat(state, event.sessionId, root, now).contextReady) throw new Error("Read changed or missing context before a retry");
      if (!retryActions(state, now).some((item) => item.reviewId === event.reviewId)) throw new Error("Retry unavailable: terminal PR, consumed, stale head or not-before");
      const retry = state.retries.find((item) => item.reviewId === event.reviewId);
      retry.used = 1;
      retry.status = "consumed";
      break;
    }
    case "complete": {
      keys(event, ["sessionId"]);
      if (!heartbeat(state, event.sessionId, root, now).contextReady) throw new Error("Read changed or missing context before completion");
      const gaps = completionGaps(state);
      if (gaps.length) throw new Error(`Completion refused: ${gaps.join(", ")}`);
      state.progress = "done";
      break;
    }
    default: throw new Error("Unknown transition type");
  }
  state.revision += 1;
  state.updatedAt = now;
  return validateState(state);
}
