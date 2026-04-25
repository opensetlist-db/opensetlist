"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ONGOING_BUFFER_MS } from "@/lib/eventStatus";

// Buffer the refresh past the boundary so the post-refresh fetch sees fresh
// data. The polling endpoints (/api/setlist, /api/impressions) carry an
// s-maxage; the SSR page itself isn't explicitly cached but Vercel may still
// edge-cache HTML. 2s is imperceptible to a user watching the boundary flip.
const POST_BOUNDARY_BUFFER_MS = 2000;

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

    const timer = setTimeout(
      () => router.refresh(),
      nextBoundaryMs - nowMs + POST_BOUNDARY_BUFFER_MS
    );
    return () => clearTimeout(timer);
  }, [startTime, router]);

  return null;
}
