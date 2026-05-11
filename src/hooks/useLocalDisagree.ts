"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMounted } from "@/hooks/useMounted";

/**
 * Phase 1B/1C client-side hook for the per-viewer "disagree" vote
 * on a setlist row — the ✕ button in `<NumberSlot>` paired with
 * the existing ✓ confirm button (see `useLocalConfirm`).
 *
 * Mirrors `useLocalConfirm` exactly except for two differences:
 *
 *   1. **Storage key** — `disagree-{eventId}` instead of
 *      `confirm-{eventId}`. Independent localStorage scopes mean
 *      the two hooks never collide; the `<ActualSetlist>` consumer
 *      enforces mutual exclusivity at the handler level (tap ✓
 *      clears any matching disagree, and vice versa).
 *
 *   2. **No POST** — disagrees stay client-only at v0.10.x. The
 *      server-side aggregation (N disagrees → row hidden / marked
 *      disputed) ships in Week 3 alongside `<AddItemBottomSheet>`,
 *      where actual user-entered conflicts exist to vote on. Until
 *      then this hook is purely UX placeholder so the affordance
 *      is in place. When Week 3 wires the schema + endpoint, this
 *      hook gains a gated `fetch(.../disagree, ...)` matching the
 *      `useLocalConfirm` pattern.
 *
 * No anonId / userId — same Phase 1 rule as confirm
 * (`wiki/conflicts.md #9`); operator runbook covers bounded abuse.
 */
const KEY_PREFIX = "disagree-";

export function disagreeKey(eventId: string): string {
  return `${KEY_PREFIX}${eventId}`;
}

function readStored(eventId: string): Set<number> {
  if (typeof window === "undefined") return new Set();
  const raw = window.localStorage.getItem(disagreeKey(eventId));
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is number => Number.isFinite(v)));
  } catch {
    return new Set();
  }
}

function writeStored(eventId: string, ids: Set<number>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      disagreeKey(eventId),
      JSON.stringify([...ids]),
    );
  } catch {
    // Quota / private-mode failures swallow silently — same
    // resilience pattern as wishStorage / predictionsStorage /
    // useLocalConfirm.
  }
}

interface UseLocalDisagreeReturn {
  /**
   * Set of setlist-item ids the viewer has disagreed with for this
   * event. Reads as the empty set until after mount (mounted-gate
   * hydration) so SSR + first client render produce matching HTML.
   */
  disagreedItemIds: Set<number>;
  /**
   * Toggle the disagree flag for one item. Optimistic localStorage
   * update; no POST at v0.10.x (deferred until Week 3 ships
   * aggregation). Mutual exclusivity with the confirm vote is
   * enforced by the consumer (`<ActualSetlist>`), not here, so
   * each hook stays independently testable.
   */
  toggleDisagree: (itemId: number) => void;
}

export function useLocalDisagree(eventId: string): UseLocalDisagreeReturn {
  const mounted = useMounted();

  const [disagreedItemIds, setDisagreedItemIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  if (mounted && hydratedKey !== eventId) {
    setHydratedKey(eventId);
    setDisagreedItemIds(readStored(eventId));
  }

  // Latest-state ref so the toggle callback doesn't take
  // disagreedItemIds as a dep (which would change identity every
  // toggle). Same useEffect-sync pattern as useLocalConfirm —
  // the `react-hooks/refs` rule blocks render-phase ref mutation.
  const latestDisagreedRef = useRef(disagreedItemIds);
  useEffect(() => {
    latestDisagreedRef.current = disagreedItemIds;
  }, [disagreedItemIds]);

  const toggleDisagree = useCallback(
    (itemId: number) => {
      const prev = latestDisagreedRef.current;
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      setDisagreedItemIds(next);
      // Optimistic ref update — covers the rapid-double-tap window
      // before the sync effect fires. See useLocalConfirm for the
      // full StrictMode rationale (CR #283).
      latestDisagreedRef.current = next;
      writeStored(eventId, next);
    },
    [eventId],
  );

  return { disagreedItemIds, toggleDisagree };
}
