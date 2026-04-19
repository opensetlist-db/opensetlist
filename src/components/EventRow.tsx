import Link from "next/link";
import { EventDateTime } from "@/components/EventDateTime";
import { EVENT_STATUS_BADGE, getEventStatus } from "@/lib/eventStatus";
import { slugify } from "@/lib/utils";
import type { EventStatus } from "@/generated/prisma/client";

// Accepts the row both pre-serialization (bigint id, raw prisma rows) and
// post-serialization (number id, EventForList). The home page passes the
// former; the events list page passes the latter.
interface RowEvent {
  id: number | bigint;
  status: EventStatus;
  date: string | Date | null;
  startTime: string | Date;
}

interface Props {
  event: RowEvent;
  locale: string;
  referenceNow: Date;
  title: string;
  subtitle?: string | null;
  slugSource: string | null;
  badgeLabel: string;
}

export function EventRow({
  event,
  locale,
  referenceNow,
  title,
  subtitle,
  slugSource,
  badgeLabel,
}: Props) {
  const badge = EVENT_STATUS_BADGE[getEventStatus(event, referenceNow)];
  // slugSource may be all-punctuation (`!!!`, `***`); slugify strips it to ""
  // and we'd emit `/events/{id}/`. Branch on the slug, not the source.
  const slug = slugSource ? slugify(slugSource) : "";
  const href = slug
    ? `/${locale}/events/${event.id}/${slug}`
    : `/${locale}/events/${event.id}`;
  return (
    <li
      className="flex items-start gap-3 rounded-lg bg-white px-4 py-3"
      style={{
        border: "0.5px solid #e8e8e8",
        borderRadius: "8px",
      }}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <EventDateTime
          date={event.date}
          startTime={event.startTime}
          variant="inline"
          className="font-dm-sans text-[11px] text-[#999999]"
        />
        <Link
          href={href}
          className="font-dm-sans block truncate text-[12px] hover:underline"
          style={{ color: "#1a1a1a", fontWeight: 500 }}
        >
          {title}
        </Link>
        {subtitle && (
          <span
            className="font-dm-sans block truncate text-[11px]"
            style={{ color: "#999999" }}
          >
            {subtitle}
          </span>
        )}
      </div>
      <span
        className={`font-dm-sans shrink-0 rounded-full px-2 py-0.5 text-[11px] ${badge.color}`}
      >
        {badgeLabel}
      </span>
    </li>
  );
}
