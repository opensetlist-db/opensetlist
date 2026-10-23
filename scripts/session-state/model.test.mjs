import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createState, documentSnapshot, heartbeat, retryActions, transition } from "./model.mjs";
import { timestamp, validateState } from "./schema.mjs";

const now = "2026-10-23T05:00:00.000Z";
const later = "2026-10-23T05:10:00.000Z";
const head = "a".repeat(40);
const nextHead = "b".repeat(40);
const task = JSON.parse(fs.readFileSync(new URL("./fixtures/task.json", import.meta.url)));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-model-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "instructions.md"), "Required instructions\nManual approval: keep me.\n");
  let state = createState(task, now);
  const apply = (event, time = state.updatedAt) => (state = transition(state, event, { root, now: time }));
  const start = (id = "session-one") => apply({ type: "start-session", sessionId: id });
  const ack = (id = "session-one") => apply({ type: "ack-read", sessionId: id, documentId: "instructions", sha256: documentSnapshot(state, "instructions", root).sha256 });
  const pr = (status = "open", sha = head) => apply({ type: "observe-pr", pr: {
    number: 999, url: "https://example.invalid/pull/999", head: sha, state: status,
    mergeCommit: status === "merged" ? "c".repeat(40) : null, observedAt: now, ref: "pr-observation.json",
  } });
  const review = (status = "rate-limited", id = "claude", sha = head) => apply({ type: "record-review", entry: {
    id, head: sha, status, unresolved: 0, observedAt: now, ref: "review.json",
  } });
  const schedule = () => apply({ type: "schedule-retry", reviewId: "claude", notBefore: later, ref: "rate-limit.json" });
  return { root, get state() { return state; }, apply, start, ack, pr, review, schedule };
}

test("initial full reads are explicit, session-specific and race checked; resume returns deltas", (t) => {
  const f = fixture(t);
  f.start();
  assert.equal(heartbeat(f.state, "session-one", f.root).documents[0].reason, "unread");
  const old = documentSnapshot(f.state, "instructions", f.root).sha256;
  fs.appendFileSync(path.join(f.root, "instructions.md"), "Changed instruction\n");
  assert.throws(() => f.apply({ type: "ack-read", sessionId: "session-one", documentId: "instructions", sha256: old }), /changed/);
  assert.equal(f.state.sessions[0].reads.length, 0);
  f.ack();
  assert.equal(heartbeat(f.state, "session-one", f.root).contextReady, true);
  f.apply({ type: "heartbeat", sessionId: "session-one" });
  assert.deepEqual(heartbeat(f.state, "session-one", f.root).delta, {});
  f.pr();
  assert.deepEqual(Object.keys(heartbeat(f.state, "session-one", f.root).delta), ["pr"]);
  fs.appendFileSync(path.join(f.root, "instructions.md"), "Delta\n");
  assert.equal(heartbeat(f.state, "session-one", f.root).documents[0].reason, "changed");
  f.start("session-two");
  assert.equal(heartbeat(f.state, "session-two", f.root).documents[0].reason, "unread");
  fs.unlinkSync(path.join(f.root, "instructions.md"));
  assert.equal(heartbeat(f.state, "session-one", f.root).documents[0].reason, "unavailable");
});

test("one retry is reserved before external side effects and respects not-before", (t) => {
  const f = fixture(t);
  f.start(); f.ack(); f.pr(); f.review(); f.schedule();
  assert.equal(retryActions(f.state, now).length, 0);
  assert.throws(() => f.apply({ type: "consume-retry", reviewId: "claude", sessionId: "session-one" }), /unavailable/);
  assert.equal(retryActions(f.state, later).length, 1);
  f.apply({ type: "consume-retry", reviewId: "claude", sessionId: "session-one" }, later);
  assert.equal(f.state.retries[0].used, 1);
  assert.throws(() => f.apply({ type: "consume-retry", reviewId: "claude", sessionId: "session-one" }, later), /unavailable/);
  assert.throws(() => f.schedule(), /at most one/);
});

for (const terminal of ["merged", "closed"]) {
  test(`${terminal} outranks pending retry; stale observations cannot undo merge`, (t) => {
    const f = fixture(t);
    f.start(); f.ack(); f.pr(); f.review(); f.schedule();
    assert.equal(retryActions(f.state, later).length, 1);
    f.pr(terminal);
    assert.equal(f.state.retries[0].status, "cancelled");
    assert.equal(retryActions(f.state, later).length, 0);
    assert.throws(() => f.apply({ type: "consume-retry", reviewId: "claude", sessionId: "session-one" }, later), /unavailable/);
    if (terminal === "merged") assert.throws(() => f.pr(), /terminal/);
    else { f.pr(); assert.throws(() => f.schedule(), /at most one/); }
  });
}

