"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { nextEventStatusBoundaryDelay } from "@/lib/eventStatus";

// Re-export for back-compat with `event-status-ticker.test.tsx`,
// which asserts the boundary-buffer offset against the same constant.
// The canonical home is now `src/lib/eventStatus.ts` so the realtime
// hook's boundary scheduler stays in lockstep — both consumers share
// the helper that paid for the 2s post-boundary buffer.
export { POST_BOUNDARY_BUFFER_MS } from "@/lib/eventStatus";

type Props = {
  /** Event start time as ISO string. null disables the ticker. */
  startTime: string | null;
};

// Server-rendered status pages don't auto-update when the upcoming → ongoing
// or ongoing → completed boundary crosses; a tab idle through start time
// stays frozen on "Upcoming" until manual refresh, and useSetlistPolling
// (gated on resolved status === "ongoing") never starts. Schedule a single
// router.refresh() at the next boundary so the server re-renders, the badge
// flips, and the polling loop re-evaluates its enabled prop.
//
// Boundary math (next-boundary delay incl. POST_BOUNDARY_BUFFER_MS,
// setTimeout-overflow guard) lives in `nextEventStatusBoundaryDelay`
// — shared with `useRealtimeEventChannel`, which schedules its own
// `fetchSnapshot()` at the same instant so the polled `status`
// re-derives in the Realtime path (where push-only updates would
// otherwise let `polledStatus` stay stale through the boundary).
//
// Single-shot by design: this effect's deps are [startTime, router].
// When the upcoming → ongoing refresh fires, `router.refresh()`
// re-runs SSR but does NOT change `startTime`, so the effect doesn't
// re-run and the second boundary (ongoing → completed) is never
// scheduled here. That's intentional — the SSR `status` may stay
// at "ongoing" past the 12h buffer window, but `LiveEventLayout`'s
// `polledStatus ?? status` precedence and the client hooks
// (`useSetlistPolling` 5s cadence, `useRealtimeEventChannel`
// boundary timer) reconcile downstream UI from there. Putting both
// boundaries in this single-shot router-refresh would also be
// wasteful: the second SSR re-render would be bytes-identical for
// most viewers (no new content past 12h), so the cost isn't worth
// the duplicated work.
export default function EventStatusTicker({ startTime }: Props) {
  const router = useRouter();

  useEffect(() => {
    if (!startTime) return;
    const delayMs = nextEventStatusBoundaryDelay(startTime);
    if (delayMs === null) return;

    const timer = setTimeout(() => router.refresh(), delayMs);
    return () => clearTimeout(timer);
  }, [startTime, router]);

  return null;
}
