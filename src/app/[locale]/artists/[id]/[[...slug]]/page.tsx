import { cache } from "react";
import { CACHE_TTL, cachedQuery } from "@/lib/dataCache";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { Metadata } from "next";
import { entityAlternates, enforceCanonicalSlug } from "@/lib/seo/entityUrl";
import { prisma } from "@/lib/prisma";
import { byStageIdentityOrderBy } from "@/lib/memberOrder";
import {
  serializeBigInt,
  formatDate,
  HISTORY_ROW_DATE_FORMAT,
} from "@/lib/utils";
import {
  displayNameWithFallback,
  displayOriginalName,
  resolveLocalizedField,
} from "@/lib/display";
import { deriveOgPaletteFromCachedArtist } from "@/lib/ogPalette";
import { normalizeOgLocale } from "@/lib/ogLabels";
import { getEventStatus, type ResolvedEventStatus } from "@/lib/eventStatus";
import { Breadcrumb, type BreadcrumbItem } from "@/components/Breadcrumb";
import { ArtistAlbumsSection } from "@/components/ArtistAlbumsSection";
import { resolveUnitColor } from "@/lib/artistColor";
import { UnitCard } from "@/components/artists/UnitCard";
import { UnitsToggle } from "@/components/artists/UnitsToggle";
import { MemberChip } from "@/components/artists/MemberChip";
import {
  ArtistEventRow,
  type ArtistEventView,
} from "@/components/artists/ArtistEventRow";
import { ArtistHistoryGroup } from "@/components/artists/ArtistHistoryGroup";
import {
  IDENTITY_FALLBACK_ACCENT,
  MEMBER_FALLBACK_COLOR,
  accentStyle,
  fallbackNameLang,
  originalLang,
} from "@/components/artists/artistDetail";
import styles from "@/components/artists/artistDetail.module.css";

type Props = {
  params: Promise<{ locale: string; id: string; slug?: string[] }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};

const TABS = ["overview", "albums", "history"] as const;
type TabKey = (typeof TABS)[number];

function resolveTab(value: string | string[] | undefined): TabKey {
  const v = Array.isArray(value) ? value[0] : value;
  return TABS.includes(v as TabKey) ? (v as TabKey) : "overview";
}