test("head changes and resolved reviews cancel pending retries without restoring budget", (t) => {
  const f = fixture(t);
  f.start(); f.ack(); f.pr(); f.review(); f.schedule();
  assert.equal(retryActions(f.state, later).length, 1);
  f.pr("open", nextHead);
  assert.equal(retryActions(f.state, later).length, 0);
  assert.equal(f.state.retries[0].status, "cancelled");
  assert.throws(() => f.review("pass"), /current PR head/);
  f.review("pass", "claude", nextHead);
  assert.throws(() => f.schedule(), /at most one/);
});

test("changed context suppresses actionable retries until acknowledged", (t) => {
  const f = fixture(t);
  f.start(); f.ack(); f.pr(); f.review(); f.schedule();
  assert.equal(heartbeat(f.state, "session-one", f.root, later).retryActions.length, 1);
  fs.appendFileSync(path.join(f.root, "instructions.md"), "New rule");
  assert.equal(heartbeat(f.state, "session-one", f.root, later).retryActions.length, 0);
  assert.throws(() => f.apply({ type: "consume-retry", reviewId: "claude", sessionId: "session-one" }, later), /context/);
  f.ack();
  assert.equal(heartbeat(f.state, "session-one", f.root, later).retryActions.length, 1);
});

test("done needs merge and every explicit current-head gate; green skipped review is insufficient", (t) => {
  const f = fixture(t);
  f.start(); f.ack(); f.pr();
  const complete = () => f.apply({ type: "complete", sessionId: "session-one" });
  assert.throws(complete, /owner-merge/);
  f.pr("merged");
  assert.throws(complete, /checks:unit.*reviews:standards.*attestations:ios.*evidence:validation/);
  f.apply({ type: "record-check", entry: { id: "unit", head, status: "pass", ref: "unit.log", observedAt: now } });
  for (const id of task.requirements.reviews) f.review("pass", id);
  f.review("skipped", "claude");
  f.apply({ type: "record-evidence", entry: { id: "validation", head, ref: "validation.md", recordedAt: now } });
  const entry = { id: "ios", head, result: "pass", reporter: "owner", device: "iPhone fixture", os: "iOS fixture", browser: "Safari fixture",
    scope: "three fixture pages", performedAt: null, performedAtNote: "Owner reported recently; device clock unavailable", receivedAt: now, ref: "owner-report.json" };
  f.apply({ type: "record-attestation", entry });
  assert.throws(complete, /reviews:claude/);
  f.review("pass", "claude");
  f.apply({ type: "record-attestation", entry: { ...entry, result: "fail" } });
  assert.throws(complete, /attestations:ios/);
  f.apply({ type: "record-attestation", entry });
  assert.throws(() => f.apply({ type: "record-attestation", entry: { ...entry, performedAtNote: null } }), /uncertainty/);
  assert.throws(() => f.apply({ type: "record-attestation", entry: { ...entry, performedAt: later } }), /after receipt/);
  complete();
  assert.equal(f.state.progress, "done");
  assert.equal(f.state.attestations[0].performedAt, null);
  assert.equal(f.state.attestations[0].receivedAt, now);
  assert.throws(() => f.apply({ type: "start-session", sessionId: "new-session" }), /immutable/);
});

test("schema rejects unknown fields, false review passes and stale observations", (t) => {
  const f = fixture(t);
  assert.throws(() => validateState({ ...f.state, surprise: true }), /schema/);
  assert.throws(() => f.apply({ type: "start-session", sessionId: "valid", surprise: true }), /fields/);
  f.pr();
  assert.throws(() => f.apply({ type: "record-review", entry: { id: "claude", head, status: "pass", unresolved: 1, ref: "report", observedAt: now } }), /unresolved/);
  assert.throws(() => f.apply({ type: "observe-pr", pr: { ...f.state.pr, observedAt: "2026-10-22T05:00:00Z" } }), /stale/);
  assert.throws(() => f.apply({ type: "observe-pr", pr: { ...f.state.pr, number: 998 } }), /identity/);
  assert.throws(() => f.apply({ type: "start-session", sessionId: "clock" }, "2026-10-22T05:00:00.000Z"), /backwards/);
  assert.equal(timestamp("2026-02-30T00:00:00Z"), false);
  assert.equal(timestamp("2026-02-28T00:00:00Z"), true);
  assert.equal(timestamp("2026-02-28T00:00:00.123456Z"), true);
  assert.throws(() => createState({ ...task, requirements: { checks: [], reviews: [], evidence: [], attestations: [] } }), /nonempty/);
});
