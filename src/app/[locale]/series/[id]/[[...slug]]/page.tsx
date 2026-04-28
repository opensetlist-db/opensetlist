import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
// Two `Link` imports for two purposes:
//   - `IntlLink` (`@/i18n/navigation`) for intra-app paths that are
//     locale-FREE (the i18n Link auto-prepends locale): childSeries +
//     parentSeries breadcrumb hops.
//   - `Link` (`next/link`) for paths that already include the locale
//     prefix from `eventHref(locale, ...)`: leg event rows + the LIVE
//     banner. Using the i18n Link with a locale-prefixed href would
//     double-prefix as `/ko/ko/events/...`.
import { Link as IntlLink } from "@/i18n/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, formatDate } from "@/lib/utils";
import {
  displayNameWithFallback,
  displayOriginalName,
  displayOriginalTitle,
  resolveLocalizedField,
} from "@/lib/display";
import { getEventStatus, type ResolvedEventStatus } from "@/lib/eventStatus";
import { eventHref } from "@/lib/eventHref";
import {
  groupByCity,
  type SeriesEventInput,
  type Leg,
} from "@/lib/seriesGrouping";
import { getSeriesStats } from "@/lib/seriesStats";
import { formatDateRange } from "@/lib/dateRange";
import { BRAND_GRADIENT } from "@/lib/artistColor";
import { Breadcrumb, type BreadcrumbItem } from "@/components/Breadcrumb";
import { InfoCard } from "@/components/InfoCard";
import { TabBar } from "@/components/TabBar";
import { SectionLabel } from "@/components/SectionLabel";
import { StatusBadge } from "@/components/StatusBadge";
import {
  LegCard,
  type PreparedLeg,
  type PreparedLegEvent,
} from "@/components/series/LegCard";
import { colors, gradients, layout, radius, shadows } from "@/styles/tokens";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};

const TABS = ["schedule", "songs"] as const;
type TabKey = (typeof TABS)[number];

function resolveTab(value: string | string[] | undefined): TabKey {
  const v = Array.isArray(value) ? value[0] : value;
  return TABS.includes(v as TabKey) ? (v as TabKey) : "schedule";
}

const SHORT_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "long",
  day: "numeric",
  timeZone: "UTC",
};

async function getEventSeries(id: bigint) {
  const series = await prisma.eventSeries.findFirst({
    where: { id, isDeleted: false },
    include: {
      translations: true,
      artist: { include: { translations: true } },
      parentSeries: { include: { translations: true } },
      childSeries: {
        where: { isDeleted: false },
        include: { translations: true },
        orderBy: { createdAt: "asc" },
      },
      events: {
        where: { isDeleted: false },
        include: { translations: true },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
      },
    },
  });
  if (!series) return null;
  return serializeBigInt(series);
}

/**
 * Aggregate song appearance counts across the series's completed
 * events. Two queries: groupBy gets the (songId, count) tuples, then a
 * findMany hydrates the song shapes (with translations + primary
 * artist) for the rows the page actually renders. Phase 1A scale
 * (~60 events) — profile before optimizing.
 */
async function getSongAppearances(completedEventIds: bigint[]) {
  if (completedEventIds.length === 0)
    return [] as Array<{
      songId: string;
      count: number;
      song: SongRowHydrated | null;
    }>;
  const counts = await prisma.setlistItemSong.groupBy({
    by: ["songId"],
    where: {
      setlistItem: {
        eventId: { in: completedEventIds },
        isDeleted: false,
      },
    },
    _count: { songId: true },
    orderBy: { _count: { songId: "desc" } },
  });

  const songIds = counts.map((c) => c.songId);
  const songs = await prisma.song.findMany({
    where: { id: { in: songIds }, isDeleted: false },
    include: {
      translations: true,
      artists: {
        where: { role: "primary" },
        include: { artist: { include: { translations: true } } },
        take: 1,
      },
    },
  });

  // Build the lookup map keyed off the RAW BigInt rows. `String(BigInt)`
  // is exact for any magnitude; `String(serializedNumber)` would lose
  // bits for IDs > 2^53 because `serializeBigInt` narrows to JS
  // `number` first. Both `c.songId` (groupBy result) and `s.id` (raw
  // row) are BigInt at this point, so the keys match by construction.
  const rawById = new Map(songs.map((s) => [String(s.id), s] as const));

  return counts.map((c) => {
    const raw = rawById.get(String(c.songId));
    return {
      songId: String(c.songId),
      count: c._count.songId,
      // Per-row serialize: cheap (small song counts at Phase 1A scale)
      // and keeps the lookup key precision-safe.
      song: raw ? (serializeBigInt(raw) as unknown as SongRowHydrated) : null,
    };
  });
}

