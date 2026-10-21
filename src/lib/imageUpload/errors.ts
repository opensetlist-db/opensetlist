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
//               loaded. Nothing of this attempt was committed by this
//               request; reload.
//   unknown   — the commit may or may not have happened (the connection
//               dropped around COMMIT). Resubmit the SAME attempt, which
//               reconciles instead of writing twice.
//
// Messages are Korean: they are shown only on admin screens (CLAUDE.md
// admin i18n exemption). `code` is the stable, machine-readable part.

export type UploadOutcome = "not_saved" | "conflict" | "unknown";

// One table: adding a code is one line here.
const CODES = {
  invalid_request: { status: 400, outcome: "not_saved" },
  forbidden_origin: { status: 403, outcome: "not_saved" },
  request_too_large: { status: 413, outcome: "not_saved" },
  image_too_large: { status: 413, outcome: "not_saved" },
  unsupported_image_type: { status: 415, outcome: "not_saved" },
  invalid_image: { status: 422, outcome: "not_saved" },
  image_dimensions: { status: 422, outcome: "not_saved" },
  target_not_found: { status: 404, outcome: "not_saved" },
  assignment_conflict: { status: 409, outcome: "conflict" },
  attempt_conflict: { status: 409, outcome: "conflict" },
  storage_not_configured: { status: 503, outcome: "not_saved" },
  storage_failed: { status: 502, outcome: "not_saved" },
  not_saved: { status: 500, outcome: "not_saved" },
  outcome_unknown: { status: 503, outcome: "unknown" },
} as const satisfies Record<string, { status: number; outcome: UploadOutcome }>;

export type UploadErrorCode = keyof typeof CODES;

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
    this.status = CODES[code].status;
    this.outcome = CODES[code].outcome;
    this.detail = options.detail;
  }
}

export function isUploadError(err: unknown): err is UploadError {
  return err instanceof UploadError;
}

// Errors raised from more than one place, with one wording each.

export function targetNotFound(): UploadError {
  return new UploadError("target_not_found", "대상을 찾을 수 없습니다. 삭제되었을 수 있습니다.");
}

export function attemptConflict(): UploadError {
  return new UploadError(
    "attempt_conflict",
    "같은 업로드 시도 ID로 다른 파일이 이미 저장되어 있습니다. 파일을 다시 선택해 주세요.",
  );
}

/** "N MB" for messages, derived from a byte limit so the text cannot drift. */
export function formatMiB(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))}MB`;
}
