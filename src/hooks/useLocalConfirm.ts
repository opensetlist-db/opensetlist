"use client";

import { useCallback, useState } from "react";
import { useMounted } from "@/hooks/useMounted";
import { LAUNCH_FLAGS } from "@/lib/launchFlags";

/**
 * Phase 1B/1C client-side hook for the per-viewer confirm state.
 *
 * One localStorage key per event: `confirm-{eventId}`. Value is a
 * JSON-serialized array of setlist-item ids (numbers) the viewer
 * has tapped to confirm. Mirrors the wishlist + predictions
 * single-key-per-event convention.
 *
 * The hook hides the env-flag check from callers — components don't
 * see whether the DB write actually happened. At 5/23 Kobe
 * (`LAUNCH_FLAGS.confirmDbEnabled === false`) the localStorage
 * state alone drives the UI; at 5/30 Kanagawa the flag flips and
 * the same hook starts firing POSTs that aggregate per-row
 * confirm counts. No call-site changes needed for the activation —
 * the spec calls this "ready to flip on at 5/30 via env var
 * alone".
 *
 * No anonId / userId is sent (`wiki/conflicts.md #9`). Viewers in
 * private windows or across browsers can submit duplicates;
 * operator runbook covers the bounded abuse risk for Phase 1.
 */
const KEY_PREFIX = "confirm-";

export function confirmKey(eventId: string): string {
  return `${KEY_PREFIX}${eventId}`;
}

function readStored(eventId: string): Set<number> {
  if (typeof window === "undefined") return new Set();
  const raw = window.localStorage.getItem(confirmKey(eventId));
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    // Defensive: drop any non-finite-number entries so a
    // DevTools-tampered payload can't introduce NaN / Infinity into
    // the Set and trip downstream `.has(item.id)` lookups.
    return new Set(parsed.filter((v): v is number => Number.isFinite(v)));
  } catch {
    return new Set();
  }
}

function writeStored(eventId: string, ids: Set<number>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      confirmKey(eventId),
      JSON.stringify([...ids]),
    );
  } catch {
    // Quota / private-mode failures swallow silently — same
    // resilience pattern as wishStorage / predictionsStorage. UI
    // optimistic update has already happened; persistence is best-
    // effort and a refresh just shows the un-tapped state again.
  }
}

interface UseLocalConfirmReturn {
  /**
   * Set of setlist-item ids the viewer has confirmed for this
   * event. Reads as the empty set until after mount (mounted-gate
   * hydration) so SSR + first client render produce matching HTML.
   */
  confirmedItemIds: Set<number>;
  /**
   * Toggle the confirm flag for one item. Optimistic localStorage
   * update; (gated) POST fires when `LAUNCH_FLAGS.confirmDbEnabled`
   * is true. POST failures swallow silently — the local UI state
   * has already updated, and at 1B the DB write is decorative
   * monitoring anyway.
   *
   * Cancel-confirm at 1B/1C is local-only: a tap that removes from
   * the set does NOT fire DELETE (deferred to Phase 2 per the task
   * spec). The DB rows accumulate as raw confirm-events; the
   * threshold-aggregation pass in Week 3 handles deduplication.
   */
  toggleConfirm: (itemId: number) => void;
}

export function useLocalConfirm(eventId: string): UseLocalConfirmReturn {
  const mounted = useMounted();

  // Mounted-gated hydration via render-time `setState`, mirroring
  // `<EventWishSection>` and `<PredictedSetlist>`. Render-time
  // setState (not useEffect) is the project's canonical pattern
  // for localStorage hydration — see useMounted.ts:9-18 docstring.
  const [confirmedItemIds, setConfirmedItemIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  if (mounted && hydratedKey !== eventId) {
    setHydratedKey(eventId);
    setConfirmedItemIds(readStored(eventId));
  }

  const toggleConfirm = useCallback(
    (itemId: number) => {
      setConfirmedItemIds((prev) => {
        const next = new Set(prev);
        const wasPresent = next.has(itemId);
        if (wasPresent) {
          next.delete(itemId);
        } else {
          next.add(itemId);
        }
        writeStored(eventId, next);
        // Fire-and-forget POST only on the add side. Cancel
        // (`wasPresent === true`) is local-only at 1B/1C — DELETE
        // is Phase 2.
        if (!wasPresent && LAUNCH_FLAGS.confirmDbEnabled) {
          fetch(`/api/setlist-items/${itemId}/confirm`, {
            method: "POST",
          }).catch(() => {
            // Swallow network errors — the row's local state has
            // already flipped to my-confirmed, and at 1B the DB
            // write is best-effort monitoring. The next viewer's
            // poll-driven re-render will reflect actual DB state
            // when threshold-aggregation ships in Week 3.
          });
        }
        return next;
      });
    },
    [eventId],
  );

  return { confirmedItemIds, toggleConfirm };
}
