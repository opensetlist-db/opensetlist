import type { EventStatus } from "@/generated/prisma/client";

export type ResolvedEventStatus =
  | "upcoming"
  | "ongoing"
  | "completed"
  | "cancelled";

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
