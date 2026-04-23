const KEY = "opensetlist_anon_id";

/**
 * Server-side validation cap on anonId length. Keep in sync with the
 * `@db.VarChar(64)` declaration on the SetlistItemReaction.anonId and
 * EventImpression.anonId columns in `prisma/schema.prisma`. Single source
 * of truth used by every API route that accepts the field.
 */
export const ANON_ID_MAX_LEN = 64;

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
