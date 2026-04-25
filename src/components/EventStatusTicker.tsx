"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ONGOING_BUFFER_MS } from "@/lib/eventStatus";

// Buffer the refresh past the boundary so the post-refresh fetch sees fresh
// data. The polling endpoints (/api/setlist, /api/impressions) are
// private/no-store as of v0.8.15, but Vercel may still edge-cache the SSR
// HTML for a brief window; 2s defends against that boundary race and is
// imperceptible to a user watching the boundary flip.
// Exported so the test asserts boundary timing against the same value.
export const POST_BOUNDARY_BUFFER_MS = 2000;

// setTimeout uses a 32-bit signed delay; values past ~24.8 days overflow and
// the timer fires immediately. A tab open for 25+ days through the boundary
// is implausible, and a premature refresh on mount is worse than skipping —
// the next page load will recompute and schedule fresh.
const MAX_SETTIMEOUT_MS = 2147483647; // 2^31 - 1

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
export default function EventStatusTicker({ startTime }: Props) {
  const router = useRouter();

  useEffect(() => {
    if (!startTime) return;
    const startTimeMs = new Date(startTime).getTime();
    if (Number.isNaN(startTimeMs)) return;

    const completedAtMs = startTimeMs + ONGOING_BUFFER_MS;
    const nowMs = Date.now();

    let nextBoundaryMs: number | null = null;
    if (nowMs < startTimeMs) nextBoundaryMs = startTimeMs;
    else if (nowMs < completedAtMs) nextBoundaryMs = completedAtMs;
    if (nextBoundaryMs === null) return;

    const delayMs = nextBoundaryMs - nowMs + POST_BOUNDARY_BUFFER_MS;
    if (delayMs > MAX_SETTIMEOUT_MS) return;

    const timer = setTimeout(() => router.refresh(), delayMs);
    return () => clearTimeout(timer);
  }, [startTime, router]);

  return null;
}