// Wrapped in `react.cache()` so the duplicate call across
// `generateMetadata` and `ArtistPage` collapses to one DB fetch per
// request. Matches the pattern PR #260 / song & event detail pages
// set up. Without this wrapper, the nested-include mega-query fired
// twice on every full ArtistPage render — and on sub-unit routes
// (e.g. /en/artists/3/dollchestra) the OG palette derivation in
// generateMetadata ran additional parent-chain `findUnique` queries
// on top, tripping Sentry's N+1 detector (issue 7501503230).
async function fetchArtist(id: bigint) {
  const artist = await prisma.artist.findFirst({
    where: { id, isDeleted: false },
    include: {
      translations: true,
      // Explicit `select` (not `include`) so each scalar this
      // sub-tree depends on is listed by name. `include` would
      // auto-fetch every Artist scalar and the code would still
      // work today, but `color` is load-bearing for
      // `deriveOgPaletteFromCachedArtist` (anchor chain when this
      // artist's own color is unset) and a future include →
      // select refactor that narrowed the projection elsewhere
      // could silently drop it. Listing fields explicitly makes
      // the dependency self-documenting and refactor-safe;
      // also drops unused parent scalars (parentArtistId, type,
      // hasBoard, imageUrl, category, isMainUnit, originalBio,
      // isDeleted, deletedAt, createdAt) and `translations.bio`
      // from the wire payload. Fields are grouped by consumer:
      // breadcrumb crumb (id, slug + the `original*` chain feeding
      // `displayNameWithFallback`), translations narrowed to the
      // exact `{locale, name, shortName}` shape that helper reads,
      // and the palette inputs below.
      parentArtist: {
        select: {
          id: true,
          slug: true,
          color: true,
          originalName: true,
          originalShortName: true,
          originalLanguage: true,
          translations: {
            select: { locale: true, name: true, shortName: true },
          },
          // Used solely by `deriveOgPaletteFromCachedArtist` to seed
          // the frequency map when this artist's own `stageLinks`
          // are empty (typical sub-unit whose members are linked
          // only to the parent group). Not surfaced anywhere in the
          // page body — the parent's `stageLinks` shape is
          // intentionally narrowed to just `stageIdentity.color`
          // here to keep the payload small.
          stageLinks: {
            select: {
              stageIdentity: { select: { color: true } },
            },
          },
        },
      },
      // Sub-units render as cards on the overview tab. `stageLinks`
      // on each sub-unit is what powers the per-unit member grouping
      // (members are linked to their unit via StageIdentityArtist).
      subArtists: {
        where: { isDeleted: false },
        include: {
          translations: true,
          // Official member order, so a unit card's member names read
          // like the official unit roster.
          stageLinks: {
            include: {
              stageIdentity: { include: { translations: true } },
            },
            orderBy: byStageIdentityOrderBy(),
          },
        },
        orderBy: { id: "asc" },
      },
      // Direct stage-identity members (graduated + current). Each
      // links to a sub-unit via the subArtists.stageLinks join above —
      // resolved client-side after fetch. Official member order
      // (`src/lib/memberOrder.ts`): the members section renders in
      // this order as is.
      stageLinks: {
        orderBy: byStageIdentityOrderBy(),
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

const getArtist = cache(
  cachedQuery("artist-detail", fetchArtist, { revalidate: CACHE_TTL.entity }),
);

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
async function fetchArtistEvents(artistId: bigint) {
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

const getArtistEvents = cachedQuery("artist-events", fetchArtistEvents, {
  revalidate: CACHE_TTL.entity,
});

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
  // `getArtist` is `react.cache`-wrapped, so this call shares its
  // result with the one inside `ArtistPage` below (one DB roundtrip
  // total per request). The palette is then derived in-process from
  // that already-loaded row — replacing what used to be 2-4 extra
  // `Artist.findUnique` parent-chain walks plus a
  // `StageIdentityArtist.findMany` in `deriveOgPaletteFromArtist`.
  const artist = await getArtist(artistId);
  if (!artist) return { title: metaT("notFound") };
  const palette = await deriveOgPaletteFromCachedArtist(artist);
  const fullName = displayNameWithFallback(
    artist,
    artist.translations,
    locale,
    "full",
  );
  const shortName = displayNameWithFallback(artist, artist.translations, locale);
  if (!fullName) return { title: "OpenSetlist" };

  const title = metaT("artistTitle", { name: fullName });
  const description = metaT("artistDescription", { name: shortName || fullName });

  const ogImage = `/api/og/artist/${id}?lang=${normalizeOgLocale(locale)}&v=${palette.fingerprint}`;
  const alternates = entityAlternates("artists", locale, id, artist.slug);

  return {
    title,
    description,
    alternates,
    openGraph: {
      title,
      description,
      url: alternates.canonical,
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
  const { locale, id, slug } = await params;
  const sp = await searchParams;
  const activeTab = resolveTab(sp.tab);

  let artistId: bigint;
  try {
    artistId = BigInt(id);
  } catch {
    notFound();
  }

  // Fetch artist + events + album count in parallel — events query
  // traverses SetlistItemArtist via `OR` so sub-units (which don't own
  // any EventSeries) still surface their parent-series events. The
  // album count drives the "앨범 (N)" tab label (the tab body fetches the
  // rows itself via <ArtistAlbumsSection mode="full">).
  const [artist, artistEvents, albumCount] = await Promise.all([
    getArtist(artistId),
    getArtistEvents(artistId),
    prisma.album.count({ where: { artists: { some: { artistId } } } }),
  ]);
  if (!artist) notFound();
  enforceCanonicalSlug("artists", locale, id, artist.slug, slug, sp);

  const [t, ct, evT] = await Promise.all([
    getTranslations("Artist"),
    getTranslations("Common"),
    getTranslations("Event"),
  ]);

  // Reference instant pinned at the top of the request so every event
  // status downstream resolves against the same `now` (per CLAUDE.md
  // UTC-only rule + matches the artists-list-redesign pattern).
  const referenceNow = new Date();

  // H1: localized name BIG, original name SMALL (operator preference).
  // `displayOriginalName` is translation-primary at the helper level, so
  // `.main` is the headline and `.sub` (set only when a distinct
  // viewer-locale translation exists) is the original-language line.
  // With no translation, `.main` IS the original — mark it with the
  // source language so an English page reads a Japanese H1 as Japanese
  // (20 review: missing source-language attributes).
  const { main: artistPrimaryName, sub: artistSecondaryName } =
    displayOriginalName(artist, artist.translations, locale);
  const localizedFullName = artistPrimaryName || t("unknown");
  const headlineLang = artistSecondaryName
    ? undefined
    : originalLang(artist.originalLanguage, locale);
  const bio = resolveLocalizedField(
    artist,
    artist.translations,
    locale,
    "bio",
    "originalBio",
  );
  // The bio came from `originalBio` unless the viewer-locale
  // translation carries one.
  const bioLang = artist.translations.some(
    (tr) => tr.locale === locale && Boolean(tr.bio),
  )
    ? undefined
    : originalLang(artist.originalLanguage, locale);
  // Breadcrumb crumbs always render the short variant (project rule:
  // breadcrumbs prefer compact labels; the same artist's full name
  // shows in the page header anyway). `displayNameWithFallback` with
  // `mode: "short"` walks the locale-shortName → locale-name →
  // original-shortName → original-name cascade so we never blank out
  // the crumb when the operator hasn't backfilled a short variant.
  const parentName = artist.parentArtist
    ? displayNameWithFallback(
        artist.parentArtist,
        artist.parentArtist.translations,
        locale,
        "short",
      )
    : null;
  const breadcrumbLeafName =
    displayNameWithFallback(artist, artist.translations, locale, "short") ||
    t("unknown");

  // Map: stageIdentityId → owning sub-unit. Powers the per-member
  // unit-color treatment without a second pass over subArtists at
  // render time. Members not in any sub-unit (group-level
  // stage-link only) get a `null` unit and render in muted gray.
  //
  // A StageIdentity can legitimately belong to multiple sub-units
  // (StageIdentityArtist is N:N — e.g. a member in both a canonical
  // unit AND a special-configuration unit). Naive `for...set` would
  // last-wins by iteration order, producing a non-deterministic
  // chip color/name. Resolve in two passes: main units first, then
  // non-main; within each pass `set` only when the member doesn't
  // already have a unit. Result: a member in a canonical unit always
  // shows that unit's identity, regardless of any incidental other
  // affiliations.
  type Unit = (typeof artist.subArtists)[number];
  const memberToUnit = new Map<string, Unit>();
  const mainsFirst = [
    ...artist.subArtists.filter((s) => s.isMainUnit),
    ...artist.subArtists.filter((s) => !s.isMainUnit),
  ];
  for (const sub of mainsFirst) {
    for (const sl of sub.stageLinks) {
      if (!memberToUnit.has(sl.stageIdentity.id)) {
        memberToUnit.set(sl.stageIdentity.id, sub);
      }
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

  // Per-event setlist-item count for completed events, shown as the
  // "🎵 N" songs cell. Counts SetlistItem rows that have at least one
  // song attached (`songs: { some: {} }`) — covers both single-song
  // slots and medley slots equally. Only completed events get the
  // count; ongoing/upcoming have partial data.
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

  const tabs: { key: TabKey; label: string }[] = [
    { key: "overview", label: t("tabOverview") },
    // Albums tab only when the artist has albums — no point in an empty
    // tab. The full discography is fetched by the tab body, not here.
    ...(albumCount > 0
      ? [{ key: "albums" as const, label: t("tabAlbums", { count: albumCount }) }]
      : []),
    { key: "history", label: t("tabHistory", { count: totalEvents }) },
  ];

  // Resolved status labels. Ongoing uses the marketing "LIVE" label
  // (matching the home, event list, series, and song detail surfaces)
  // so the ongoing affordance is one consistent string across the app.
  const statusLabels: Record<ResolvedEventStatus, string> = {
    ongoing: evT("live"),
    upcoming: evT("status.upcoming"),
    completed: evT("status.completed"),
    cancelled: evT("status.cancelled"),
  };

  // Build a flat per-event view-model first, then group by series.
  // The recent-3 list (Overview tab) and the per-series groups
  // (History tab) read from the same source — no duplicated
  // date-formatting / status-resolving logic.
  //
  // Standalone events (eventSeriesId IS NULL) collapse into one
  // synthetic group keyed `"standalone"` — kept distinct from any
  // numeric seriesId since real BigInt IDs serialize to numbers.
  const STANDALONE_KEY = "standalone";
  type EventView = ArtistEventView & { seriesKey: string; rawDateMs: number };
  // Dedupe series surfaced via `artistEvents`. Each event row carries
  // its EventSeries (or null for standalone events).
  const seriesById = new Map<string, ArtistEvent["eventSeries"]>();
  for (const ev of artistEvents) {
    const key =
      ev.eventSeriesId == null ? STANDALONE_KEY : String(ev.eventSeriesId);
    if (!seriesById.has(key)) seriesById.set(key, ev.eventSeries);
  }

  const eventViews: EventView[] = artistEvents.map((event) => {
    const status = getEventStatus(
      { status: event.status, startTime: event.startTime },
      referenceNow,
    );
    const songCount = songCountByEvent.get(String(event.id));
    const series = event.eventSeries;
    // serializeBigInt runs JSON.stringify, so `date` is an ISO string
    // at runtime even though Prisma's type still says Date.
    const isoDate = String(event.date);
    return {
      id: String(event.id),
      href: `/${locale}/events/${event.id}/${event.slug}`,
      status,
      statusLabel: statusLabels[status],
      formattedDate: formatDate(event.date, locale, HISTORY_ROW_DATE_FORMAT),
      isoDate: isoDate.slice(0, 10),
      name:
        displayNameWithFallback(event, event.translations, locale) ||
        evT("unknownEvent"),
      nameLang: fallbackNameLang(event, event.translations, locale),
      // Series subtitle (operator feedback, 2026-04-29: event names
      // alone don't carry the tour). The history grid hides it — the
      // group header names the series there.
      seriesName: series
        ? displayNameWithFallback(series, series.translations, locale) || null
        : null,
      seriesLang: series
        ? fallbackNameLang(series, series.translations, locale)
        : undefined,
      songCountLabel:
        status === "completed" && songCount !== undefined && songCount > 0
          ? t("songCount", { count: songCount })
          : null,
      seriesKey:
        event.eventSeriesId == null
          ? STANDALONE_KEY
          : String(event.eventSeriesId),
      rawDateMs: new Date(isoDate).getTime(),
    };
  });

  // Group by series for the History tab. Pin any series with an
  // ongoing event to the top; remainder by most-recent event date
  // desc.
  const seriesViews = [...seriesById.entries()]
    .map(([seriesKey, series]) => {
      const events = eventViews
        .filter((ev) => ev.seriesKey === seriesKey)
        // Within a series, keep the operator-specified date-desc order.
        .sort((a, b) => b.rawDateMs - a.rawDateMs);
      const hasOngoing = events.some((e) => e.status === "ongoing");
      const mostRecentMs = events.reduce(
        (m, e) => (e.rawDateMs > m ? e.rawDateMs : m),
        0,
      );
      return {
        key: seriesKey,
        title: series
          ? displayNameWithFallback(series, series.translations, locale) ||
            evT("unknownEvent")
          : t("standaloneEvents"),
        titleLang: series
          ? fallbackNameLang(series, series.translations, locale)
          : undefined,
        hasOngoing,
        events,
        sortKey: hasOngoing ? Number.MAX_SAFE_INTEGER : mostRecentMs,
      };
    })
    .sort((a, b) => b.sortKey - a.sortKey);

  // Recent-3 preview for the Overview tab — newest events across the
  // entire artist (future dates included), regardless of series.
  const recentEvents = [...eventViews]
    .sort((a, b) => b.rawDateMs - a.rawDateMs)
    .slice(0, 3);

  // Pre-render a sub-unit card to a ReactNode so <UnitsToggle>
  // (client) can compose the main/other split without re-running the
  // server-side resolution.
  type SubUnit = (typeof subUnits)[number];
  const renderUnitCard = (unit: SubUnit) => (
    <UnitCard
      key={unit.id}
      href={`/${locale}/artists/${unit.id}/${unit.slug}`}
      name={{
        text:
          displayNameWithFallback(unit, unit.translations, locale) ||
          t("unknown"),
        lang: fallbackNameLang(unit, unit.translations, locale),
      }}
      // Stored `Artist.color`, else a deterministic slug-palette pick,
      // so colour-pending units stay distinguishable and match their
      // event-page setlist pill (same resolver).
      color={resolveUnitColor(unit)}
      members={unit.stageLinks.map((sl) => ({
        text:
          displayNameWithFallback(
            sl.stageIdentity,
            sl.stageIdentity.translations,
            locale,
          ) || t("unknownMember"),
        lang: fallbackNameLang(
          sl.stageIdentity,
          sl.stageIdentity.translations,
          locale,
        ),
      }))}
    />
  );

  const artistHref = `/${locale}/artists/${artist.id}/${artist.slug}`;

  const unitsPanel = subUnits.length > 0 && (
    <section className={styles.panel}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{t("subUnits")}</h2>
      </div>
      <UnitsToggle
        mainCards={mainSubUnits.map(renderUnitCard)}
        otherCards={otherSubUnits.map(renderUnitCard)}
        showLabel={t("showOtherUnits", { count: otherSubUnits.length })}
        hideLabel={t("hideOtherUnits")}
      />
    </section>
  );

  // Every direct StageIdentityArtist link, graduated members included,
  // in official member order (`byStageIdentityOrderBy`).
  const membersPanel = artist.stageLinks.length > 0 && (
    <section className={styles.panel}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>
          {t("membersWithCount", { count: artist.stageLinks.length })}
        </h2>
      </div>
      <ul className={styles.memberGrid}>
        {artist.stageLinks.map((sl) => {
          const si = sl.stageIdentity;
          const owningUnit = memberToUnit.get(si.id);
          // Colour cascade: owning sub-unit's stored colour (members
          // inherit their unit's identity) → member's own SI colour →
          // muted. Deliberately not the slug palette: an invented hue
          // would claim a membership colour that doesn't exist.
          const color = owningUnit?.color ?? si.color ?? MEMBER_FALLBACK_COLOR;
          const avatarText = displayNameWithFallback(
            si,
            si.translations,
            locale,
            "short",
          );
          return (
            <li key={sl.id}>
              <MemberChip
                href={`/${locale}/members/${si.id}/${si.slug}`}
                name={{
                  text:
                    displayNameWithFallback(si, si.translations, locale) ||
                    t("unknownMember"),
                  lang: fallbackNameLang(si, si.translations, locale),
                }}
                // Initial from the locale short-name cascade (a
                // recognised handle), separate from the full body name.
                avatarLabel={
                  avatarText
                    ? {
                        text: avatarText,
                        lang: fallbackNameLang(si, si.translations, locale),
                      }
                    : null
                }
                unitName={
                  owningUnit
                    ? {
                        text: displayNameWithFallback(
                          owningUnit,
                          owningUnit.translations,
                          locale,
                        ),
                        lang: fallbackNameLang(
                          owningUnit,
                          owningUnit.translations,
                          locale,
                        ),
                      }
                    : null
                }
                color={color}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );

  const recentEventsPanel = (
    <section className={styles.panel}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{t("recentEvents")}</h2>
        {totalEvents > recentEvents.length && (
          <Link
            href={`${artistHref}?tab=history`}
            scroll={false}
            className={styles.more}
            aria-label={t("viewAllHistory")}
          >
            {t("viewAll")}
          </Link>
        )}
      </div>
      {recentEvents.length === 0 ? (
        <p className={styles.empty}>{t("noEvents")}</p>
      ) : (
        <ul className={styles.list}>
          {recentEvents.map((event) => (
            <li key={event.id}>
              <ArtistEventRow event={event} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const albumsPreview = (
    // "최신 앨범" compact preview. Self-fetching; renders null when the
    // artist has no albums. The full discography lives in the Albums tab.
    <ArtistAlbumsSection
      artistId={artistId}
      artistSlug={artist.slug}
      locale={locale}
      mode="preview"
    />
  );

  const hasLeftColumn = Boolean(unitsPanel || membersPanel);

  // Body is a flex column: `<main>` takes the remaining height
  // (`flex-1`) and `.page` pins `width: 100%` next to its max-width so
  // the column tracks the viewport, not its content.
  return (
    <main className="flex-1">
    <div className={styles.page}>
      <div className={styles.breadcrumb}>
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
            { label: breadcrumbLeafName },
          ]}
        />
      </div>

      {/* Identity: full-width panel (20-v1), no portrait or artwork —
          artists have no managed photos and the redesign adds none.
          The stored artist colour paints only the 5px left stripe. */}
      <section
        className={styles.identity}
        style={accentStyle(artist.color ?? IDENTITY_FALLBACK_ACCENT)}
      >
        <div className={styles.identityCopy}>
          <p className={styles.eyebrow}>
            {t("title")}
            <span className={styles.badge}>{t(`type.${artist.type}`)}</span>
          </p>
          <h1 className={styles.title} lang={headlineLang}>
            {localizedFullName}
          </h1>
          {artistSecondaryName && (
            <p
              className={styles.original}
              lang={originalLang(artist.originalLanguage, locale)}
            >
              {artistSecondaryName}
            </p>
          )}
          {bio && (
            <p className={styles.bio} lang={bioLang}>
              {bio}
            </p>
          )}
        </div>
        <dl className={styles.stats}>
          <div>
            <dt>{t("statsTotalEvents")}</dt>
            <dd>{totalEvents}</dd>
          </div>
          <div>
            <dt>{t("statsCompleted")}</dt>
            <dd>{totalCompleted}</dd>
          </div>
          {subUnits.length > 0 && (
            <div>
              <dt>{t("statsSubUnits")}</dt>
              <dd>{subUnits.length}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* Server-routed `?tab=` links, not ARIA tabs: each tab is a
          fresh server render, so the WAI-ARIA tab pattern (panels in
          one DOM, roving arrow-key focus) would misdescribe the
          interaction. `aria-current` marks the active one. A direct
          `?tab=albums` link to an artist without albums renders the
          empty discography with no tab marked — that tab is hidden. */}
      <nav className={styles.tabs} aria-label={t("tabsAriaLabel")}>
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`${artistHref}?tab=${tab.key}`}
            scroll={false}
            className={styles.tab}
            aria-current={tab.key === activeTab ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {activeTab === "overview" &&
        (hasLeftColumn ? (
          <div className={styles.overview}>
            <div className={styles.stack}>
              {unitsPanel}
              {membersPanel}
            </div>
            <div className={styles.stack}>
              {albumsPreview}
              {recentEventsPanel}
            </div>
          </div>
        ) : (
          <div className={styles.stack}>
            {albumsPreview}
            {recentEventsPanel}
          </div>
        ))}

      {activeTab === "albums" && (
        // Full discography (single-column rows). Self-fetching.
        <ArtistAlbumsSection
          artistId={artistId}
          artistSlug={artist.slug}
          locale={locale}
          mode="full"
        />
      )}

      {activeTab === "history" &&
        (seriesViews.length === 0 ? (
          <section className={styles.panel}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>
                {t("historyHeader", { count: 0 })}
              </h2>
            </div>
            <p className={styles.empty}>{t("noEvents")}</p>
          </section>
        ) : (
          <>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>
                {t("historyHeader", { count: totalEvents })}
              </h2>
            </div>
            <div className={styles.history}>
              {seriesViews.map((sv) => (
                <ArtistHistoryGroup
                  key={sv.key}
                  title={sv.title}
                  titleLang={sv.titleLang}
                  countLabel={t("eventCount", { count: sv.events.length })}
                  liveLabel={sv.hasOngoing ? statusLabels.ongoing : null}
                  columns={{
                    dateStatus: t("historyColumns.dateStatus"),
                    event: t("historyColumns.event"),
                    songs: t("historyColumns.songs"),
                  }}
                >
                  <ul className={styles.list}>
                    {sv.events.map((event) => (
                      <li key={event.id}>
                        <ArtistEventRow event={event} />
                      </li>
                    ))}
                  </ul>
                </ArtistHistoryGroup>
              ))}
            </div>
          </>
        ))}
    </div>
    </main>
  );
}
