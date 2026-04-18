import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { pickTranslation, slugify } from "@/lib/utils";
import { getEventStatus, EVENT_STATUS_BADGE } from "@/lib/eventStatus";
import { EventDateTime } from "@/components/EventDateTime";
import type { EventForList } from "@/lib/events";

interface Props {
  seriesName: string | null;
  events: EventForList[];
  locale: string;
  referenceNow: Date;
}

export async function EventGroup({
  seriesName,
  events,
  locale,
  referenceNow,
}: Props) {
  const evT = await getTranslations("Event");

  return (
    <div className="mb-6">
      <h3
        className="font-dm-sans mb-2 text-[13px] font-medium"
        style={{ color: "#555555" }}
      >
        {seriesName ?? evT("ungrouped")}
      </h3>
      <ul className="space-y-2">
        {events.map((event) => {
          const evTr = pickTranslation(event.translations, locale);
          const badge =
            EVENT_STATUS_BADGE[getEventStatus(event, referenceNow)];
          return (
            <li
              key={event.id}
              className="flex items-center gap-3 rounded-lg bg-white px-4 py-3"
              style={{
                border: "0.5px solid #e8e8e8",
                borderRadius: "8px",
              }}
            >
              <EventDateTime
                date={event.date}
                startTime={event.startTime}
                variant="inline"
                className="font-dm-sans shrink-0 text-[11px] text-[#999999]"
              />
              <div className="flex-1 min-w-0">
                <Link
                  href={`/${locale}/events/${event.id}/${slugify(evTr?.name ?? "")}`}
                  className="font-dm-sans block truncate text-[12px] hover:underline"
                  style={{ color: "#1a1a1a", fontWeight: 500 }}
                >
                  {evTr?.name ?? evT("unknownEvent")}
                </Link>
              </div>
              <span
                className={`font-dm-sans shrink-0 rounded-full px-2 py-0.5 text-[11px] ${badge.color}`}
              >
                {evT(badge.labelKey)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
