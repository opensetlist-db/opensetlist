import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, nonBlank } from "@/lib/utils";
import { displayNameWithFallback } from "@/lib/display";
import { HomeHero } from "@/components/HomeHero";
import { Pagination } from "@/components/Pagination";
import { EventRow } from "@/components/EventRow";
import { getEventStatus, EVENT_STATUS_BADGE } from "@/lib/eventStatus";
import { BASE_URL } from "@/lib/config";
import { routing } from "@/i18n/routing";

// hreflang lives on the homepage (not the locale layout) so the canonical
// only applies to the locale root. A layout-level canonical would be
// inherited by every child page (e.g. /ko/songs/789), pointing them all at
// the home URL — search engines would then de-prioritize the actual content
// pages. x-default → /en is the safe English fallback for visitors whose
// language isn't a configured locale; keep it explicit (not tied to
// routing.defaultLocale, which is currently ko) so adding/changing the
// default locale doesn't accidentally repoint the international fallback.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  // new URL() instead of `${BASE_URL}/${l}` so a trailing slash on
  // NEXT_PUBLIC_BASE_URL doesn't produce `//ko` and break the canonical.
  const localeUrl = (l: string) => new URL(`/${l}`, BASE_URL).toString();
  const languages: Record<string, string> = Object.fromEntries(
    routing.locales.map((l) => [l, localeUrl(l)])
  );
  return {
    alternates: {
      canonical: localeUrl(locale),
      languages: {
        ...languages,
        "x-default": localeUrl("en"),
      },
    },
  };
}

const PAGE_SIZE = 10;
const ONGOING_BUFFER_MS = 12 * 60 * 60 * 1000;
const HOME_WINDOW_DAYS = 30;

// Calendar windows are anchored to UTC day boundaries (not `now ± 30d`
// as a time offset). Otherwise the inclusion of an event that happens to
// fall on the 30th day drifts by the server's running time-of-day, and
// the edges of the window disagree between regions. See CLAUDE.md.
function utcDayOffset(d: Date, days: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days)
  );
}

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
  // End-exclusive: "events scheduled before the start of day +31", i.e.
  // all events up to and including the 30-days-from-today UTC day.
  const upcomingCutoff = utcDayOffset(now, HOME_WINDOW_DAYS + 1);

  const where = {
    isDeleted: false,
    status: "scheduled" as const,
    startTime: { gt: now, lt: upcomingCutoff },
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
  // Inclusive: events starting on or after the start of the UTC day
  // that is `HOME_WINDOW_DAYS` days before today.
  const windowStart = utcDayOffset(now, -HOME_WINDOW_DAYS);

  const where = {
    isDeleted: false,
    startTime: { gte: windowStart },
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
        const eventName = nonBlank(
          displayNameWithFallback(event, event.translations, locale)
        );
        const seriesName = event.eventSeries
          ? nonBlank(
              displayNameWithFallback(
                event.eventSeries,
                event.eventSeries.translations,
                locale
              )
            )
          : null;
        const badge = EVENT_STATUS_BADGE[getEventStatus(event, referenceNow)];
        return (
          <EventRow
            key={event.id}
            event={event}
            locale={locale}
            title={seriesName ?? eventName ?? evT("unknownEvent")}
            subtitle={seriesName && eventName ? eventName : null}
            slugSource={eventName}
            badgeLabel={evT(badge.labelKey)}
            badgeColor={badge.color}
          />
        );
      })}
    </ul>
  );
}
