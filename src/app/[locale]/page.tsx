import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, pickTranslation, slugify, formatDate } from "@/lib/utils";

async function getRecentEvents(limit: number) {
  const events = await prisma.event.findMany({
    where: {
      isDeleted: false,
      status: "completed",
      date: { not: null },
      parentEventId: null,
    },
    include: {
      translations: true,
      eventSeries: { include: { translations: true } },
    },
    orderBy: { date: "desc" },
    take: limit,
  });
  return serializeBigInt(events);
}

async function getUpcomingEvents(limit: number) {
  const events = await prisma.event.findMany({
    where: {
      isDeleted: false,
      status: { in: ["upcoming", "ongoing"] },
      date: { not: null },
      parentEventId: null,
    },
    include: {
      translations: true,
      eventSeries: { include: { translations: true } },
    },
    orderBy: { date: "asc" },
    take: limit,
  });
  return serializeBigInt(events);
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("Home");
  const ct = await getTranslations("Common");
  const evT = await getTranslations("Event");

  const [recentEvents, upcomingEvents] = await Promise.all([
    getRecentEvents(10),
    getUpcomingEvents(10),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-3 text-lg text-zinc-500">{t("description")}</p>
      </header>

      {/* Upcoming Events */}
      {upcomingEvents.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-4 text-2xl font-semibold">
            {t("upcomingEvents")}
          </h2>
          <EventList events={upcomingEvents} locale={locale} evT={evT} />
        </section>
      )}

      {/* Recent Events */}
      <section className="mb-10">
        <h2 className="mb-4 text-2xl font-semibold">{t("recentEvents")}</h2>
        {recentEvents.length === 0 ? (
          <p className="text-zinc-500">{t("noEvents")}</p>
        ) : (
          <EventList events={recentEvents} locale={locale} evT={evT} />
        )}
      </section>
    </main>
  );
}

function EventList({
  events,
  locale,
  evT,
}: {
  events: Awaited<ReturnType<typeof getRecentEvents>>;
  locale: string;
  evT: Awaited<ReturnType<typeof getTranslations<"Event">>>;
}) {
  return (
    <ul className="space-y-3">
      {events.map((event) => {
        const evTr = pickTranslation(event.translations, locale);
        const seriesTr = event.eventSeries
          ? pickTranslation(event.eventSeries.translations, locale)
          : null;
        return (
          <li
            key={event.id}
            className="flex items-baseline gap-3 border-b border-zinc-100 pb-2"
          >
            <span className="shrink-0 text-sm text-zinc-400">
              {formatDate(event.date, locale)}
            </span>
            <div className="flex-1">
              <Link
                href={`/${locale}/events/${event.id}/${slugify(evTr?.name ?? "")}`}
                className="font-medium text-blue-600 hover:underline"
              >
                {evTr?.name ?? "Unknown Event"}
              </Link>
              {seriesTr && (
                <span className="ml-2 text-sm text-zinc-500">
                  {seriesTr.name}
                </span>
              )}
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                event.status === "completed"
                  ? "bg-zinc-100 text-zinc-600"
                  : event.status === "upcoming"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-green-100 text-green-700"
              }`}
            >
              {evT(`status.${event.status}`)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
