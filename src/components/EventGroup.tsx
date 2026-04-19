import { getTranslations } from "next-intl/server";
import { nonBlank, pickTranslation } from "@/lib/utils";
import { getEventStatus, EVENT_STATUS_BADGE } from "@/lib/eventStatus";
import { EventRow } from "@/components/EventRow";
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
        {nonBlank(seriesName) ?? evT("ungrouped")}
      </h3>
      <ul className="space-y-2">
        {events.map((event) => {
          const evTr = pickTranslation(event.translations, locale);
          const eventName = nonBlank(evTr?.name);
          const badge =
            EVENT_STATUS_BADGE[getEventStatus(event, referenceNow)];
          return (
            <EventRow
              key={event.id}
              event={event}
              locale={locale}
              title={eventName ?? evT("unknownEvent")}
              slugSource={eventName}
              badgeLabel={evT(badge.labelKey)}
              badgeColor={badge.color}
            />
          );
        })}
      </ul>
    </div>
  );
}
