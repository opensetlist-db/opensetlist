const KEY = "opensetlist_anon_id";

/**
 * Server-side validation cap on anonId length. Keep in sync with the
 * `@db.VarChar(64)` declaration on the SetlistItemReaction.anonId and
 * EventImpression.anonId columns in `prisma/schema.prisma`. Single source
 * of truth used by every API route that accepts the field.
 */
export const ANON_ID_MAX_LEN = 64;

export type ParseAnonIdResult =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

/**
 * Validate + normalize an anonId from a request body. Pattern shared by
 * every API route that accepts the field — keeps the rules in one place.
 *
 * Accepts:
 *   - undefined  → ok, value=null (legacy / no-anon client)
 *   - string ≤ ANON_ID_MAX_LEN → ok, value=string|null (empty → null so
 *     the partial unique correctly skips this row)
 *
 * Rejects:
 *   - any other type
 *   - string longer than ANON_ID_MAX_LEN
 */
export function parseAnonId(value: unknown): ParseAnonIdResult {
  if (value === undefined) return { ok: true, value: null };
  if (typeof value !== "string" || value.length > ANON_ID_MAX_LEN) {
    return { ok: false, message: "invalid anonId" };
  }
  return { ok: true, value: value.length > 0 ? value : null };
}

export type ParseRequiredAnonIdResult =
  | { ok: true; value: string }
  | { ok: false; message: string };

/**
 * Charset the strict parser admits. `getAnonId` mints
 * `crypto.randomUUID()` (hex + hyphens); underscore is allowed too so
 * fixture ids like `anon_1` stay valid. Anything with whitespace,
 * slashes, dots or non-ASCII is not an id this app ever issued — it is
 * either a hand-edited localStorage value or a forged body.
 */
const REQUIRED_ANON_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Strict sibling of `parseAnonId` for writes where the anonId is the
 * ownership / cap key (fan board picks, per-group wishes): a missing id
 * would make every anonymous write share one bucket, so absent is an
 * error here, not a legacy fallback.
 *
 * Rejects undefined, null, "", non-strings, strings over
 * ANON_ID_MAX_LEN, and strings outside `REQUIRED_ANON_ID_RE`. Same
 * error message as the lenient parser so routes can surface one 400
 * body for both.
 */
export function parseRequiredAnonId(value: unknown): ParseRequiredAnonIdResult {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > ANON_ID_MAX_LEN ||
    !REQUIRED_ANON_ID_RE.test(value)
  ) {
    return { ok: false, message: "invalid anonId" };
  }
  return { ok: true, value };
}

/**
 * Returns the browser's anonymous identifier, creating it on first call.
 *
 * SSR-safe (returns ''). Returns '' if localStorage is unavailable
 * (private mode, quota exceeded). Caller should treat empty as "no dedup
 * possible this request" — server accepts an absent anonId and proceeds
 * with a non-idempotent create.
 *
 * The id is also the merge anchor for future Phase 2 account signup —
 * the signup handler claims anon-keyed rows and rewrites them to userId
 * ownership.
 */
export function getAnonId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

export { KEY as ANON_ID_KEY };
