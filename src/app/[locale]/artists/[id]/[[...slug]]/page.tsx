import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import {
  serializeBigInt,
  formatDate,
  HISTORY_ROW_DATE_FORMAT,
} from "@/lib/utils";
import {
  displayNameWithFallback,
  resolveLocalizedField,
} from "@/lib/display";
import { deriveOgPaletteFromArtist } from "@/lib/ogPalette";
import { normalizeOgLocale } from "@/lib/ogLabels";
import { getEventStatus, type ResolvedEventStatus } from "@/lib/eventStatus";
import { Breadcrumb, type BreadcrumbItem } from "@/components/Breadcrumb";
import { InfoCard } from "@/components/InfoCard";
import { TabBar } from "@/components/TabBar";
import { SectionLabel } from "@/components/SectionLabel";
import { StatsSubLabel } from "@/components/StatsSubLabel";
import { StatusBadge } from "@/components/StatusBadge";
import {
  PerformanceGroup,
  type PerformanceSeries,
  type PerformanceEvent,
} from "@/components/PerformanceGroup";
import {
  PERFORMANCE_ROW_GRID,
  PERFORMANCE_ROW_INDENT_PX,
  PERFORMANCE_ROW_GAP_PX,
} from "@/components/performance-row-layout";
import { colors, radius, shadows } from "@/styles/tokens";
import { resolveUnitColor } from "@/lib/artistColor";
import { UnitCard } from "@/components/artists/UnitCard";
import { UnitsToggle } from "@/components/artists/UnitsToggle";
import { MemberChip } from "@/components/artists/MemberChip";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};

const TABS = ["overview", "history"] as const;
type TabKey = (typeof TABS)[number];

function resolveTab(value: string | string[] | undefined): TabKey {
  const v = Array.isArray(value) ? value[0] : value;
  return TABS.includes(v as TabKey) ? (v as TabKey) : "overview";
}

async function getArtist(id: bigint) {
  const artist = await prisma.artist.findFirst({
    where: { id, isDeleted: false },
    include: {
      translations: true,
      parentArtist: { include: { translations: true } },
      // Sub-units render as cards on the overview tab. `stageLinks`
      // on each sub-unit is what powers the per-unit member grouping
      // (members are linked to their unit via StageIdentityArtist).
      subArtists: {
        where: { isDeleted: false },
        include: {
          translations: true,
          stageLinks: {
            include: {
              stageIdentity: { include: { translations: true } },
            },
          },
        },
        orderBy: { id: "asc" },
      },
      // Direct stage-identity members (graduated + current). Each
      // links to a sub-unit via the subArtists.stageLinks join above —
      // resolved client-side after fetch.
      stageLinks: {
        include: {
          stageIdentity: {
            include: {
              translations: true,
              voicedBy: {
                where: { endDate: null },
                include: {
                  realPerson: { include: { translations: true } },
                },
              },
            },
          },
        },
      },
      // (eventSeries + events fetched separately via
      // `getArtistEvents` so a sub-unit — which doesn't *own* any
      // EventSeries but appears in setlist items via
      // SetlistItemArtist — surfaces its parent's series + events.
      // Counting only `EventSeries.artistId === id` would yield 0/0
      // stats and an empty history tab on every sub-unit page.)
    },
  });
  if (!artist) return null;
  return serializeBigInt(artist);
}

/**
 * Events attributable to this artist via either of two paths:
 *
 *   1. Owned EventSeries (`EventSeries.artistId === artistId`) — the
 *      original behavior. A parent group like Hasunosora owns its
 *      tour series; events under those series count regardless of
 *      whether the parent appears in any specific setlist item.
 *
 *   2. SetlistItemArtist appearance — a sub-unit (e.g. Cerise
 *      Bouquet) doesn't own any EventSeries; it surfaces in
 *      `SetlistItemArtist.artistId` for the unit-stage songs it
 *      performs at parent-owned events. Without this branch, every
 *      sub-unit page would show 0/0 stats + empty history.
 *
 * The `OR` query unions both paths in a single round trip; the
 * post-serialize hydrate then groups events by their EventSeries
 * for the History tab. Soft-deleted events and series are excluded.
 */
