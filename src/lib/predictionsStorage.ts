/**
 * localStorage helpers for the Phase 1B Predicted Setlist (Stage C).
 *
 * One key per event: `predict-{eventId}`. Value shape:
 *
 *   {
 *     eventId: string,
 *     songs: [{ songId: number, song: WishSongDisplay }],
 *     savedAt: ISO string,
 *     lockedAt: ISO string | null
 *   }
 *
 * Mirrors the wishlist's `wish-{eventId}` shape (PR #279) — the
 * embedded `WishSongDisplay` payload (originalTitle, translations,
 * etc.) lets the Predicted list render via `displayOriginalTitle()`
 * without a round-trip on page load. `lockedAt` records the moment
 * the user crossed `event.startTime` so the post-show share text
 * can reference "예상 마감 시각" if needed (Phase 2).
 *
 * `hasPredictions(eventId)` stays as the cheap existence check used
 * by `<SetlistTabs>` for tab visibility. The full read/write
 * contract is below.
 *
 * SSR-safe: every read returns `[]` if `window === undefined`.
 * Callers hydrate after mount, mirroring the `<EventWishSection>`
 * mounted-gate pattern.
 */

import type { WishSongDisplay } from "@/lib/wishStorage";

export interface PredictionEntry {
  songId: number;
  song: WishSongDisplay;
}

interface StoredShape {
  eventId: string;
  songs: PredictionEntry[];
  savedAt: string;
  lockedAt: string | null;
}

const KEY_PREFIX = "predict-";

export function predictKey(eventId: string): string {
  return `${KEY_PREFIX}${eventId}`;
}

export function hasPredictions(eventId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(predictKey(eventId));
    if (!raw) return false;
    // Tab visibility doesn't care about the payload shape — it only
    // cares that the user has predictions stored. The strict
    // shape contract lives in `readPredictions` below; this check
    // is intentionally permissive so DevTools-set partial payloads
    // still flip the tab on for testing.
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
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

function isPredictionEntry(value: unknown): value is PredictionEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.songId === "number" &&
    Number.isFinite(v.songId) &&
    Number.isInteger(v.songId) &&
    v.songId > 0 &&
    isWishSongDisplay(v.song)
  );
}

function isStoredShape(value: unknown): value is StoredShape {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.eventId !== "string") return false;
  if (!Array.isArray(v.songs)) return false;
  if (!v.songs.every(isPredictionEntry)) return false;
  if (typeof v.savedAt !== "string") return false;
  if (v.lockedAt !== null && typeof v.lockedAt !== "string") return false;
  return true;
}

/** Read the full prediction payload. Returns null when missing or malformed. */
export function readPredictions(eventId: string): StoredShape | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(predictKey(eventId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredShape(parsed)) return null;
    // Defensive: enforce eventId match. A user who manually edited
    // localStorage to swap eventIds would otherwise leak predictions
    // across events; the catch is cheap.
    if (parsed.eventId !== eventId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Read just the songs (most callers only need this). Returns fresh `[]` per call. */
export function readPredictionEntries(eventId: string): PredictionEntry[] {
  const stored = readPredictions(eventId);
  return stored ? stored.songs : [];
}

/** Replace the songs array; preserves existing `lockedAt` if any. */
export function writePredictions(
  eventId: string,
  songs: PredictionEntry[],
): void {
  if (typeof window === "undefined") return;
  // Best-effort `lockedAt` preservation. `readPredictions` returns
  // null when `isStoredShape` rejects (DevTools tampering, partial
  // extension write); without a fallback, the next write would
  // silently drop a previously-stamped lock — `markLocked`'s
  // idempotency guarantee evaporates and the UI would unlock. We
  // raw-parse just the `lockedAt` string so a malformed-but-locked
  // payload still preserves the lock instant. CR #281 caught this.
  const existing = readPredictions(eventId);
  let preservedLockedAt: string | null = existing?.lockedAt ?? null;
  if (!existing) {
    try {
      const raw = window.localStorage.getItem(predictKey(eventId));
      if (raw) {
        const parsed = JSON.parse(raw) as { lockedAt?: unknown };
        if (typeof parsed?.lockedAt === "string") {
          preservedLockedAt = parsed.lockedAt;
        }
      }
    } catch {
      /* malformed JSON — leave preservedLockedAt as null */
    }
  }
  const next: StoredShape = {
    eventId,
    songs,
    savedAt: new Date().toISOString(),
    lockedAt: preservedLockedAt,
  };
  try {
    window.localStorage.setItem(predictKey(eventId), JSON.stringify(next));
  } catch {
    // Quota exceeded / private mode — silent. Same convention as
    // `wishStorage.writeWishes`. The user's prediction stays in
    // the in-memory state for the session; refresh recovers from
    // whatever was last successfully stored.
  }
}

/**
 * Stamp the lock time. Idempotent: a second call after lockedAt is
 * already set is a no-op (preserves the original lock instant).
 * Intended to fire from the lock-state useEffect when `Date.now() >=
 * event.startTime`.
 */
export function markLocked(eventId: string, at: Date = new Date()): void {
  const existing = readPredictions(eventId);
  if (!existing) return;
  if (existing.lockedAt) return;
  const next: StoredShape = { ...existing, lockedAt: at.toISOString() };
  try {
    window.localStorage.setItem(predictKey(eventId), JSON.stringify(next));
  } catch {
    /* swallow per the writePredictions convention */
  }
}

/** Remove the prediction entirely. Used by tests + the Phase 2 reset path. */
export function clearPredictions(eventId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(predictKey(eventId));
  } catch {
    /* swallow */
  }
}
