import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, nonBlank, slugify } from "@/lib/utils";
import { displayNameWithFallback, resolveLocalizedField } from "@/lib/display";
import { LiveHeroCard } from "@/components/home/LiveHeroCard";
import { UpcomingCard } from "@/components/home/UpcomingCard";
import { RecentEventRow } from "@/components/home/RecentEventRow";
import { SectionHeader } from "@/components/home/SectionHeader";
import { BASE_URL } from "@/lib/config";
import { routing } from "@/i18n/routing";
import { colors, shadows } from "@/styles/tokens";

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

const HOME_TAKE = 5;
const ONGOING_BUFFER_MS = 12 * 60 * 60 * 1000;
// Home is the "near future / near past" surface; full-range browsing
// lives on /[locale]/events. Bound upcoming + recent queries to a
// ±30-day window so the home stays relevant even when the catalog has
// long-tail events that would otherwise dominate take(5).
const HOME_WINDOW_DAYS = 30;

const LOCALE_MAP: Record<string, string> = {
  ko: "ko-KR",
  ja: "ja-JP",
  en: "en-US",
  "zh-CN": "zh-CN",
};

// UTC day boundary — never use server-local time to bucket UTC-stored
// dates (CLAUDE.md §"Date & Time"). Both `now` and `event.startTime`
// must be anchored to UTC midnight before subtracting, otherwise an
// event at 23:59 UTC on D-1 reads as today/tomorrow depending on the
// server's offset.
function utcDayStart(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

// UTC day at `now + days` for window bounds. Anchoring on UTC midnight
// (not `now ± Nd` time offset) keeps the window edges stable across
// regions — otherwise the inclusion of an event on the 30th day drifts
// by the server's running time-of-day.
function utcDayOffset(d: Date, days: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days)
  );
}

function daysUntilUTC(target: Date, now: Date): number {
  const diff = utcDayStart(target).getTime() - utcDayStart(now).getTime();
  return Math.round(diff / 86400000);
}

function eventHref(
  locale: string,
  id: number | bigint,
  slugSource: string | null
): string {
  // slugSource may be all-punctuation (`!!!`); slugify strips it to "" and
  // we'd emit `/events/{id}/`. Branch on the slug, not the source.
  const slug = slugSource ? slugify(slugSource) : "";
  return slug
    ? `/${locale}/events/${id}/${slug}`
    : `/${locale}/events/${id}`;
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
          // Mirror getEventStatus: an event with startTime === now-12h has
          // ongoingEnd === now, classified as completed — exclude it here
          // (`gt`), include it in the completed query (`lte`).
          startTime: { gt: ongoingStart, lte: now },
        },
      ],
    },
    include: {
      translations: true,
      eventSeries: { include: { translations: true } },
      _count: { select: { setlistItems: true } },
    },
    orderBy: { startTime: "asc" },
  });
  return serializeBigInt(events);
}

async function getUpcomingEvents(now: Date) {
  // End-exclusive: "events scheduled before the start of day +31",
  // i.e. all events up to and including the 30-days-from-today UTC day.
  const upcomingCutoff = utcDayOffset(now, HOME_WINDOW_DAYS + 1);
  const events = await prisma.event.findMany({
    where: {
      isDeleted: false,
      status: "scheduled",
      startTime: { gt: now, lt: upcomingCutoff },
    },
    include: {
      translations: true,
      eventSeries: { include: { translations: true } },
    },
    orderBy: { startTime: "asc" },
    take: HOME_TAKE,
  });
  return serializeBigInt(events);
}

async function getRecentEvents(now: Date) {
  const completedCutoff = new Date(now.getTime() - ONGOING_BUFFER_MS);
  // Inclusive: events starting on or after the start of the UTC day
  // that is `HOME_WINDOW_DAYS` days before today.
  const windowStart = utcDayOffset(now, -HOME_WINDOW_DAYS);
  const events = await prisma.event.findMany({
    where: {
      isDeleted: false,
      startTime: { gte: windowStart },
      OR: [
        { status: "completed" },
        { status: "scheduled", startTime: { lte: completedCutoff } },
      ],
    },
    include: {
      translations: true,
      eventSeries: { include: { translations: true } },
      _count: { select: { setlistItems: true } },
    },
    orderBy: { startTime: "desc" },
    take: HOME_TAKE,
  });
  return serializeBigInt(events);
}

