import Link from "next/link";
import { EventDateTime } from "@/components/EventDateTime";
import EventStatusTicker from "@/components/EventStatusTicker";
import { StatusBadge } from "@/components/StatusBadge";
import { slugify } from "@/lib/utils";
import type { ResolvedEventStatus } from "@/lib/eventStatus";

// Accepts the row both pre-serialization (bigint id, raw prisma rows) and
// post-serialization (number id, EventForList). The home page passes the
// former; the events list page passes the latter.
interface RowEvent {
  id: number | bigint;
  date: string | Date | null;
  startTime: string | Date;
}

interface Props {
  event: RowEvent;
  locale: string;
  title: string;
  subtitle?: string | null;
  slugSource: string | null;
  // Resolved by the caller via getTranslations("Event") on locale pages.
  // Splitting status (semantic) from statusLabel (i18n string) keeps
  // <StatusBadge> usable from both server and client trees without forcing
  // it to be async or client-only.
  status: ResolvedEventStatus;
  statusLabel: string;
}

export function EventRow({
  event,
  locale,
  title,
  subtitle,
  slugSource,
  status,
  statusLabel,
}: Props) {
  // slugSource may be all-punctuation (`!!!`, `***`); slugify strips it to ""
  // and we'd emit `/events/{id}/`. Branch on the slug, not the source.
  const slug = slugSource ? slugify(slugSource) : "";
  const href = slug
    ? `/${locale}/events/${event.id}/${slug}`
    : `/${locale}/events/${event.id}`;
  const startTimeIso =
    typeof event.startTime === "string"
      ? event.startTime
      : event.startTime?.toISOString() ?? null;
  return (
    <li
      className="flex items-start gap-3 rounded-lg bg-white px-4 py-3"
      style={{
        border: "0.5px solid #e8e8e8",
        borderRadius: "8px",
      }}
    >
      <EventStatusTicker startTime={startTimeIso} />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <EventDateTime
          date={event.date}
          startTime={event.startTime}
          variant="inline"
          className="font-dm-sans text-[11px] text-[#999999]"
        />
        <Link
          href={href}
          className="font-dm-sans block break-words text-[12px] hover:underline"
          style={{ color: "#1a1a1a", fontWeight: 500 }}
        >
          {title}
        </Link>
        {subtitle && (
          <span
            className="font-dm-sans block break-words text-[11px]"
            style={{ color: "#999999" }}
          >
            {subtitle}
          </span>
        )}
      </div>
      <span className="shrink-0">
        <StatusBadge status={status} label={statusLabel} size="sm" />
      </span>
    </li>
  );
}
