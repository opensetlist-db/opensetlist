import { UploadError } from "./errors";

// Object keys are derived by the server from values it has validated —
// never taken from the client:
//
//   <prefix>/<target segment>/<target id>/<attempt id>.<ext>
//   e.g. prod/series-logo/7/3f0c…-….png
//
// - prefix: the deployment's R2 namespace (storage config), so test and
//   dev objects never share a path with production ones;
// - target segment + id: the target the admin is authorised to change,
//   after the handler validated it exists;
// - attempt id: a UUID the admin form creates once per selected file and
//   reuses for every resubmission of that file. It binds the key to one
//   upload attempt: a retry lands on the same key (and reconciles), a new
//   file gets a new key, and nothing can overwrite an earlier attempt's
//   bytes (conditional PUT, see storage.ts);
// - ext: from the decoded format, not the file name.
//
// The key is not a secret (it is the public URL's path) and carries no
// operator data, so it doubles as the operational correlation id in logs.

export type TargetSegment = "event-logo" | "series-logo" | "album-cover";

const ATTEMPT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Validates and normalises a client-supplied attempt id (UUID). */
export function parseAttemptId(value: unknown): string {
  if (typeof value === "string") {
    const id = value.trim().toLowerCase();
    if (ATTEMPT_ID_RE.test(id)) return id;
  }
  throw new UploadError("invalid_request", "업로드 시도 ID가 올바르지 않습니다. 페이지를 새로고침해 주세요.");
}

export function buildObjectKey(parts: {
  prefix: string;
  segment: TargetSegment;
  targetId: bigint;
  attemptId: string;
  ext: string;
}): string {
  const { prefix, segment, targetId, attemptId, ext } = parts;
  if (!ATTEMPT_ID_RE.test(attemptId)) throw new Error("attemptId must be validated first");
  if (targetId <= BigInt(0)) throw new Error("targetId must be positive");
  if (!/^[a-z0-9]+$/.test(ext)) throw new Error("ext must come from the decoded format");
  return `${prefix}/${segment}/${targetId.toString()}/${attemptId}.${ext}`;
}