type OngoingEvent = Awaited<ReturnType<typeof getOngoingEvents>>[number];
type UpcomingEvent = Awaited<ReturnType<typeof getUpcomingEvents>>[number];
type RecentEvent = Awaited<ReturnType<typeof getRecentEvents>>[number];

interface OngoingView {
  href: string;
  startTimeIso: string;
  seriesName: string | null;
  eventName: string;
  venue: string | null;
  songCountLabel: string;
}

interface UpcomingView {
  href: string;
  startTimeIso: string;
  seriesName: string | null;
  eventName: string;
  venue: string | null;
  formattedDate: string;
  dDayLabel: string;
}

interface RecentView {
  href: string;
  seriesName: string | null;
  eventName: string;
  venue: string | null;
  songCountLabel: string;
  monthLabel: string;
  dayNumber: string;
}

function projectNames(
  event: { translations: { locale: string; name: string; shortName: string | null }[] } & {
    originalName: string | null;
    originalShortName: string | null;
    originalLanguage: string;
    eventSeries: {
      translations: { locale: string; name: string; shortName: string | null }[];
      originalName: string | null;
      originalShortName: string | null;
      originalLanguage: string;
    } | null;
  },
  locale: string
): { eventName: string; seriesName: string | null } {
  const eventName =
    nonBlank(displayNameWithFallback(event, event.translations, locale, "short")) ?? "";
  const seriesName = event.eventSeries
    ? nonBlank(
        displayNameWithFallback(
          event.eventSeries,
          event.eventSeries.translations,
          locale,
          "short"
        )
      )
    : null;
  return { eventName, seriesName };
}

