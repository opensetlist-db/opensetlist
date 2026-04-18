import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, pickTranslation, slugify } from "@/lib/utils";
import { EventDateTime } from "@/components/EventDateTime";
import { HomeHero } from "@/components/HomeHero";
import { Pagination } from "@/components/Pagination";
import { getEventStatus, EVENT_STATUS_BADGE } from "@/lib/eventStatus";

const PAGE_SIZE = 10;
const ONGOING_BUFFER_MS = 12 * 60 * 60 * 1000;

async function getOngoingEvents(now: Date) {
  const ongoingStart = new Date(now.getTime() - ONGOING_BUFFER_MS);

  const events = await prisma.event.findMany({
    where: {
      isDeleted: false,
      OR: [
        { status: "ongoing" },
        {
          status: "scheduled",
          // Boundaries mirror `getEventStatus`: an event with
          // startTime === now - 12h has ongoingEnd === now, which the
          // badge classifies as "completed" — so exclude it here
          // (`gt`) and include it in the completed query below (`lte`).
          startTime: { gt: ongoingStart, lte: now },
        },
      ],
    },
    include: {
      translations: true,
      eventSeries: { include: { translations: true } },
    },
    orderBy: { startTime: "asc" },
  });
  return serializeBigInt(events);
}

async function getUpcomingEvents(
  now: Date,
  requestedPage: number,
  pageSize: number
) {
  const where = {
    isDeleted: false,
    status: "scheduled" as const,
    startTime: { gt: now },
  };

  const total = await prisma.event.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * pageSize;

  const events = await prisma.event.findMany({
    where,
    include: {
      translations: true,
      eventSeries: { include: { translations: true } },
    },
    orderBy: { startTime: "asc" },
    skip,
    take: pageSize,
  });

  return { events: serializeBigInt(events), total, totalPages, page };
}

async function getCompletedEvents(
  now: Date,
  requestedPage: number,
  pageSize: number
) {
  const completedCutoff = new Date(now.getTime() - ONGOING_BUFFER_MS);

  const where = {
    isDeleted: false,
    OR: [
      { status: "completed" as const },
      {
        status: "scheduled" as const,
        startTime: { lte: completedCutoff },
      },
    ],
  };

  const total = await prisma.event.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * pageSize;

  const events = await prisma.event.findMany({
    where,
    include: {
      translations: true,
      eventSeries: { include: { translations: true } },
    },
    orderBy: { startTime: "desc" },
    skip,
    take: pageSize,
  });

  return { events: serializeBigInt(events), total, totalPages, page };
}

function parsePage(raw: string | undefined): number {
  const n = parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ upcomingPage?: string; completedPage?: string }>;
}) {
  const { locale } = await params;
  const { upcomingPage, completedPage } = await searchParams;

  const requestedUpcomingPage = parsePage(upcomingPage);
  const requestedCompletedPage = parsePage(completedPage);

  const t = await getTranslations("Home");
  const evT = await getTranslations("Event");

  // Single `now` shared across all three queries so an event near a
  // bucket boundary can't get classified inconsistently between sections.
  const now = new Date();

  const [ongoingEvents, upcomingData, completedData] = await Promise.all([
    getOngoingEvents(now),
    getUpcomingEvents(now, requestedUpcomingPage, PAGE_SIZE),
    getCompletedEvents(now, requestedCompletedPage, PAGE_SIZE),
  ]);

  return (
    <>
      <HomeHero />
      <main className="mx-auto max-w-3xl px-4 pt-6 pb-8">
        {ongoingEvents.length > 0 && (
          <section className="mb-10">
            <h2 className="font-dm-sans mb-4 text-2xl font-semibold">
              {t("ongoingEvents")}
            </h2>
            <EventList
              events={ongoingEvents}
              locale={locale}
              evT={evT}
              referenceNow={now}
            />
          </section>
        )}

        {upcomingData.total > 0 && (
          <section className="mb-10">
            <h2 className="font-dm-sans mb-4 text-2xl font-semibold">
              {t("upcomingEvents")}
            </h2>
            <EventList
              events={upcomingData.events}
              locale={locale}
              evT={evT}
              referenceNow={now}
            />
            <Pagination
              currentPage={upcomingData.page}
              totalPages={upcomingData.totalPages}
              pageParamKey="upcomingPage"
              otherParams={{ completedPage: String(completedData.page) }}
            />
          </section>
        )}

        <section className="mb-10">
          <h2 className="font-dm-sans mb-4 text-2xl font-semibold">
            {t("recentEvents")}
          </h2>
          {completedData.total === 0 ? (
            <p className="text-zinc-500">{t("noEvents")}</p>
          ) : (
            <>
              <EventList
                events={completedData.events}
                locale={locale}
                evT={evT}
                referenceNow={now}
              />
              <Pagination
                currentPage={completedData.page}
                totalPages={completedData.totalPages}
                pageParamKey="completedPage"
                otherParams={{ upcomingPage: String(upcomingData.page) }}
              />
            </>
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
  referenceNow,
}: {
  events: Awaited<ReturnType<typeof getOngoingEvents>>;
  locale: string;
  evT: Awaited<ReturnType<typeof getTranslations<"Event">>>;
  referenceNow: Date;
}) {
  return (
    <ul className="space-y-2">
      {events.map((event) => {
        const evTr = pickTranslation(event.translations, locale);
        const seriesTr = event.eventSeries
          ? pickTranslation(event.eventSeries.translations, locale)
          : null;
        const badge = EVENT_STATUS_BADGE[getEventStatus(event, referenceNow)];
        return (
          <li
            key={event.id}
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
                href={`/${locale}/events/${event.id}/${slugify(evTr?.name ?? "")}`}
                className="font-dm-sans block truncate text-[12px] hover:underline"
                style={{ color: "#1a1a1a", fontWeight: 500 }}
              >
                {seriesTr?.name ?? evTr?.name ?? evT("unknownEvent")}
              </Link>
              {seriesTr && evTr?.name && (
                <span
                  className="font-dm-sans block truncate text-[11px]"
                  style={{ color: "#999999" }}
                >
                  {evTr.name}
                </span>
              )}
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
  );
}
