import type { EventStatus } from "@/generated/prisma/client";

export type ResolvedEventStatus =
  | "upcoming"
  | "ongoing"
  | "completed"
  | "cancelled";

const ONGOING_BUFFER_MS = 12 * 60 * 60 * 1000; // 12h — conservative upper bound for any live event

type EventStatusInput = {
  status: EventStatus;
  startTime: Date | string | null;
};

export function getEventStatus(event: EventStatusInput): ResolvedEventStatus {
  if (event.status === "cancelled") return "cancelled";
  if (event.status === "ongoing") return "ongoing";
  if (event.status === "completed") return "completed";

  if (!event.startTime) return "upcoming";

  const start =
    event.startTime instanceof Date
      ? event.startTime
      : new Date(event.startTime);
  // Malformed startTime — fall back to "upcoming" rather than silently
  // reporting "completed" from an Invalid Date comparison.
  if (Number.isNaN(start.getTime())) return "upcoming";

  const now = new Date();
  const ongoingEnd = new Date(start.getTime() + ONGOING_BUFFER_MS);

  if (now < start) return "upcoming";
  if (now < ongoingEnd) return "ongoing";
  return "completed";
}

export const EVENT_STATUS_BADGE: Record<
  ResolvedEventStatus,
  { labelKey: `status.${ResolvedEventStatus}`; color: string }
> = {
  upcoming: { labelKey: "status.upcoming", color: "bg-blue-100 text-blue-700" },
  ongoing: { labelKey: "status.ongoing", color: "bg-green-100 text-green-700" },
  completed: {
    labelKey: "status.completed",
    color: "bg-gray-100 text-gray-500",
  },
  cancelled: { labelKey: "status.cancelled", color: "bg-red-100 text-red-500" },
};
