/**
 * localStorage helpers for the wishlist (희망곡) feature.
 *
 * One key per event: `wish-{eventId}`. Value shape:
 *
 *   { wishes: [{ songId: number, dbId: string }] }
 *
 * `dbId` is the `SongWish.id` uuid returned by POST. We persist it
 * locally so DELETE on undo can target the right server row without
 * a re-derivation lookup.
 *
 * At Phase 1B/1C the dedup contract is: localStorage owns "did this
 * user already wish this song" enforcement before POST. The server
 * accepts dupes if they slip through (operator monitor + Phase 2
 * full enforcement when accounts ship). So this module is the source
 * of truth for the per-user view, full stop.
 *
 * Cap of 3 is enforced at the call site (`<EventWishSection>` checks
 * `wishes.length < 3` before opening the inline `+ 추가` search).
 *
 * SSR-safe: every read returns `[]` if `window === undefined`. Callers
 * hydrate after mount, mirroring the `useMounted` + delayed-read
 * pattern in `<ReactionButtons>`.
 */

/**
 * Minimal song-display payload persisted alongside each wish so the
 * my-list rows can re-render via `displayOriginalTitle()` without a
 * round-trip on page load. The translations array is locale-agnostic
 * (we keep every locale we received from the search response) so the
 * row stays correct when the user switches locale post-add.
 *
 * Bounded by `<SongSearch>`'s default `take` (currently 8) and a max
 * of 3 wishes per event — total localStorage cost under 5KB worst
 * case.
 */
export interface WishSongDisplay {
  originalTitle: string;
  originalLanguage: string;
  variantLabel: string | null;
  baseVersionId: number | null;
  translations: Array<{
    locale: string;
    title: string;
    variantLabel: string | null;
  }>;
}

export interface WishEntry {
  songId: number;
  dbId: string;
  song: WishSongDisplay;
}

interface StoredShape {
  wishes: WishEntry[];
}

const EMPTY: WishEntry[] = [];

function key(eventId: string): string {
  return `wish-${eventId}`;
}

function isTranslation(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.locale === "string" &&
    typeof v.title === "string" &&
    (v.variantLabel === null || typeof v.variantLabel === "string")
  );
}

function isWishSongDisplay(value: unknown): value is WishSongDisplay {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.originalTitle !== "string") return false;
  if (typeof v.originalLanguage !== "string") return false;
  if (v.variantLabel !== null && typeof v.variantLabel !== "string") return false;
  if (v.baseVersionId !== null && typeof v.baseVersionId !== "number") return false;
  if (!Array.isArray(v.translations)) return false;
  return v.translations.every(isTranslation);
}

function isWishEntry(value: unknown): value is WishEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  // Tighter than `typeof === "number"` — guards against NaN / Infinity
  // / non-positive ids slipping through from a tampered localStorage
  // payload (DevTools, browser extensions). Same shape-validation
  // discipline as `<ReactionButtons>`'s `isStoredShape`.
  return (
    typeof v.songId === "number" &&
    Number.isFinite(v.songId) &&
    Number.isInteger(v.songId) &&
    v.songId > 0 &&
    typeof v.dbId === "string" &&
    v.dbId.length > 0 &&
    isWishSongDisplay(v.song)
  );
}

function isStoredShape(value: unknown): value is StoredShape {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.wishes)) return false;
  return v.wishes.every(isWishEntry);
}

export function readWishes(eventId: string): WishEntry[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(key(eventId));
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredShape(parsed)) return EMPTY;
    return parsed.wishes;
  } catch {
    return EMPTY;
  }
}

export function writeWishes(eventId: string, wishes: WishEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      key(eventId),
      JSON.stringify({ wishes } satisfies StoredShape),
    );
  } catch {
    // Quota exceeded / private mode — silently drop. The server still
    // has the row (POST already succeeded by the time we persist), so
    // a refresh re-loads from the SSR/polled fan TOP-3, just without
    // the "I picked this" decoration in my-list. Acceptable trade for
    // not surfacing a localStorage error to the user.
  }
}