type SongRowHydrated = {
  id: number;
  originalTitle: string;
  originalLanguage: string;
  variantLabel: string | null;
  translations: Array<{
    locale: string;
    title: string;
    variantLabel: string | null;
  }>;
  artists: Array<{
    artist: {
      id: number;
      type: string;
      originalName: string | null;
      originalShortName: string | null;
      originalLanguage: string;
      translations: Array<{
        locale: string;
        name: string;
        shortName: string | null;
      }>;
    };
  }>;
};

/**
 * Distinct unit-type artists that have performed any song in this
 * series. Source: SetlistItemArtist (per-song artist credit) ∩
 * `Artist.type === "unit"`. Maps to the mockup's "참여 유닛" list —
 * units actually surface once their first set appears.
 */
async function getSeriesUnits(allEventIds: bigint[]) {
  if (allEventIds.length === 0) return [];
  const links = await prisma.setlistItemArtist.findMany({
    where: {
      setlistItem: { eventId: { in: allEventIds }, isDeleted: false },
      artist: { type: "unit", isDeleted: false },
    },
    select: { artistId: true },
    distinct: ["artistId"],
  });
  if (links.length === 0) return [];
  const units = await prisma.artist.findMany({
    where: { id: { in: links.map((l) => l.artistId) }, isDeleted: false },
    include: { translations: true },
  });
  return serializeBigInt(units);
}

export async function generateMetadata({
  params,
}: Props): Promise<Metadata> {
  const { locale, id } = await params;
  if (!/^\d+$/.test(id)) return { title: "Not Found" };
  const series = await getEventSeries(BigInt(id));
  if (!series) return { title: "Not Found" };
  const seriesName = displayNameWithFallback(
    series,
    series.translations,
    locale,
    "full",
  );
  const description = resolveLocalizedField(
    series,
    series.translations,
    locale,
    "description",
    "originalDescription",
  );
  return {
    title: seriesName ? `${seriesName} | OpenSetlist` : "OpenSetlist",
    description: description ?? undefined,
  };
}

