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
