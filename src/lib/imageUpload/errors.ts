// Failure vocabulary of the shared admin image upload service.
//
// Every failure carries an `outcome` that tells the admin form what
// happened to the target's assignment, because that — not the HTTP
// status — is what the operator has to act on:
//
//   not_saved — known to have failed before the DB commit. The previous
//               assignment is intact. (A stored object may be left
//               unassigned; see `storage_failed` / `not_saved` below.)
//   conflict  — someone else changed the assignment since the form was
//               loaded. Nothing of this attempt was committed; reload.
//   unknown   — the commit may or may not have happened (the connection
//               dropped around COMMIT). Resubmit the SAME attempt, which
//               reconciles instead of writing twice.
//
// Messages are Korean: they are shown only on admin screens (CLAUDE.md
// admin i18n exemption). `code` is the stable, machine-readable part.

export type UploadOutcome = "not_saved" | "conflict" | "unknown";

export type UploadErrorCode =
  | "invalid_request"
  | "forbidden_origin"
  | "request_too_large"
  | "image_too_large"
  | "unsupported_image_type"
  | "invalid_image"
  | "image_dimensions"
  | "target_not_found"
  | "assignment_conflict"
  | "attempt_conflict"
  | "storage_not_configured"
  | "storage_failed"
  | "not_saved"
  | "outcome_unknown";

const STATUS: Record<UploadErrorCode, number> = {
  invalid_request: 400,
  forbidden_origin: 403,
  request_too_large: 413,
  image_too_large: 413,
  unsupported_image_type: 415,
  invalid_image: 422,
  image_dimensions: 422,
  target_not_found: 404,
  assignment_conflict: 409,
  attempt_conflict: 409,
  storage_not_configured: 503,
  storage_failed: 502,
  not_saved: 500,
  outcome_unknown: 503,
};

const OUTCOME: Record<UploadErrorCode, UploadOutcome> = {
  invalid_request: "not_saved",
  forbidden_origin: "not_saved",
  request_too_large: "not_saved",
  image_too_large: "not_saved",
  unsupported_image_type: "not_saved",
  invalid_image: "not_saved",
  image_dimensions: "not_saved",
  target_not_found: "not_saved",
  assignment_conflict: "conflict",
  attempt_conflict: "conflict",
  storage_not_configured: "not_saved",
  storage_failed: "not_saved",
  not_saved: "not_saved",
  outcome_unknown: "unknown",
};

export class UploadError extends Error {
  readonly code: UploadErrorCode;
  readonly status: number;
  readonly outcome: UploadOutcome;
  /** Extra admin-safe detail for the response (never credentials). */
  readonly detail?: Record<string, unknown>;

  constructor(
    code: UploadErrorCode,
    message: string,
    options: { detail?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "UploadError";
    this.code = code;
    this.status = STATUS[code];
    this.outcome = OUTCOME[code];
    this.detail = options.detail;
  }
}

export function isUploadError(err: unknown): err is UploadError {
  return err instanceof UploadError;
}
