import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, pickTranslation, slugify, formatDate } from "@/lib/utils";
import { HomeHero } from "@/components/HomeHero";

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
    <>
      <HomeHero />
      <main className="mx-auto max-w-3xl px-4 pt-6 pb-8">
        {/* Upcoming Events */}
        {upcomingEvents.length > 0 && (
          <section className="mb-10">
            <h2 className="font-dm-sans mb-4 text-2xl font-semibold">
              {t("upcomingEvents")}
            </h2>
            <EventList events={upcomingEvents} locale={locale} evT={evT} />
          </section>
        )}

        {/* Recent Events */}
        <section className="mb-10">
          <h2 className="font-dm-sans mb-4 text-2xl font-semibold">
            {t("recentEvents")}
          </h2>
          {recentEvents.length === 0 ? (
            <p className="text-zinc-500">{t("noEvents")}</p>
          ) : (
            <EventList events={recentEvents} locale={locale} evT={evT} />
          )}
        </section>
      </main>
    </>
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
    <ul className="space-y-2">
      {events.map((event) => {
        const evTr = pickTranslation(event.translations, locale);
        const seriesTr = event.eventSeries
          ? pickTranslation(event.eventSeries.translations, locale)
          : null;
        return (
          <li
            key={event.id}
            className="flex items-center gap-3 rounded-lg bg-white px-4 py-3"
            style={{
              border: "0.5px solid #e8e8e8",
              borderRadius: "8px",
            }}
          >
            <span
              className="font-dm-sans shrink-0 text-[11px]"
              style={{ color: "#999999" }}
            >
              {formatDate(event.date, locale)}
            </span>
            <div className="flex-1 min-w-0">
              <Link
                href={`/${locale}/events/${event.id}/${slugify(evTr?.name ?? "")}`}
                className="font-dm-sans block truncate text-[12px] hover:underline"
                style={{ color: "#1a1a1a", fontWeight: 500 }}
              >
                {evTr?.name ?? "Unknown Event"}
              </Link>
              {seriesTr && (
                <span
                  className="font-dm-sans block truncate text-[11px]"
                  style={{ color: "#999999" }}
                >
                  {seriesTr.name}
                </span>
              )}
            </div>
            <span
              className={`font-dm-sans shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                event.status === "completed"
                  ? "bg-[#E1F5FE] text-[#0277BD]"
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
