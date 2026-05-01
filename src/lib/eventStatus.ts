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
