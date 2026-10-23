// This executable schema is shared by file loading, reducers and the CLI.
// Unknown fields fail closed, so a misspelled gate cannot silently disappear.
const string = (value) => typeof value === "string" && value.trim().length > 0;
const nullable = (rule) => (value) => value === null || rule(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const choice = (...values) => (value) => values.includes(value);
const array = (rule) => (value) => Array.isArray(value) && value.every(rule);
const object = (fields) => (value) => value !== null && typeof value === "object"
  && !Array.isArray(value) && Object.keys(value).length === Object.keys(fields).length
  && Object.entries(fields).every(([key, rule]) => Object.hasOwn(value, key) && rule(value[key]));
export const timestamp = (value) => string(value) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
export const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const head = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const id = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/.test(value);
const unique = (items, key) => new Set(items.map((item) => item[key])).size === items.length;
const names = array(id);
const evidence = object({ id, head, ref: string, recordedAt: timestamp });
const check = object({ id, head, status: choice("pending", "pass", "fail", "skipped"), ref: string, observedAt: timestamp });
const review = object({ id, head, status: choice("pending", "pass", "findings", "skipped", "rate-limited", "unrun"),
  unresolved: integer, ref: string, observedAt: timestamp });
const attestation = object({ id, head, result: choice("pass", "fail"), reporter: string,
  device: string, os: string, browser: string, scope: string, performedAt: nullable(timestamp),
  performedAtNote: nullable(string), receivedAt: timestamp, ref: string });
const document = object({ id, path: string });
const requirements = object({ checks: names, reviews: names, attestations: names, evidence: names });
const task = object({ id, target: string, documents: array(document), requirements });
const retry = object({ reviewId: id, used: (value) => value === 0 || value === 1,
  notBefore: timestamp, status: choice("scheduled", "consumed", "cancelled"), ref: string });
const read = object({ documentId: id, sha256: hash, readAt: timestamp });
const session = object({ id, startedAt: timestamp, reads: array(read), checkpoint: nullable(string) });
const shape = object({ schemaVersion: (value) => value === 1, revision: integer,
  updatedAt: timestamp, task, progress: choice("in-progress", "done"),
  pr: nullable(object({ number: (value) => integer(value) && value > 0, url: string, head,
    state: choice("open", "closed", "merged"), mergeCommit: nullable(head), observedAt: timestamp, ref: string })),
  checks: array(check), reviews: array(review), retries: array(retry),
  attestations: array(attestation), evidence: array(evidence), sessions: array(session) });

export function validateTask(value) {
  if (!task(value) || value.documents.length === 0 || !unique(value.documents, "id")
      || !unique(value.documents, "path") || Object.values(value.requirements).some((ids) => new Set(ids).size !== ids.length)
      || ["checks", "reviews", "evidence"].some((kind) => value.requirements[kind].length === 0)) {
    throw new Error("Invalid task schema (unique documents/gates and nonempty checks/reviews/evidence required)");
  }
  return value;
}

export function validateState(value) {
  if (!shape(value)) throw new Error("Invalid session-state schema v1");
  validateTask(value.task);
  for (const key of ["checks", "reviews", "attestations", "evidence", "sessions"]) {
    if (!unique(value[key], "id")) throw new Error(`Duplicate ${key} ID`);
  }
  if (!unique(value.retries, "reviewId")) throw new Error("Duplicate retry review ID");
  for (const entry of value.sessions) {
    if (!unique(entry.reads, "documentId") || entry.reads.some((read) => !value.task.documents.some((doc) => doc.id === read.documentId))) {
      throw new Error("Invalid document read record");
    }
  }
  for (const entry of value.attestations) {
    if (entry.performedAt === null && entry.performedAtNote === null) throw new Error("Unknown performedAt needs an uncertainty note");
    if (entry.performedAt !== null && Date.parse(entry.performedAt) > Date.parse(entry.receivedAt)) throw new Error("Attestation performed after receipt");
  }
  if (value.pr && (value.pr.state === "merged") !== (value.pr.mergeCommit !== null)) throw new Error("Merge state needs exactly one merge commit");
  if (value.reviews.some((entry) => entry.status === "pass" && entry.unresolved !== 0)) throw new Error("Review pass has unresolved findings");
  if (value.retries.some((entry) => (entry.status === "consumed") !== (entry.used === 1))) throw new Error("Invalid retry consumption");
  return value;
}

export const entryRules = { check, review, attestation, evidence };
