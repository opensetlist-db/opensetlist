import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { completionGaps, digest, encode } from "./model.mjs";
import { validateState } from "./schema.mjs";

export function readState(file) {
  const bytes = fs.readFileSync(file);
  const state = validateState(JSON.parse(bytes.toString("utf8")));
  if (state.progress === "done" && completionGaps(state).length) throw new Error("Invalid completed state: evidence incomplete");
  return { state, sha256: digest(bytes) };
}

export function withLock(file, action) {
  const lock = `${file}.lock`;
  const descriptor = fs.openSync(lock, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, encode({ pid: process.pid, startedAt: new Date().toISOString() }));
    return action();
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}

export function atomicWrite(file, bytes, beforeRename = () => {}) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    beforeRename();
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function initialize(file, state, dryRun = false) {
  validateState(state);
  if (fs.existsSync(file)) throw new Error("State file already exists");
  if (dryRun) return state;
  return withLock(file, () => {
    if (fs.existsSync(file)) throw new Error("State file already exists");
    atomicWrite(file, encode(state), () => {
      if (fs.existsSync(file)) throw new Error("Concurrent state creation");
    });
    return state;
  });
}

export function update(file, revision, transform, { dryRun = false, beforeRename } = {}) {
  const run = () => {
    const current = readState(file);
    if (current.state.revision !== revision) throw new Error("Revision conflict; reload current state");
    const next = validateState(transform(current.state));
    if (next.revision !== revision + 1) throw new Error("Update must advance exactly one revision");
    if (!dryRun) atomicWrite(file, encode(next), () => {
      beforeRename?.();
      if (readState(file).sha256 !== current.sha256) throw new Error("Concurrent state modification");
    });
    return next;
  };
  return dryRun ? run() : withLock(file, run);
}

const inline = (value) => String(value).replace(/[\r\n|`<>]/g, " ");
export function summary(state, kind) {
  const pr = state.pr;
  const status = `${state.progress}; PR ${pr ? `#${pr.number} ${pr.state}` : "unassigned"}; head ${pr?.head ?? "none"}; merge ${pr?.mergeCommit ?? "none"}`;
  const gates = [...state.checks.map((entry) => `check ${entry.id}=${entry.status}@${entry.head}`),
    ...state.reviews.map((entry) => `review ${entry.id}=${entry.status} (${entry.unresolved} unresolved)@${entry.head}`)];
  const retry = state.retries.map((entry) => `${entry.reviewId}: ${entry.status}, used ${entry.used}/1, not-before ${entry.notBefore}`);
  const devices = state.attestations.map((entry) => `${entry.id}: ${entry.result}; ${entry.reporter}; ${entry.device}/${entry.os}/${entry.browser}; performed ${entry.performedAt ?? `unknown (${entry.performedAtNote})`}; received ${entry.receivedAt}; head ${entry.head}; scope ${entry.scope}; ref ${entry.ref}`);
  const evidence = state.evidence.map((entry) => `${entry.id}: ${entry.ref}@${entry.head}`);
  const reads = state.sessions.flatMap((session) => session.reads.map((entry) => `${session.id}/${entry.documentId}: ${entry.sha256}, read ${entry.readAt}`));
  const gaps = completionGaps(state);
  const lines = [status, ...gates, ...retry, ...devices, ...evidence, ...reads, `Remaining gates: ${gaps.join(", ") || "none"}`].map(inline);
  if (kind === "board") return `| Task | Revision | State and evidence |\n| --- | --- | --- |\n| ${inline(state.task.id)} | ${state.revision} | ${lines.join("; ")} |`;
  if (kind !== "handoff") throw new Error("Expected handoff or board summary");
  return `Session state: ${inline(state.task.id)} / revision ${state.revision}\n\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

export function managedSection(text, taskId, body) {
  const start = `<!-- session-state:${taskId}:start -->`;
  const end = `<!-- session-state:${taskId}:end -->`;
  const starts = text.split(start).length - 1;
  const ends = text.split(end).length - 1;
  const section = `${start}\n${body}\n${end}`;
  if (starts === 0 && ends === 0) return text + (text.endsWith("\n") || !text ? "" : "\n") + "\n" + section + "\n";
  if (starts !== 1 || ends !== 1 || text.indexOf(end) < text.indexOf(start)) throw new Error("Ambiguous managed section markers");
  return text.slice(0, text.indexOf(start)) + section + text.slice(text.indexOf(end) + end.length);
}

const fileHash = (file) => fs.existsSync(file) ? digest(fs.readFileSync(file)) : "missing";
export function render(file, revision, destination, expectedHash, kind, dryRun = false) {
  if (path.resolve(file) === path.resolve(destination)) throw new Error("Summary cannot overwrite state");
  const run = () => {
    const current = readState(file);
    if (current.state.revision !== revision) throw new Error("Revision conflict; reload current state");
    if (fileHash(destination) !== expectedHash) throw new Error("Summary destination hash conflict");
    const prior = fs.existsSync(destination) ? fs.readFileSync(destination, "utf8") : "";
    const next = managedSection(prior, current.state.task.id, summary(current.state, kind));
    if (!dryRun) atomicWrite(destination, next, () => {
      if (readState(file).sha256 !== current.sha256 || fileHash(destination) !== expectedHash) throw new Error("Concurrent summary modification");
    });
    return next;
  };
  return dryRun ? run() : withLock(file, () => withLock(destination, run));
}
