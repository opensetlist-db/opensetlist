import { getTranslations } from "next-intl/server";
import { nonBlank } from "@/lib/utils";
import { displayNameWithFallback } from "@/lib/display";
import { getEventStatus } from "@/lib/eventStatus";
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
        className="font-dm-sans mb-2 text-[13px] font-medium break-words"
        style={{ color: "#555555" }}
      >
        {nonBlank(seriesName) ?? evT("ungrouped")}
      </h3>
      <ul className="space-y-2">
        {events.map((event) => {
          const eventName = nonBlank(
            displayNameWithFallback(event, event.translations, locale)
          );
          const status = getEventStatus(event, referenceNow);
          return (
            <EventRow
              key={event.id}
              event={event}
              locale={locale}
              title={eventName ?? evT("unknownEvent")}
              slugSource={eventName}
              status={status}
              statusLabel={evT(`status.${status}`)}
            />
          );
        })}
      </ul>
    </div>
  );
}
