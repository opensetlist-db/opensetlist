import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { staticAlternates } from "@/lib/seo/entityUrl";
import { getEventsListGrouped, type EventsListGroup } from "@/lib/events";
import { getEventStatus } from "@/lib/eventStatus";
import { eventHref } from "@/lib/eventHref";
import { displayNameWithFallback, resolveLocalizedField } from "@/lib/display";
import { formatDate, nonBlank } from "@/lib/utils";
import {
  FILTER_VALUES,
  type EventListFilter,
} from "@/lib/eventFilters";
import EventStatusTicker from "@/components/EventStatusTicker";
import { ConcertFilterNav } from "@/components/events/ConcertFilterNav";
import { ConcertGroup } from "@/components/events/ConcertGroup";
import { ConcertRow } from "@/components/events/ConcertRow";
import { Pagination } from "@/components/Pagination";
import { colors, radius } from "@/styles/tokens";

const PAST_GROUPS_PER_PAGE = 10;

// Approved list date (16-v1): full year + short month + day + weekday on
// every width — the old mobile month/day split dropped the year. UTC
// because startTime is stored in UTC and every other surface shows the
// same calendar day.
const ROW_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  weekday: "short",
  timeZone: "UTC",
};

function parseFilter(raw: string | undefined): EventListFilter {
  return (FILTER_VALUES as readonly string[]).includes(raw ?? "")
    ? (raw as EventListFilter)
    : "all";
}