export default async function EventSeriesPage({
  params,
  searchParams,
}: Props) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const activeTab = resolveTab(sp.tab);

  if (!/^\d+$/.test(id)) notFound();
  const seriesId = BigInt(id);
  const series = await getEventSeries(seriesId);
  if (!series) notFound();

  const t = await getTranslations("EventSeries");
  const ct = await getTranslations("Common");
  const evT = await getTranslations("Event");

  // Pin one reference instant so every getEventStatus() call within
  // this render uses the same `now`. Otherwise an event near a
  // boundary could be classified inconsistently between sections.
  const referenceNow = new Date();

  // ── Display strings ─────────────────────────────────────
  const { main: seriesMain, sub: seriesSub } = displayOriginalName(
    series,
    series.translations,
    locale,
  );
  const description = resolveLocalizedField(
    series,
    series.translations,
    locale,
    "description",
    "originalDescription",
  );
  const artistName = series.artist
    ? displayNameWithFallback(
        series.artist,
        series.artist.translations,
        locale,
      )
    : null;
  const parentName = series.parentSeries
    ? displayNameWithFallback(
        series.parentSeries,
        series.parentSeries.translations,
        locale,
      )
    : null;

  // Status labels used by both LegCard and inline badges. `ongoing`
  // uses `Event.live` ("LIVE") to match the home + events-list
  // convention; the others use the per-status localized text.
  const statusLabels: Record<ResolvedEventStatus, string> = {
    ongoing: evT("live"),
    upcoming: evT("status.upcoming"),
    completed: evT("status.completed"),
    cancelled: evT("status.cancelled"),
  };

  // ── Stats + legs ─────────────────────────────────────────
  // Single cast for the post-`serializeBigInt` shape. TypeScript sees
  // Prisma's pre-serialize types (bigint id, Date startTime) through
  // `serializeBigInt<T>(obj: T): T`'s identity signature, but at
  // runtime BigInt is narrowed to `number` and Date round-trips to ISO
  // string. The `as unknown as` step is intentional and acknowledged
  // here so downstream usage stays cast-free.
  const events = series.events as unknown as SeriesEventInput[];

  const stats = getSeriesStats(events, locale, referenceNow);
  const legs: Leg[] = groupByCity(events, locale, referenceNow);

  // ── Server-side aggregations (songs + units) ─────────────
  const completedEventIds = events
    .filter((e) => getEventStatus(e, referenceNow) === "completed")
    .map((e) => BigInt(e.id));
  const allEventIds = events.map((e) => BigInt(e.id));

  // All three queries fly in parallel. On the songs tab,
  // `getSongAppearances` already returns the hydrated rows AND the
  // count is `songAppearances.length` so the cheap-count groupBy is
  // skipped. On the schedule tab, the cheap groupBy runs alongside
  // `getSeriesUnits` instead of serially after the await.
  const [songAppearances, units, scheduleSongCount] = await Promise.all([
    activeTab === "songs"
      ? getSongAppearances(completedEventIds)
      : Promise.resolve(
          [] as Array<{
            songId: string;
            count: number;
            song: SongRowHydrated | null;
          }>,
        ),
    getSeriesUnits(allEventIds),
    activeTab === "songs"
      ? Promise.resolve(0)
      : prisma.setlistItemSong
          .groupBy({
            by: ["songId"],
            where: {
              setlistItem: {
                eventId: { in: completedEventIds },
                isDeleted: false,
              },
            },
          })
          .then((rows) => rows.length),
  ]);

  const uniqueSongCount =
    activeTab === "songs" ? songAppearances.length : scheduleSongCount;

  const tabs = [
    { key: "schedule", label: t("tabSchedule") },
    {
      key: "songs",
      label: t("tabSongs", { count: uniqueSongCount }),
    },
  ];

  // ── Prepare legs for LegCard ─────────────────────────────
  const preparedLegs: PreparedLeg[] = legs.map((leg) => {
    const dateRangeLabel = formatDateRange(
      leg.dateRange.start,
      leg.dateRange.end,
      locale,
      SHORT_DATE_FORMAT,
    );
    // Renamed to avoid shadowing the outer `events` (post-serialize
    // tour-level array) — accidentally referencing the outer name
    // inside this mapper would silently yield the wrong array.
    const preparedEvents: PreparedLegEvent[] = leg.events.map((ev) => {
      const status = getEventStatus(ev, referenceNow);
      const evName =
        displayNameWithFallback(ev, ev.translations, locale, "short") ||
        evT("unknownEvent");
      return {
        id: ev.id,
        href: eventHref(locale, ev.id, evName),
        status,
        formattedDate: formatDate(ev.date ?? ev.startTime, locale, SHORT_DATE_FORMAT),
        name: evName,
        // Song count rendered only on completed events per task §4-3
        // / mockup. Unfortunately we don't have per-event setlist counts
        // pre-computed here; defer to omitting until a future PR adds
        // `_count.setlistItems` to the events query (the events-list
        // helper does this via getEventsListGrouped — series has its
        // own query).
        songCountLabel: null,
      };
    });
    return {
      city: leg.city,
      venue: leg.venue,
      dateRangeLabel,
      hasOngoing: leg.hasOngoing,
      events: preparedEvents,
    };
  });

  // ── LIVE banner: pick first-by-date ongoing event ────────
  const ongoingEvents = events.filter(
    (e) => getEventStatus(e, referenceNow) === "ongoing",
  );
  const firstOngoing = ongoingEvents.length > 0 ? ongoingEvents[0] : null;
  const liveBannerHref = firstOngoing
    ? eventHref(
        locale,
        firstOngoing.id,
        displayNameWithFallback(
          firstOngoing,
          firstOngoing.translations,
          locale,
          "short",
        ) || "",
      )
    : null;

  // ── Tour progress percentage ─────────────────────────────
  const progressPct =
    stats.total > 0
      ? Math.round((stats.completed / stats.total) * 100)
      : 0;

  return (
    <main
      className="flex-1"
      style={{ background: colors.bgPage }}
    >
      <div className="mx-auto max-w-[480px] px-4 lg:max-w-[1100px] lg:px-10">
        <Breadcrumb
          ariaLabel={ct("breadcrumb")}
          items={[
            { label: ct("backToHome"), href: "/" },
            ...(series.parentSeries
              ? [
                  {
                    label: parentName || t("unknownSeries"),
                    href: `/series/${series.parentSeries.id}/${series.parentSeries.slug}`,
                  } satisfies BreadcrumbItem,
                ]
              : []),
            { label: seriesMain || t("unknownSeries") },
          ]}
        />

        <div
          className="grid lg:grid-cols-[280px_1fr] lg:gap-7"
          style={{ alignItems: "start", paddingBottom: 60 }}
        >
          {/* Sidebar */}
          <div
            className="lg:sticky"
            style={{
              top: layout.navHeight.desktop + 16,
              marginBottom: 12,
            }}
          >
            <InfoCard artist={series.artist}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  color: colors.primary,
                  background: colors.primaryBg,
                  borderRadius: 10,
                  padding: "2px 8px",
                  textTransform: "uppercase",
                }}
              >
                {t(`type.${series.type}`)}
              </span>
              {(artistName || series.organizerName) && (
                <div
                  style={{
                    fontSize: 12,
                    color: colors.textSubtle,
                    marginTop: 10,
                    marginBottom: 6,
                  }}
                >
                  {artistName ?? series.organizerName}
                </div>
              )}
              <h1
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: colors.textPrimary,
                  lineHeight: 1.4,
                  marginBottom: 12,
                }}
              >
                {seriesMain || t("unknownSeries")}
                {seriesSub && (
                  <span
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 400,
                      color: colors.textMuted,
                      marginTop: 4,
                    }}
                  >
                    {seriesSub}
                  </span>
                )}
              </h1>
              {description && (
                <p
                  style={{
                    fontSize: 13,
                    color: colors.textSecondary,
                    lineHeight: 1.7,
                    marginBottom: 18,
                    paddingBottom: 18,
                    borderBottom: `1px solid ${colors.borderLight}`,
                  }}
                >
                  {description}
                </p>
              )}

              {/* Tour progress bar */}
              {stats.total > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: colors.textMuted,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      {t("tourProgressLabel")}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: colors.primary,
                      }}
                    >
                      {t("tourProgress", {
                        completed: stats.completed,
                        total: stats.total,
                      })}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 6,
                      background: colors.borderLight,
                      borderRadius: 10,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${progressPct}%`,
                        height: "100%",
                        background: BRAND_GRADIENT,
                        borderRadius: 10,
                        transition: "width 0.5s ease",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginTop: 6,
                    }}
                  >
                    <span
                      style={{ fontSize: 10, color: colors.textMuted }}
                    >
                      {t("tourCompletedLabel", { count: stats.completed })}
                    </span>
                    {stats.ongoing > 0 && (
                      <span
                        style={{
                          fontSize: 10,
                          color: colors.live,
                          fontWeight: 700,
                        }}
                      >
                        ● {t("tourOngoingLabel")}
                      </span>
                    )}
                    <span
                      style={{ fontSize: 10, color: colors.textMuted }}
                    >
                      {t("tourUpcomingLabel", { count: stats.upcoming })}
                    </span>
                  </div>
                </div>
              )}

              {/* Stats grid 2×2 */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                {[
                  {
                    label: t("statsTotalEvents"),
                    value: t("statsTotalEventsValue", { count: stats.total }),
                  },
                  {
                    label: t("statsTotalCities"),
                    value: t("statsTotalCitiesValue", {
                      count: stats.totalCities,
                    }),
                  },
                  {
                    label: t("statsSongs"),
                    value: t("statsSongsValue", { count: uniqueSongCount }),
                  },
                  {
                    label: t("statsUnits"),
                    value: t("statsUnitsValue", { count: units.length }),
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    style={{
                      background: colors.bgSubtle,
                      borderRadius: 10,
                      padding: "10px 12px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 700,
                        color: colors.textPrimary,
                      }}
                    >
                      {s.value}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: colors.textMuted,
                        marginTop: 1,
                      }}
                    >
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>

              {/* Participating units */}
              {units.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <SectionLabel>{t("unitsLabel")}</SectionLabel>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                    }}
                  >
                    {units.map((u) => {
                      const unitName =
                        displayNameWithFallback(u, u.translations, locale) ||
                        t("unknownSeries");
                      const unitColor = u.color ?? colors.textSubtle;
                      return (
                        <span
                          key={u.id}
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: unitColor,
                            background: `${unitColor}15`,
                            border: `1px solid ${unitColor}30`,
                            borderRadius: 20,
                            padding: "3px 10px",
                          }}
                        >
                          {unitName}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </InfoCard>
          </div>

          {/* Main column */}
          <div>
            <TabBar
              tabs={tabs}
              active={activeTab}
              ariaLabel={ct("tabsAriaLabel")}
            />

            {activeTab === "schedule" && (
              <>
                {firstOngoing && liveBannerHref && (
                  <Link
                    href={liveBannerHref}
                    className="mb-3 flex items-center gap-3"
                    style={{
                      background: gradients.liveBanner,
                      borderRadius: radius.cardSm,
                      padding: "14px 16px",
                      textDecoration: "none",
                    }}
                  >
                    <StatusBadge
                      status="ongoing"
                      label={statusLabels.ongoing}
                      size="sm"
                    />
                    <div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "white",
                        }}
                      >
                        {t("liveBannerTitle")}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: colors.onDarkSubtle,
                          marginTop: 2,
                        }}
                      >
                        {t("liveBannerCta")}
                      </div>
                    </div>
                  </Link>
                )}

                {series.childSeries.length > 0 && (
                  <section
                    style={{
                      background: colors.bgCard,
                      borderRadius: radius.card,
                      padding: "16px 20px",
                      marginBottom: 12,
                      boxShadow: shadows.card,
                    }}
                  >
                    <SectionLabel>{t("childSeriesLabel")}</SectionLabel>
                    <ul style={{ paddingLeft: 0, listStyle: "none" }}>
                      {series.childSeries.map((child) => {
                        const childName =
                          displayNameWithFallback(
                            child,
                            child.translations,
                            locale,
                          ) || t("unknownSeries");
                        return (
                          <li key={child.id} style={{ marginBottom: 4 }}>
                            <IntlLink
                              href={`/series/${child.id}/${child.slug}`}
                              style={{
                                fontSize: 13,
                                color: colors.primary,
                                textDecoration: "none",
                              }}
                            >
                              {childName}
                            </IntlLink>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}

                {preparedLegs.length === 0 ? (
                  <p
                    style={{
                      fontSize: 13,
                      color: colors.textMuted,
                      textAlign: "center",
                      padding: "32px 0",
                    }}
                  >
                    {t("noEvents")}
                  </p>
                ) : (
                  preparedLegs.map((leg, i) => (
                    <LegCard
                      key={`${leg.city}-${i}`}
                      leg={leg}
                      statusLabels={statusLabels}
                      eventCountLabel={t("eventCountInLeg", {
                        count: leg.events.length,
                      })}
                      unknownCityLabel={t("unknownCity")}
                    />
                  ))
                )}
              </>
            )}

            {activeTab === "songs" && (
              <section
                style={{
                  background: colors.bgCard,
                  borderRadius: radius.card,
                  padding: "20px",
                  boxShadow: shadows.card,
                  overflow: "hidden",
                }}
              >
                {songAppearances.length === 0 ? (
                  <p
                    style={{
                      fontSize: 13,
                      color: colors.textMuted,
                      textAlign: "center",
                      padding: "24px 0",
                    }}
                  >
                    {t("songsFooter")}
                  </p>
                ) : (
                  <>
                    <ul style={{ paddingLeft: 0, listStyle: "none" }}>
                      {songAppearances.map((row, i) => {
                        if (!row.song) return null;
                        const titleDisplay = displayOriginalTitle(
                          row.song,
                          row.song.translations,
                          locale,
                        );
                        const primaryArtist = row.song.artists[0]?.artist;
                        const unitName = primaryArtist
                          ? displayNameWithFallback(
                              primaryArtist,
                              primaryArtist.translations,
                              locale,
                            )
                          : null;
                        const isLast = i === songAppearances.length - 1;
                        return (
                          <li
                            key={row.songId}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                              padding: "10px 4px",
                              borderBottom: isLast
                                ? "none"
                                : `1px solid ${colors.borderLight}`,
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: colors.textPrimary,
                                }}
                              >
                                {titleDisplay.main}
                                {titleDisplay.variant && (
                                  <span
                                    style={{
                                      fontSize: 11,
                                      color: colors.textMuted,
                                      marginLeft: 6,
                                    }}
                                  >
                                    {titleDisplay.variant}
                                  </span>
                                )}
                              </div>
                              {(titleDisplay.sub || unitName) && (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: colors.textMuted,
                                    marginTop: 2,
                                  }}
                                >
                                  {[titleDisplay.sub, unitName]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </div>
                              )}
                            </div>
                            <span
                              style={{
                                fontSize: 11,
                                color: colors.textMuted,
                                flexShrink: 0,
                              }}
                            >
                              {t("songAppearances", { count: row.count })}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <p
                      style={{
                        fontSize: 11,
                        fontStyle: "italic",
                        color: colors.textMuted,
                        textAlign: "center",
                        marginTop: 16,
                      }}
                    >
                      {t("songsFooter")}
                    </p>
                  </>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
