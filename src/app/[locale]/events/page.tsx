import { getTranslations } from "next-intl/server";
import { getEventsListGrouped, type EventsListGroup } from "@/lib/events";
import { getEventStatus } from "@/lib/eventStatus";
import { eventHref } from "@/lib/eventHref";
import { displayNameWithFallback, resolveLocalizedField } from "@/lib/display";
import { formatDate, nonBlank, HISTORY_ROW_DATE_FORMAT } from "@/lib/utils";
import { FilterBar } from "@/components/events/FilterBar";
import {
  FILTER_VALUES,
  type EventListFilter,
} from "@/lib/eventFilters";
import EventStatusTicker from "@/components/EventStatusTicker";
import { SeriesSection } from "@/components/events/SeriesSection";
import { SeriesBlock } from "@/components/events/SeriesBlock";
import { EventRow } from "@/components/events/EventRow";
import { EventTableRow } from "@/components/events/EventTableRow";
import { Pagination } from "@/components/Pagination";
import { colors } from "@/styles/tokens";

const PAST_GROUPS_PER_PAGE = 10;

const MOBILE_MONTH_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  timeZone: "UTC",
};
const MOBILE_DAY_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  timeZone: "UTC",
};
// Desktop format hoisted to `HISTORY_ROW_DATE_FORMAT` in lib/utils so
// the artist / member / song history surfaces share one definition
// with the event list. Mobile formats stay local — they're a unique
// two-row month-and-day split that no other surface uses.

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
  monthLabel: string;
  dayNumber: string;
  shortDate: string;
  eventName: string;
  venueCity: string | null;
  songCountLabel: string | null;
}

interface PreparedGroup {
  key: string;
  seriesName: string;
  artistShortName: string | null;
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
  const now = new Date();
  const { activeGroups, pastGroups } = await getEventsListGrouped(locale, now);