function parsePage(raw: string | undefined): number {
  const n = parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

interface PreparedEvent {
  href: string;
  startTimeIso: string;
  status: ReturnType<typeof getEventStatus>;
  statusLabel: string;
  dateLabel: string;
  eventName: string;
  venueCity: string | null;
  songCountLabel: string | null;
  artTitle: string;
  logoUrl: string | null;
  tint: string | null;
}

interface PreparedGroup {
  key: string;
  // Pre-resolved title for the section header. Kind-specific:
  //   - series    → series's locale-resolved name
  //   - artist    → "{artist} — 단독 공연" (i18n template)
  //   - organizer → locale-resolved organizerName
  //   - ungrouped → locale "기타 이벤트"
  // Always non-empty (falls back to unknownArtist / ungrouped labels).
  groupTitle: string;
  artistShortName: string | null;
  typeLabel: string | null;
  hasOngoing: boolean;
  eventCountLabel: string;
  events: PreparedEvent[];
}

export default async function EventsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ filter?: string; pastPage?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const filter = parseFilter(sp.filter);
  const requestedPastPage = parsePage(sp.pastPage);

  const t = await getTranslations("Event");
  const tl = await getTranslations("EventList");
  const now = new Date();
  const { activeGroups, pastGroups } = await getEventsListGrouped(locale, now);

  const filterLabels: Record<EventListFilter, string> = {
    all: t("filter.all"),
    ongoing: t("filter.ongoing"),
    upcoming: t("filter.upcoming"),
    completed: t("filter.completed"),
  };
  // The ongoing pill reads "LIVE" (`Event.live`) rather than the
  // filter's "진행 중" so the badge stays distinct from the chip text,
  // as on the home hero.
  const liveLabel = t("live");
  const ungroupedName = t("ungrouped");
  const unknownEventName = t("unknownEvent");
  const unknownArtistName = t("unknownArtist");

  // Per-event filter applied to the active section (ongoing/upcoming
  // filters narrow events within their series; completed sends the
  // user to the past section instead).
  const eventStatusFilter: ReturnType<typeof getEventStatus> | null =
    filter === "ongoing"
      ? "ongoing"
      : filter === "upcoming"
        ? "upcoming"
        : null;

  const showActive = filter === "all" || filter === "ongoing" || filter === "upcoming";
  const showPast = filter === "all" || filter === "completed";

  function prepareEvent(
    ev: EventsListGroup["events"][number],
  ): PreparedEvent {
    const status = getEventStatus(ev, now);
    // Full localized event name, wrapped in full by the row (no
    // truncation — Day.1/Day.2 and long translations must stay
    // distinguishable).
    const eventName =
      nonBlank(displayNameWithFallback(ev, ev.translations, locale)) ??
      unknownEventName;
    const venue = resolveLocalizedField(
      ev,
      ev.translations,
      locale,
      "venue",
      "originalVenue",
    );
    const city = resolveLocalizedField(
      ev,
      ev.translations,
      locale,
      "city",
      "originalCity",
    );
    const venueCity =
      venue && city ? `${venue} · ${city}` : (venue ?? city);
    return {
      href: eventHref(locale, ev.id, ev.slug),
      startTimeIso: ev.startTime,
      status,
      statusLabel:
        status === "ongoing" ? liveLabel : tl(`status.${status}`),
      dateLabel: formatDate(ev.startTime, locale, ROW_DATE_FORMAT),
      eventName,
      venueCity,
      // Song count for completed (final tally) and ongoing (running
      // tally, same count as the home LiveHeroCard). Upcoming and
      // cancelled rows have no meaningful count yet.
      songCountLabel:
        status === "completed" || status === "ongoing"
          ? tl("songCount", { count: ev._count.setlistItems })
          : null,
      artTitle: ev.artTitle ?? eventName,
      logoUrl: ev.logo.image?.url ?? null,
      tint: ev.logo.color,
    };
  }

  function resolveGroupTitle(g: EventsListGroup): string {
    switch (g.kind) {
      case "series":
        return g.title ?? ungroupedName;
      case "artist":
        // Wrap the locale-resolved artist name in the "단독 공연"
        // template so each artist's series-less shows read as their
        // own bucket (e.g. "하스노소라 — 단독 공연"). Falls back to
        // the unknown-artist label if displayNameWithFallback
        // returned empty for the locale + original chain.
        return t("standaloneTitle", { artist: g.title ?? unknownArtistName });
      case "organizer":
        // Locale-resolved at the lib layer (EventTranslation.
        // organizerName → original). Empty-string organizerName is
        // filtered out there (falls through to ungrouped), so a
        // non-null title here is always a meaningful display value.
        return g.title ?? ungroupedName;
      case "ungrouped":
        return ungroupedName;
    }
  }

  function prepareGroup(
    g: EventsListGroup,
    keyPrefix: string,
  ): PreparedGroup | null {
    const filteredEvents = eventStatusFilter
      ? g.events.filter(
          (ev) => getEventStatus(ev, now) === eventStatusFilter,
        )
      : g.events;
    if (filteredEvents.length === 0) return null;
    return {
      key: `${keyPrefix}-${g.id}`,
      groupTitle: resolveGroupTitle(g),
      artistShortName: g.artistShortName,
      // Only tour and festival carry a tag (approved design); the other
      // series types get no invented label.
      typeLabel:
        g.seriesType === "concert_tour" || g.seriesType === "festival"
          ? tl(`seriesType.${g.seriesType}`)
          : null,
      hasOngoing: g.hasOngoing && (eventStatusFilter !== "upcoming"),
      eventCountLabel: tl("eventCount", { count: filteredEvents.length }),
      events: filteredEvents.map(prepareEvent),
    };
  }

  const preparedActive: PreparedGroup[] = showActive
    ? activeGroups
        .map((g) => prepareGroup(g, "active"))
        .filter((g): g is PreparedGroup => g !== null)
    : [];

  // Group-level pagination on past (multi-day tours never split across
  // pages — paginate the array of groups, not individual events).
  const allPastPrepared: PreparedGroup[] = showPast
    ? pastGroups
        .map((g) => prepareGroup(g, "past"))
        .filter((g): g is PreparedGroup => g !== null)
    : [];
  const pastTotalPages = Math.max(
    1,
    Math.ceil(allPastPrepared.length / PAST_GROUPS_PER_PAGE),
  );
  const pastPage = Math.min(requestedPastPage, pastTotalPages);
  const pastSlice = allPastPrepared.slice(
    (pastPage - 1) * PAST_GROUPS_PER_PAGE,
    pastPage * PAST_GROUPS_PER_PAGE,
  );

  const isEmpty = preparedActive.length === 0 && allPastPrepared.length === 0;

  // Keep `?filter=` on Pagination links so the user's filter survives
  // page navigation. Drop the param when filter is "all" so the URL
  // stays clean at the default.
  const paginationOtherParams: Record<string, string> =
    filter === "all" ? {} : { filter };

  const renderGroup = (g: PreparedGroup) => (
    <ConcertGroup
      key={g.key}
      title={g.groupTitle}
      artistTag={g.artistShortName}
      typeLabel={g.typeLabel}
      countLabel={g.eventCountLabel}
      live={g.hasOngoing}
      liveLabel={liveLabel}
      collapseLabel={tl("collapseGroup", { title: g.groupTitle })}
      expandLabel={tl("expandGroup", { title: g.groupTitle })}
    >
      {g.events.map((e) => (
        <ConcertRow
          key={e.href}
          href={e.href}
          title={e.eventName}
          venueCity={e.venueCity}
          startTimeIso={e.startTimeIso}
          dateLabel={e.dateLabel}
          status={e.status}
          statusLabel={e.statusLabel}
          songCountLabel={e.songCountLabel}
          artTitle={e.artTitle}
          logoUrl={e.logoUrl}
          tint={e.tint}
        />
      ))}
    </ConcertGroup>
  );

  const sectionTitleClass =
    "mb-4 mt-[30px] text-[19px] font-bold min-[700px]:text-[21px]";

  return (
    <main className="flex-1" style={{ background: colors.bgPage }}>
      <div className="mx-auto min-h-[60vh] w-full max-w-[1200px] px-4 pb-10 pt-7 min-[700px]:p-8 min-[1264px]:px-0 min-[1264px]:pb-16 min-[1264px]:pt-10">
        <header>
          <p
            className="m-0 text-[12px] font-bold tracking-[0.12em]"
            style={{ color: colors.primary }}
          >
            {tl("eyebrow")}
          </p>
          <h1
            className="mb-2.5 mt-1 text-[26px] font-bold leading-[1.4] tracking-[-0.03em] min-[700px]:text-[32px]"
            style={{ color: colors.textPrimary }}
          >
            {tl("title")}
          </h1>
          <p
            className="m-0 text-[14px] min-[700px]:text-[15px]"
            style={{ color: colors.textSecondary }}
          >
            {tl("subtitle")}
          </p>
        </header>

        <ConcertFilterNav
          locale={locale}
          active={filter}
          labels={filterLabels}
          label={tl("filterLabel")}
        />

        {isEmpty ? (
          <div
            className="border px-6 py-8 text-center"
            style={{
              background: colors.bgCard,
              borderColor: colors.border,
              borderRadius: radius.card,
            }}
          >
            <h2
              className="m-0 text-[18px] font-bold"
              style={{ color: colors.textPrimary }}
            >
              {tl("empty")}
            </h2>
            {filter !== "all" && (
              <p className="mb-0 mt-4">
                <Link
                  href={`/${locale}/events`}
                  className="inline-flex min-h-11 items-center rounded-full border px-5 text-[14px] font-bold"
                  style={{
                    borderColor: colors.borderStrong,
                    color: colors.textPrimary,
                    background: colors.bgCard,
                  }}
                >
                  {tl("viewAll")}
                </Link>
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Page-level boundary ticker: one router.refresh per
                upcoming/ongoing active event at its next status
                boundary. Past events skip — terminal states have no
                further boundary to cross. */}
            {preparedActive
              .flatMap((g) => g.events)
              .filter(
                (e) => e.status === "upcoming" || e.status === "ongoing",
              )
              .map((e) => (
                <EventStatusTicker
                  key={`ticker-${e.href}`}
                  startTime={e.startTimeIso}
                />
              ))}

            {preparedActive.length > 0 && (
              <>
                <h2
                  className={sectionTitleClass}
                  style={{ color: colors.textPrimary }}
                >
                  {tl("activeHeading")}
                </h2>
                {preparedActive.map(renderGroup)}
              </>
            )}

            {pastSlice.length > 0 && (
              <>
                <h2
                  className={sectionTitleClass}
                  style={{ color: colors.textPrimary }}
                >
                  {tl("pastHeading")}
                </h2>
                {pastSlice.map(renderGroup)}
                <Pagination
                  currentPage={pastPage}
                  totalPages={pastTotalPages}
                  pageParamKey="pastPage"
                  otherParams={paginationOtherParams}
                  labels={{
                    nav: tl("pastHeading"),
                    prev: tl("prev"),
                    next: tl("next"),
                    status: tl("pageStatus", {
                      current: pastPage,
                      total: pastTotalPages,
                    }),
                  }}
                />
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "EventList" });
  return {
    title: t("title"),
    // Canonical is the unfiltered list; filter query params
    // (`?filter=…`, `?pastPage=…`) consolidate onto it.
    alternates: staticAlternates(locale, "/events"),
  };
}