async function getArtistEvents(artistId: bigint) {
  const events = await prisma.event.findMany({
    where: {
      isDeleted: false,
      // Series soft-delete filter is conditional: standalone events
      // (eventSeriesId IS NULL) skip it. Without this NOT clause, an
      // implicit `eventSeries: { isDeleted: false }` filter at the top
      // level would have excluded ALL standalone events from the
      // result regardless of which OR branch matched — sub-units that
      // performed only at non-series-attached events were silently
      // missing from totalEvents / recent / history.
      NOT: { eventSeries: { isDeleted: true } },
      OR: [
        { eventSeries: { artistId } },
        {
          setlistItems: {
            some: {
              isDeleted: false,
              artists: { some: { artistId } },
            },
          },
        },
      ],
    },
    include: {
      translations: true,
      eventSeries: { include: { translations: true } },
    },
    orderBy: { date: "desc" },
  });
  // serializeBigInt narrows BigInt → number at runtime + JSON.stringify
  // coerces Date → string. The static type still references the raw
  // Prisma row shape, so cast through `unknown`. `eventSeries` is
  // genuinely nullable now (standalone events) — the type below
  // matches.
  return serializeBigInt(events) as unknown as ArtistEvent[];
}

type ArtistEvent = {
  id: number;
  slug: string;
  status: "scheduled" | "ongoing" | "completed" | "cancelled";
  date: string;
  startTime: string;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  // Nullable — standalone events have no series. Sub-units that
  // performed only at standalone events would have been excluded
  // entirely without this; render-side bucketing surfaces them
  // under a synthetic "Standalone events" group.
  eventSeriesId: number | null;
  translations: Array<{
    locale: string;
    name: string;
    shortName: string | null;
  }>;
  eventSeries: {
    id: number;
    translations: Array<{
      locale: string;
      name: string;
      shortName: string | null;
    }>;
    originalName: string | null;
    originalShortName: string | null;
    originalLanguage: string;
  } | null;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const metaT = await getTranslations({ locale, namespace: "Meta" });
  if (!/^\d+$/.test(id)) return { title: metaT("notFound") };
  const artistId = BigInt(id);
  const [artist, palette] = await Promise.all([
    getArtist(artistId),
    deriveOgPaletteFromArtist(artistId),
  ]);
  if (!artist) return { title: metaT("notFound") };
  const fullName = displayNameWithFallback(
    artist,
    artist.translations,
    locale,
    "full",
  );
  const shortName = displayNameWithFallback(artist, artist.translations, locale);
  if (!fullName) return { title: "OpenSetlist" };

  const title = `${fullName} | OpenSetlist`;
  const description = `${shortName} ${metaT("setlistDb")}`;

  const ogImage = `/api/og/artist/${id}?lang=${normalizeOgLocale(locale)}&v=${palette.fingerprint}`;
  const pageUrl = `/${locale}/artists/${id}/${artist.slug}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: "OpenSetlist",
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
      locale,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
      site: "@opensetlistdb",
    },
  };
}

export default async function ArtistPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const activeTab = resolveTab(sp.tab);

  let artistId: bigint;
  try {
    artistId = BigInt(id);
  } catch {
    notFound();
  }

  // Fetch artist + events in parallel — events query traverses
  // SetlistItemArtist via `OR` so sub-units (which don't own any
  // EventSeries) still surface their parent-series events.
  const [artist, artistEvents] = await Promise.all([
    getArtist(artistId),
    getArtistEvents(artistId),
  ]);
  if (!artist) notFound();

  const [t, ct, evT] = await Promise.all([
    getTranslations("Artist"),
    getTranslations("Common"),
    getTranslations("Event"),
  ]);

  // Reference instant pinned at the top of the request so every event
  // status downstream resolves against the same `now` (per CLAUDE.md
  // UTC-only rule + matches the artists-list-redesign pattern).
  const referenceNow = new Date();

  // Sidebar H1: localized name BIG, original name SMALL (operator
  // preference, 2026-04-28). Previously used `displayOriginalName`
  // which put the original-language name as `main` — flipped here so
  // `displayNameWithFallback("full")` (localized cascade) drives the
  // primary heading and the JA/EN original drops below as a sub-line
  // when it differs.
  const localizedFullName =
    displayNameWithFallback(artist, artist.translations, locale, "full") ||
    t("unknown");
  const originalSubName =
    artist.originalLanguage !== locale &&
    artist.originalName &&
    artist.originalName !== localizedFullName
      ? artist.originalName
      : null;
  const bio = resolveLocalizedField(
    artist,
    artist.translations,
    locale,
    "bio",
    "originalBio",
  );
  const parentName = artist.parentArtist
    ? displayNameWithFallback(
        artist.parentArtist,
        artist.parentArtist.translations,
        locale,
      )
    : null;

  // Map: stageIdentityId → owning sub-unit. Powers the per-member
  // unit-color treatment without a second pass over subArtists at
  // render time. Members not in any sub-unit (group-level
  // stage-link only) get a `null` unit and render in muted gray.
  type Unit = (typeof artist.subArtists)[number];
  const memberToUnit = new Map<string, Unit>();
  for (const sub of artist.subArtists) {
    for (const sl of sub.stageLinks) {
      memberToUnit.set(sl.stageIdentity.id, sub);
    }
  }

  // Sub-unit list (units only — solos rendered separately if/when
  // we add a Songs tab). Empty for unit-type artists themselves.
  // Split by `isMainUnit` so the overview tab can default to showing
  // only canonical units; non-main configurations sit behind a toggle
  // (mockup-fidelity feedback, 2026-04-28).
  const subUnits = artist.subArtists.filter((s) => s.type === "unit");
  const mainSubUnits = subUnits.filter((s) => s.isMainUnit);
  const otherSubUnits = subUnits.filter((s) => !s.isMainUnit);

  // Stats: total events + completed events across all events
  // attributable to this artist (owned-series + appearance union).
  // `getEventStatus()` resolves the displayed status from raw status
  // + startTime — never trust raw `event.status === "completed"`,
  // which is wrong for events whose DB status is `scheduled` but
  // whose startTime is in the past (auto-resolved to `ongoing` /
  // `completed` per the 12h window in eventStatus.ts).
  let totalEvents = 0;
  let totalCompleted = 0;
  const completedEventIds: bigint[] = [];
  for (const event of artistEvents) {
    totalEvents += 1;
    if (
      getEventStatus(
        { status: event.status, startTime: event.startTime },
        referenceNow,
      ) === "completed"
    ) {
      totalCompleted += 1;
      completedEventIds.push(BigInt(event.id));
    }
  }

  // Per-event setlist-item count for completed events. Used to render
  // the trailing "🎵 N" badge on each row (mockup line 226-230).
  // Counts SetlistItem rows that have at least one song attached
  // (`songs: { some: {} }`) — covers both single-song slots and
  // medley slots equally. Only completed events get the count;
  // ongoing/upcoming have partial data and the mockup omits the
  // badge for them too.
  const songCountByEvent = new Map<string, number>();
  if (completedEventIds.length > 0) {
    const groups = await prisma.setlistItem.groupBy({
      by: ["eventId"],
      where: {
        eventId: { in: completedEventIds },
        isDeleted: false,
        songs: { some: {} },
      },
      _count: { _all: true },
    });
    for (const g of groups) {
      if (g.eventId == null) continue;
      songCountByEvent.set(String(g.eventId), g._count._all);
    }
  }

  const tabs = [
    { key: "overview", label: t("tabOverview") },
    { key: "history", label: t("tabHistory", { count: totalEvents }) },
  ];

  // Resolved status labels passed to <PerformanceGroup>; the component
  // itself is locale-free so the label dictionary lives here.
  // Ongoing badge uses the marketing "LIVE" label (matching the home,
  // event list, series, and song detail surfaces) — keeps the
  // ongoing-event affordance one consistent string across the app
  // instead of mixing "진행 중" / "LIVE" / "Ongoing" depending on
  // which page surfaces the badge.
  const statusLabels: Record<ResolvedEventStatus, string> = {
    ongoing: evT("live"),
    upcoming: evT("status.upcoming"),
    completed: evT("status.completed"),
    cancelled: evT("status.cancelled"),
  };

  // Build a flat per-event view-model first, then group by series.
  // Doing it this way means the recent-3 list (Overview tab) and the
  // per-series collapsible groups (History tab) read from the same
  // source — no duplicated date-formatting / status-resolving logic.
  //
  // Standalone events (eventSeriesId IS NULL) collapse into one
  // synthetic group keyed `"standalone"` — kept distinct from any
  // numeric seriesId since real BigInt IDs serialize to numbers.
  // The render branch below labels this group with
  // `t("standaloneEvents")`.
  const STANDALONE_KEY = "standalone";
  type EventView = PerformanceEvent & {
    seriesKey: string;
    rawDateMs: number;
  };
  // First, dedupe series surfaced via `artistEvents`. Each event row
  // carries its EventSeries (or null for standalone events), so a
  // series is `seen` the first time any of its events shows up.
  // Order matches the events query (date desc), so the first-event-
  // seen-per-series order roughly matches recent-activity order —
  // refined by the explicit sort below.
  const seriesById = new Map<
    string,
    ArtistEvent["eventSeries"]
  >();
  for (const ev of artistEvents) {
    const key = ev.eventSeriesId == null
      ? STANDALONE_KEY
      : String(ev.eventSeriesId);
    if (!seriesById.has(key)) seriesById.set(key, ev.eventSeries);
  }

  const eventViews: EventView[] = [];
  for (const event of artistEvents) {
    const status = getEventStatus(
      { status: event.status, startTime: event.startTime },
      referenceNow,
    );
    const eventIdStr = String(event.id);
    const songCount = songCountByEvent.get(eventIdStr);
    const trailing =
      status === "completed" && songCount !== undefined && songCount > 0 ? (
        <span
          style={{
            fontSize: 11,
            color: colors.textMuted,
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          {t("songCount", { count: songCount })}
        </span>
      ) : null;
    eventViews.push({
      // serializeBigInt coerces every id to number at runtime; the
      // String() cast satisfies PerformanceEvent's id contract
      // without leaking the bigint type out of the JSON shape.
      id: eventIdStr,
      seriesKey: event.eventSeriesId == null
        ? STANDALONE_KEY
        : String(event.eventSeriesId),
      status,
      formattedDate: formatDate(event.date, locale, HISTORY_ROW_DATE_FORMAT),
      name:
        displayNameWithFallback(event, event.translations, locale) ||
        evT("unknownEvent"),
      href: `/${locale}/events/${event.id}/${event.slug}`,
      trailing,
      // serializeBigInt also runs JSON.stringify, which converts
      // Date columns to ISO strings — so the runtime value is a
      // string here even though Prisma's type still says Date.
      // String() coerces uniformly without an `as` cast.
      rawDateMs: new Date(String(event.date)).getTime(),
    });
  }

  // Group by series for the History tab. Pin any series with an
  // ongoing event to the top; remainder by most-recent event date
  // desc.
  const seriesViews: PerformanceSeries[] = [...seriesById.entries()]
    .map(([seriesKey, series]) => {
      const seriesEvents = eventViews.filter(
        (ev) => ev.seriesKey === seriesKey,
      );
      // Within a series, keep the operator-specified date-desc order.
      seriesEvents.sort((a, b) => b.rawDateMs - a.rawDateMs);
      const hasOngoing = seriesEvents.some((e) => e.status === "ongoing");
      const mostRecentMs = seriesEvents.reduce(
        (m, e) => (e.rawDateMs > m ? e.rawDateMs : m),
        0,
      );
      // Standalone group (no series): label via i18n, use the
      // synthetic key as the React key. PerformanceGroup doesn't
      // know or care that this group is synthetic.
      const isStandalone = series == null;
      return {
        seriesId: isStandalone ? STANDALONE_KEY : String(series.id),
        seriesShort: isStandalone
          ? t("standaloneEvents")
          : displayNameWithFallback(series, series.translations, locale) ||
            evT("unknownEvent"),
        hasOngoing,
        events: seriesEvents,
        sortKey: hasOngoing ? Number.MAX_SAFE_INTEGER : mostRecentMs,
      };
    })
    .sort(
      (a, b) =>
        (b as { sortKey: number }).sortKey -
        (a as { sortKey: number }).sortKey,
    )
    // Strip the temporary sortKey to honor the declared
    // PerformanceSeries shape — explicit field-by-field copy avoids
    // the unused `_` discard binding that no-unused-vars warns on.
    .map((s) => ({
      seriesId: s.seriesId,
      seriesShort: s.seriesShort,
      hasOngoing: s.hasOngoing,
      events: s.events,
    }));

  // Recent-3 preview for the Overview tab — newest events across the
  // entire artist, regardless of series.
  // Strip the temporary `rawDateMs` and `seriesId` fields back to the
  // declared PerformanceEvent shape — explicit field copy avoids the
  // unused `_` discard pattern that triggers no-unused-vars.
  const recentEvents: PerformanceEvent[] = [...eventViews]
    .sort((a, b) => b.rawDateMs - a.rawDateMs)
    .slice(0, 3)
    .map((e) => ({
      id: e.id,
      status: e.status,
      formattedDate: e.formattedDate,
      name: e.name,
      href: e.href,
      trailing: e.trailing,
    }));

  // Pre-render a sub-unit card to a ReactNode so <UnitsToggle>
  // (client) can compose the main/other split without re-running the
  // server-side resolution. Closure over `locale`, `t`, and color
  // constants keeps the call sites compact.
  type SubUnit = (typeof subUnits)[number];
  const renderUnitCard = (unit: SubUnit) => {
    const unitName =
      displayNameWithFallback(unit, unit.translations, locale) || t("unknown");
    // Color: `Artist.color` if set, else a deterministic pick from
    // `unitFallbackPalette` keyed on `unit.slug` (so multiple
    // color-pending sub-units render with distinguishable hues
    // instead of all collapsing to brand blue). One resolved color
    // drives both the text/hover-border and the 4×18 left stripe —
    // dropping the prior `BRAND_GRADIENT` two-stop variant since at
    // 4×18 a solid hue reads identically while keeping the resolver
    // surface (one input, one output) simple.
    const unitColor = resolveUnitColor(unit);
    const stripeBg = unitColor;
    const members = unit.stageLinks.map(
      (sl) =>
        displayNameWithFallback(
          sl.stageIdentity,
          sl.stageIdentity.translations,
          locale,
        ) || t("unknownMember"),
    );
    return (
      <UnitCard
        key={unit.id}
        href={`/${locale}/artists/${unit.id}/${unit.slug}`}
        unitName={unitName}
        unitColor={unitColor}
        stripeBg={stripeBg}
        members={members}
      />
    );
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: colors.bgPage,
      }}
    >
      <div
        className="mx-auto px-4 lg:px-10"
        style={{ maxWidth: 1100 }}
      >
        <Breadcrumb
          ariaLabel={ct("breadcrumb")}
          items={[
            { label: ct("home"), href: `/${locale}` },
            // Always include the Artists list link as the second crumb
            // (operator feedback, 2026-04-28). Sub-units of a
            // top-level artist still get their parent crumb between
            // Artists and the leaf — so a sub-unit reads
            // `Home > Artists > 蓮ノ空 > Cerise Bouquet`.
            { label: ct("artists"), href: `/${locale}/artists` },
            ...(artist.parentArtist && parentName
              ? [
                  {
                    label: parentName,
                    href: `/${locale}/artists/${artist.parentArtist.id}/${artist.parentArtist.slug}`,
                  } satisfies BreadcrumbItem,
                ]
              : []),
            { label: localizedFullName },
          ]}
        />

        <div className="grid lg:grid-cols-[280px_1fr] lg:gap-7" style={{ alignItems: "start", paddingBottom: 60 }}>
          {/* Sidebar (mobile: stacked above tabs; desktop: sticky 280px column) */}
          <div className="lg:sticky lg:top-[72px]" style={{ marginBottom: 12 }}>
            <InfoCard artist={artist}>
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
                {t(`type.${artist.type}`)}
              </span>
              <h1
                className="lg:text-[17px]"
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: colors.textPrimary,
                  lineHeight: 1.35,
                  marginTop: 10,
                  marginBottom: originalSubName ? 6 : 14,
                }}
              >
                {localizedFullName}
              </h1>
              {originalSubName && (
                <div
                  style={{
                    fontSize: 12,
                    color: colors.textMuted,
                    marginBottom: 14,
                  }}
                >
                  {originalSubName}
                </div>
              )}
              {bio && (
                <p
                  style={{
                    fontSize: 13,
                    color: colors.textSecondary,
                    lineHeight: 1.7,
                    marginBottom: 18,
                  }}
                >
                  {bio}
                </p>
              )}
              <div style={{ display: "flex", gap: 20 }}>
                <div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: colors.textPrimary,
                    }}
                  >
                    {totalEvents}
                  </div>
                  <StatsSubLabel>
                    {t("statsTotalEvents")}
                  </StatsSubLabel>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: colors.textPrimary,
                    }}
                  >
                    {totalCompleted}
                  </div>
                  <StatsSubLabel>
                    {t("statsCompleted")}
                  </StatsSubLabel>
                </div>
                {subUnits.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: colors.textPrimary,
                      }}
                    >
                      {subUnits.length}
                    </div>
                    <StatsSubLabel>
                      {t("statsSubUnits")}
                    </StatsSubLabel>
                  </div>
                )}
              </div>
            </InfoCard>
          </div>

          {/* Main content */}
          <div>
            <TabBar
              tabs={tabs}
              active={activeTab}
              ariaLabel={ct("tabsAriaLabel")}
            />

            {activeTab === "overview" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {subUnits.length > 0 && (
                  <section
                    style={{
                      background: colors.bgCard,
                      borderRadius: radius.card,
                      padding: "18px 20px",
                      boxShadow: shadows.card,
                    }}
                  >
                    <SectionLabel>{t("subUnits")}</SectionLabel>
                    <UnitsToggle
                      mainCards={mainSubUnits.map(renderUnitCard)}
                      otherCards={otherSubUnits.map(renderUnitCard)}
                      showLabel={t("showOtherUnits", {
                        count: otherSubUnits.length,
                      })}
                      hideLabel={t("hideOtherUnits")}
                    />
                  </section>
                )}

                {artist.stageLinks.length > 0 && (
                  <section
                    style={{
                      background: colors.bgCard,
                      borderRadius: radius.card,
                      padding: "18px 20px",
                      boxShadow: shadows.card,
                    }}
                  >
                    <SectionLabel>
                      {t("membersWithCount", {
                        count: artist.stageLinks.length,
                      })}
                    </SectionLabel>
                    <div
                      style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                    >
                      {artist.stageLinks.map((sl) => {
                        const owningUnit = memberToUnit.get(
                          sl.stageIdentity.id,
                        );
                        // Color cascade: owning sub-unit's color
                        // (members inherit their unit's brand) →
                        // member's own SI color → muted gray. Same
                        // chain as before; the hover treatment in
                        // MemberChip is what activates the unit
                        // identity on interaction.
                        const unitColor =
                          owningUnit?.color ??
                          sl.stageIdentity.color ??
                          colors.textMuted;
                        const unitName = owningUnit
                          ? displayNameWithFallback(
                              owningUnit,
                              owningUnit.translations,
                              locale,
                            )
                          : null;
                        const memberName =
                          displayNameWithFallback(
                            sl.stageIdentity,
                            sl.stageIdentity.translations,
                            locale,
                          ) || t("unknownMember");
                        return (
                          <MemberChip
                            key={sl.id}
                            href={`/${locale}/members/${sl.stageIdentity.id}/${sl.stageIdentity.slug}`}
                            memberName={memberName}
                            unitName={unitName}
                            unitColor={unitColor}
                          />
                        );
                      })}
                    </div>
                  </section>
                )}

                <section
                  style={{
                    background: colors.bgCard,
                    borderRadius: radius.card,
                    overflow: "hidden",
                    boxShadow: shadows.card,
                  }}
                >
                  <div
                    style={{
                      padding: "16px 20px 12px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      borderBottom: `1px solid ${colors.borderLight}`,
                    }}
                  >
                    <SectionLabel noBorder style={{ marginBottom: 0 }}>
                      {t("recentEvents")}
                    </SectionLabel>
                    {totalEvents > recentEvents.length && (
                      <Link
                        href={`/${locale}/artists/${artist.id}/${artist.slug}?tab=history`}
                        style={{
                          fontSize: 12,
                          color: colors.primary,
                          fontWeight: 600,
                          textDecoration: "none",
                        }}
                      >
                        {t("viewAll")}
                      </Link>
                    )}
                  </div>
                  {recentEvents.length === 0 ? (
                    <p
                      style={{
                        padding: "32px 16px",
                        fontSize: 14,
                        color: colors.textMuted,
                        textAlign: "center",
                      }}
                    >
                      {t("noEvents")}
                    </p>
                  ) : (
                    recentEvents.map((event, i) => (
                      <Link
                        key={event.id}
                        href={event.href}
                        className="row-hover-bg"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 20px",
                          borderBottom:
                            i < recentEvents.length - 1
                              ? `1px solid ${colors.borderFaint}`
                              : "none",
                          textDecoration: "none",
                          color: "inherit",
                        }}
                      >
                        <StatusBadge
                          status={event.status}
                          size="sm"
                          label={statusLabels[event.status]}
                        />
                        <span
                          style={{
                            fontSize: 12,
                            color: colors.textMuted,
                            // Match the history tab's date column
                            // (`PERFORMANCE_ROW_GRID` second track at
                            // 100px) so a long-form locale date like
                            // "2026년 4월 25일" doesn't truncate. The
                            // 52px width was inherited from the
                            // mockup's `formatDateShort` helper, which
                            // we don't use — `formatDate` produces the
                            // full year-month-day string.
                            width: 100,
                            flexShrink: 0,
                          }}
                        >
                          {event.formattedDate}
                        </span>
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: colors.primary,
                            flex: 1,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {event.name}
                        </span>
                        {event.trailing}
                        <span
                          aria-hidden="true"
                          style={{
                            fontSize: 13,
                            color: colors.borderSubtle,
                          }}
                        >
                          ›
                        </span>
                      </Link>
                    ))
                  )}
                </section>
              </div>
            )}

            {activeTab === "history" && (
              <div
                style={{
                  background: colors.bgCard,
                  borderRadius: radius.card,
                  overflow: "hidden",
                  boxShadow: shadows.card,
                }}
              >
                <div
                  style={{
                    padding: "16px 20px 12px",
                    borderBottom: `1px solid ${colors.borderLight}`,
                  }}
                >
                  <SectionLabel noBorder style={{ marginBottom: 0 }}>
                    {t("historyHeader", { count: totalEvents })}
                  </SectionLabel>
                </div>
                {seriesViews.length === 0 ? (
                  <p
                    style={{
                      padding: "32px 16px",
                      fontSize: 14,
                      color: colors.textMuted,
                      textAlign: "center",
                    }}
                  >
                    {t("noEvents")}
                  </p>
                ) : (
                  <>
                    {/* Desktop-only column-header strip — same grid
                        template as the rows below so headers line up
                        with row tracks. Mirrors the song detail
                        page's history tab pattern (which uses the
                        identical PERFORMANCE_ROW_GRID export). Hidden
                        on mobile via `hidden lg:grid`; mobile rows
                        carry no column header. */}
                    <div
                      className="hidden lg:grid"
                      style={{
                        gridTemplateColumns: PERFORMANCE_ROW_GRID,
                        gap: PERFORMANCE_ROW_GAP_PX,
                        padding: `8px 16px 8px ${PERFORMANCE_ROW_INDENT_PX}px`,
                        background: colors.bgFaint,
                        borderBottom: `1px solid ${colors.border}`,
                      }}
                    >
                      {[
                        evT("tableHeader.status"),
                        evT("tableHeader.date"),
                        evT("tableHeader.name"),
                        evT("tableHeader.songs"),
                        "",
                      ].map((label, i) => (
                        <span
                          key={i}
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: colors.textMuted,
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                          }}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                    {seriesViews.map((sv) => (
                      <PerformanceGroup
                        key={sv.seriesId}
                        series={sv}
                        statusLabels={statusLabels}
                        eventCountLabel={t("eventCount", {
                          count: sv.events.length,
                        })}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