  const filterLabels: Record<EventListFilter, string> = {
    all: t("filter.all"),
    ongoing: t("filter.ongoing"),
    upcoming: t("filter.upcoming"),
    completed: t("filter.completed"),
  };
  const tableHeader = {
    date: t("tableHeader.date"),
    status: t("tableHeader.status"),
    name: t("tableHeader.name"),
    venue: t("tableHeader.venue"),
    songs: t("tableHeader.songs"),
  };
  // The ongoing badge uses the dedicated `Event.live` ("LIVE") label
  // rather than `Event.status.ongoing` ("진행 중") — matches the mockup
  // and the home page's hero pill, and stays visually distinct from
  // the FilterBar's "진행 중" chip text (same locale string post-#159
  // i18n unification, so a separate "LIVE" word keeps badge ≠ chip).
  const liveLabel = t("live");
  const ungroupedName = t("ungrouped");
  const unknownEventName = t("unknownEvent");

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
    const start = new Date(ev.startTime);
    const status = getEventStatus(ev, now);
    // Full localized event name (project rule: `full` is the
    // default everywhere that isn't a breadcrumb or a "short
    // because the page already shows full" exception). Long names
    // truncate at the row's column width via the row's CSS.
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
      href: eventHref(locale, ev.id, eventName),
      startTimeIso: ev.startTime,
      status,
      // Per-row badge: "LIVE" for ongoing (matches mockup); locale
      // status text for upcoming/completed/cancelled.
      statusLabel:
        status === "ongoing" ? t("live") : t(`status.${status}`),
      monthLabel: formatDate(start, locale, MOBILE_MONTH_FORMAT),
      dayNumber: formatDate(start, locale, MOBILE_DAY_FORMAT),
      shortDate: formatDate(start, locale, HISTORY_ROW_DATE_FORMAT),
      eventName,
      venueCity,
      // Show the song count for both completed events (final
       // tally) and ongoing events (running tally — matches the
       // home page's LiveHeroCard, which displays the same count
       // for the in-progress show). Upcoming and cancelled rows
       // stay null since there's no meaningful count yet.
      songCountLabel:
        status === "completed" || status === "ongoing"
          ? t("songCount", { count: ev._count.setlistItems })
          : null,
    };
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
      key: `${keyPrefix}-${g.seriesId ?? "ungrouped"}`,
      seriesName: g.seriesName ?? ungroupedName,
      artistShortName: g.artistShortName,
      hasOngoing: g.hasOngoing && (eventStatusFilter !== "upcoming"),
      eventCountLabel: t("eventCount", { count: filteredEvents.length }),
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

  return (
    <main className="flex-1" style={{ background: colors.bgPage }}>
      <div className="mx-auto max-w-[480px] px-4 pb-15 pt-4 lg:max-w-[960px] lg:px-10 lg:pt-7 lg:pb-15">
        <header className="mb-4 lg:mb-6">
          <h1
            className="text-[20px] font-bold lg:text-[24px]"
            style={{
              color: colors.textPrimary,
              letterSpacing: "-0.01em",
              marginBottom: 4,
            }}
          >
            {t("allEvents")}
          </h1>
          <p
            className="text-[13px]"
            style={{ color: colors.textMuted }}
          >
            {t("subtitle")}
          </p>
        </header>

        <FilterBar active={filter} labels={filterLabels} />

        {isEmpty ? (
          <p
            className="py-12 text-center text-sm"
            style={{ color: colors.textMuted }}
          >
            {t("emptyFilterState")}
          </p>
        ) : (
          <>
            {/* Page-level boundary ticker. Mobile + desktop trees are
                both server-rendered and toggled by Tailwind responsive
                classes, so per-row mounts would schedule duplicate
                `setTimeout` callbacks (one for the EventRow, one for
                the EventTableRow). Lift to the page so each
                upcoming/ongoing event gets exactly one router.refresh
                scheduled at its boundary. Past events skip — terminal
                states have no further boundary to cross. */}
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

            {/* Active series */}
            {preparedActive.length > 0 && (
              <>
                {/* Mobile */}
                <div className="lg:hidden">
                  {preparedActive.map((g) => (
                    <SeriesSection
                      key={g.key}
                      seriesName={g.seriesName}
                      artistShortName={g.artistShortName}
                      hasOngoing={g.hasOngoing}
                      eventCountLabel={g.eventCountLabel}
                      liveLabel={liveLabel}
                    >
                      {g.events.map((e, i) => (
                        <EventRow
                          key={e.href}
                          href={e.href}
                          status={e.status}
                          statusLabel={e.statusLabel}
                          monthLabel={e.monthLabel}
                          dayNumber={e.dayNumber}
                          eventName={e.eventName}
                          venueCity={e.venueCity}
                          songCountLabel={e.songCountLabel}
                          isLast={i === g.events.length - 1}
                        />
                      ))}
                    </SeriesSection>
                  ))}
                </div>
                {/* Desktop */}
                <div className="hidden lg:block">
                  {preparedActive.map((g) => (
                    <SeriesBlock
                      key={g.key}
                      seriesName={g.seriesName}
                      artistShortName={g.artistShortName}
                      hasOngoing={g.hasOngoing}
                      eventCountLabel={g.eventCountLabel}
                      liveLabel={liveLabel}
                      tableHeader={tableHeader}
                    >
                      {g.events.map((e) => (
                        <EventTableRow
                          key={e.href}
                          href={e.href}
                          status={e.status}
                          statusLabel={e.statusLabel}
                          shortDate={e.shortDate}
                          eventName={e.eventName}
                          venueCity={e.venueCity}
                          songCountLabel={e.songCountLabel}
                        />
                      ))}
                    </SeriesBlock>
                  ))}
                </div>
              </>
            )}

            {/* Past series */}
            {pastSlice.length > 0 && (
              <>
                <div className="lg:hidden">
                  {pastSlice.map((g) => (
                    <SeriesSection
                      key={g.key}
                      seriesName={g.seriesName}
                      artistShortName={g.artistShortName}
                      hasOngoing={g.hasOngoing}
                      eventCountLabel={g.eventCountLabel}
                      liveLabel={liveLabel}
                    >
                      {g.events.map((e, i) => (
                        <EventRow
                          key={e.href}
                          href={e.href}
                          status={e.status}
                          statusLabel={e.statusLabel}
                          monthLabel={e.monthLabel}
                          dayNumber={e.dayNumber}
                          eventName={e.eventName}
                          venueCity={e.venueCity}
                          songCountLabel={e.songCountLabel}
                          isLast={i === g.events.length - 1}
                        />
                      ))}
                    </SeriesSection>
                  ))}
                </div>
                <div className="hidden lg:block">
                  {pastSlice.map((g) => (
                    <SeriesBlock
                      key={g.key}
                      seriesName={g.seriesName}
                      artistShortName={g.artistShortName}
                      hasOngoing={g.hasOngoing}
                      eventCountLabel={g.eventCountLabel}
                      liveLabel={liveLabel}
                      tableHeader={tableHeader}
                    >
                      {g.events.map((e) => (
                        <EventTableRow
                          key={e.href}
                          href={e.href}
                          status={e.status}
                          statusLabel={e.statusLabel}
                          shortDate={e.shortDate}
                          eventName={e.eventName}
                          venueCity={e.venueCity}
                          songCountLabel={e.songCountLabel}
                        />
                      ))}
                    </SeriesBlock>
                  ))}
                </div>
                {pastTotalPages > 1 && (
                  <Pagination
                    currentPage={pastPage}
                    totalPages={pastTotalPages}
                    pageParamKey="pastPage"
                    otherParams={paginationOtherParams}
                  />
                )}
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
  const t = await getTranslations({ locale, namespace: "Event" });
  return { title: t("allEvents") };
}
