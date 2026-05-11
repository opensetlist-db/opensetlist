import type { EventStatus } from "@/generated/prisma/client";

// Source of truth for the resolved-status string set. The type is
// derived from this tuple so adding a status in one place forces every
// runtime consumer (e.g. the OG route's `?s=` validator) to stay in
// sync — there's no second list to keep aligned. `as const satisfies`
// pins the tuple's element type to the union without widening either.
export const RESOLVED_EVENT_STATUSES = [
  "upcoming",
  "ongoing",
  "completed",
  "cancelled",
] as const;

export type ResolvedEventStatus = (typeof RESOLVED_EVENT_STATUSES)[number];

export const ONGOING_BUFFER_MS = 12 * 60 * 60 * 1000; // 12h — conservative upper bound for any live event

/**
 * Buffer past the boundary instant before scheduling the timer that
 * fires. Without this, the timer fires AT the boundary — the
 * post-fire fetch could race a Vercel-edge-cached SSR response that
 * hasn't yet observed the flip. 2s is imperceptible to a user
 * watching the boundary cross and gives the cache a window to settle.
 * Exported so timer-based tests can assert the same offset.
 */
export const POST_BOUNDARY_BUFFER_MS = 2000;

// setTimeout uses a 32-bit signed delay; values past ~24.8 days
// overflow and the timer fires immediately. A page open for that
// long through a boundary is implausible, and a premature fire on
// mount is worse than skipping — the next mount recomputes.
const MAX_SETTIMEOUT_MS = 2147483647; // 2^31 - 1

type EventStatusInput = {
  status: EventStatus;
  startTime: Date | string;
};

export function getEventStatus(
  event: EventStatusInput,
  referenceNow?: Date
): ResolvedEventStatus {
  if (event.status === "cancelled") return "cancelled";
  if (event.status === "ongoing") return "ongoing";
  if (event.status === "completed") return "completed";

  const start =
    event.startTime instanceof Date
      ? event.startTime
      : new Date(event.startTime);
  const now = referenceNow ?? new Date();
  const ongoingEnd = new Date(start.getTime() + ONGOING_BUFFER_MS);

  if (now < start) return "upcoming";
  if (now < ongoingEnd) return "ongoing";
  return "completed";
}

/**
 * Compute the delay (in ms from `now`) until the next event-status
 * boundary that's worth waking up a client for — either the
 * upcoming → ongoing flip at `startTime`, or the ongoing →
 * completed flip at `startTime + ONGOING_BUFFER_MS`. Returns null
 * when the event is already past both boundaries, when `startTime`
 * is missing/unparseable, or when the next boundary is past
 * setTimeout's overflow ceiling.
 *
 * Two consumers:
 *   - `<EventStatusTicker>` schedules `router.refresh()` so SSR
 *     re-runs and the badge / `isOngoing` props flip.
 *   - `useRealtimeEventChannel` schedules a `fetchSnapshot()` so
 *     the in-hook `polledStatus` re-derives — without this, the
 *     Realtime path's `polledStatus ?? status` precedence would
 *     mask a fresh SSR status with a stale polled value (since
 *     Realtime only refetches `/api/setlist` on push, not on a
 *     cadence — pre-Realtime polling implicitly handled this).
 *
 * Returned delay already includes `POST_BOUNDARY_BUFFER_MS`.
 */
export function nextEventStatusBoundaryDelay(
  startTime: Date | string | null,
  now: Date = new Date(),
): number | null {
  if (!startTime) return null;
  const startTimeMs = (
    startTime instanceof Date ? startTime : new Date(startTime)
  ).getTime();
  if (Number.isNaN(startTimeMs)) return null;

  const completedAtMs = startTimeMs + ONGOING_BUFFER_MS;
  const nowMs = now.getTime();

  let nextBoundaryMs: number | null = null;
  if (nowMs < startTimeMs) nextBoundaryMs = startTimeMs;
  else if (nowMs < completedAtMs) nextBoundaryMs = completedAtMs;
  if (nextBoundaryMs === null) return null;

  const delayMs = nextBoundaryMs - nowMs + POST_BOUNDARY_BUFFER_MS;
  if (delayMs > MAX_SETTIMEOUT_MS) return null;
  return delayMs;
}
