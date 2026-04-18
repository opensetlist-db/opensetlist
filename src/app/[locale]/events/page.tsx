import { getTranslations } from "next-intl/server";
import { getAllEventsGrouped } from "@/lib/events";
import { EventGroup } from "@/components/EventGroup";

export default async function EventsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("Event");
  const now = new Date();
  const { ongoingGroups, upcomingGroups, pastGroups } =
    await getAllEventsGrouped(locale, now);

  const isEmpty =
    ongoingGroups.length === 0 &&
    upcomingGroups.length === 0 &&
    pastGroups.length === 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">{t("allEvents")}</h1>

      {isEmpty && <p className="text-sm text-zinc-500">{t("noEvents")}</p>}

      {ongoingGroups.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            {t("ongoing")}
          </h2>
          {ongoingGroups.map((g) => (
            <EventGroup
              key={`ongoing-${g.seriesId ?? "ungrouped"}`}
              seriesName={g.seriesName}
              events={g.events}
              locale={locale}
              referenceNow={now}
            />
          ))}
        </section>
      )}

      {upcomingGroups.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold">{t("upcoming")}</h2>
          {upcomingGroups.map((g) => (
            <EventGroup
              key={`upcoming-${g.seriesId ?? "ungrouped"}`}
              seriesName={g.seriesName}
              events={g.events}
              locale={locale}
              referenceNow={now}
            />
          ))}
        </section>
      )}

      {pastGroups.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t("past")}</h2>
          {pastGroups.map((g) => (
            <EventGroup
              key={`past-${g.seriesId ?? "ungrouped"}`}
              seriesName={g.seriesName}
              events={g.events}
              locale={locale}
              referenceNow={now}
            />
          ))}
        </section>
      )}
    </main>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Event" });
  return { title: t("allEvents") };
}