function projectVenue(
  event: {
    translations: {
      locale: string;
      name: string;
      shortName: string | null;
      venue?: string | null;
    }[];
    originalVenue: string | null;
  },
  locale: string
): string | null {
  return resolveLocalizedField(
    event,
    event.translations,
    locale,
    "venue",
    "originalVenue"
  );
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("Home");
  const evT = await getTranslations("Event");

  // Single `now` shared across all three queries so an event near a
  // bucket boundary can't get classified inconsistently between sections.
  const now = new Date();
  const intlLocale = LOCALE_MAP[locale] ?? locale;
  const upcomingDateFmt = new Intl.DateTimeFormat(intlLocale, {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  });
  const recentMonthFmt = new Intl.DateTimeFormat(intlLocale, {
    month: "short",
    timeZone: "UTC",
  });

  const [ongoingEvents, upcomingEvents, recentEvents] = await Promise.all([
    getOngoingEvents(now),
    getUpcomingEvents(now),
    getRecentEvents(now),
  ]);

  // Prisma's runtime row has `startTime: Date`, but `serializeBigInt`
  // round-trips through JSON so values arrive here as strings. TS still
  // sees the Prisma type — `new Date(...).toISOString()` works on either,
  // so callers downstream get a stable ISO string regardless.
  const toIso = (v: Date | string): string =>
    typeof v === "string" ? v : v.toISOString();

  const ongoingViews: OngoingView[] = ongoingEvents.map((e: OngoingEvent) => {
    const { eventName, seriesName } = projectNames(e, locale);
    return {
      href: eventHref(locale, e.id, eventName),
      startTimeIso: toIso(e.startTime),
      seriesName,
      eventName: eventName || evT("unknownEvent"),
      venue: projectVenue(e, locale),
      songCountLabel: t("songCountOngoing", {
        count: e._count.setlistItems,
      }),
    };
  });

  const upcomingViews: UpcomingView[] = upcomingEvents.map(
    (e: UpcomingEvent) => {
      const { eventName, seriesName } = projectNames(e, locale);
      const start = new Date(e.startTime);
      return {
        href: eventHref(locale, e.id, eventName),
        startTimeIso: toIso(e.startTime),
        seriesName,
        eventName: eventName || evT("unknownEvent"),
        venue: projectVenue(e, locale),
        formattedDate: upcomingDateFmt.format(start),
        dDayLabel: t("dDay", { days: daysUntilUTC(start, now) }),
      };
    }
  );

  const recentViews: RecentView[] = recentEvents.map((e: RecentEvent) => {
    const { eventName, seriesName } = projectNames(e, locale);
    const start = new Date(e.startTime);
    return {
      href: eventHref(locale, e.id, eventName),
      seriesName,
      eventName: eventName || evT("unknownEvent"),
      venue: projectVenue(e, locale),
      songCountLabel: t("songCount", { count: e._count.setlistItems }),
      monthLabel: recentMonthFmt.format(start),
      dayNumber: String(start.getUTCDate()),
    };
  });

  const isEmpty =
    ongoingViews.length === 0 &&
    upcomingViews.length === 0 &&
    recentViews.length === 0;

  return (
    <main
      className="flex-1"
      style={{ background: colors.bgPage }}
    >
      <div className="mx-auto max-w-[480px] px-4 pb-15 pt-4 lg:max-w-[960px] lg:px-10 lg:pt-7 lg:pb-15">
        {isEmpty ? (
          <p
            className="py-20 text-center text-sm"
            style={{ color: colors.textMuted }}
          >
            {t("noEvents")}
          </p>
        ) : (
          <div className="lg:grid lg:grid-cols-[1fr_340px] lg:items-start lg:gap-6">
            <div>
              {ongoingViews.length > 0 && (
                <section className="mb-6 lg:mb-7">
                  <SectionHeader title={t("ongoingTitle")} />
                  <div className="flex flex-col gap-3">
                    {ongoingViews.map((v, i) => (
                      <LiveHeroCard
                        key={i}
                        href={v.href}
                        startTimeIso={v.startTimeIso}
                        seriesName={v.seriesName}
                        eventName={v.eventName}
                        venue={v.venue}
                        liveLabel={evT("live")}
                        liveSubtitle={t("ongoingSubtitle")}
                        songCountLabel={v.songCountLabel}
                      />
                    ))}
                  </div>
                </section>
              )}

              {upcomingViews.length > 0 && (
                <section className="mb-6 lg:hidden">
                  <SectionHeader
                    title={t("upcomingTitle")}
                    link={{
                      href: `/${locale}/events`,
                      label: t("viewAllEvents"),
                    }}
                  />
                  <div
                    className="flex gap-2.5 overflow-x-auto pb-1"
                    style={{
                      scrollbarWidth: "none",
                      WebkitOverflowScrolling: "touch",
                    }}
                  >
                    {upcomingViews.map((v) => (
                      <UpcomingCard
                        key={v.href}
                        href={v.href}
                        startTimeIso={v.startTimeIso}
                        seriesName={v.seriesName}
                        eventName={v.eventName}
                        venue={v.venue}
                        formattedDate={v.formattedDate}
                        dDayLabel={v.dDayLabel}
                        variant="scroll"
                      />
                    ))}
                  </div>
                </section>
              )}

              {recentViews.length > 0 && (
                <section>
                  <SectionHeader title={t("recentTitle")} />
                  <div
                    className="overflow-hidden"
                    style={{
                      background: colors.bgCard,
                      borderRadius: 16,
                      boxShadow: shadows.card,
                    }}
                  >
                    {recentViews.map((v, i) => (
                      <RecentEventRow
                        key={v.href}
                        href={v.href}
                        seriesName={v.seriesName}
                        eventName={v.eventName}
                        venue={v.venue}
                        songCountLabel={v.songCountLabel}
                        monthLabel={v.monthLabel}
                        dayNumber={v.dayNumber}
                        isLast={i === recentViews.length - 1}
                      />
                    ))}
                  </div>
                  <div className="mt-3 text-center">
                    <Link
                      href={`/${locale}/events`}
                      className="text-[13px] font-semibold"
                      style={{ color: colors.primary }}
                    >
                      {t("viewAllEvents")}
                    </Link>
                  </div>
                </section>
              )}
            </div>

            {upcomingViews.length > 0 && (
              <aside className="hidden lg:sticky lg:top-[72px] lg:block">
                <SectionHeader
                  title={t("upcomingTitle")}
                  link={{
                    href: `/${locale}/events`,
                    label: t("viewAllSchedule"),
                  }}
                />
                <div className="flex flex-col gap-2.5">
                  {upcomingViews.map((v) => (
                    <UpcomingCard
                      key={v.href}
                      href={v.href}
                      startTimeIso={v.startTimeIso}
                      seriesName={v.seriesName}
                      eventName={v.eventName}
                      venue={v.venue}
                      formattedDate={v.formattedDate}
                      dDayLabel={v.dDayLabel}
                      variant="stack"
                    />
                  ))}
                  <div className="mt-1 text-center">
                    <Link
                      href={`/${locale}/events`}
                      className="text-[13px] font-semibold"
                      style={{ color: colors.primary }}
                    >
                      {t("viewAllSchedule")}
                    </Link>
                  </div>
                </div>
              </aside>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
