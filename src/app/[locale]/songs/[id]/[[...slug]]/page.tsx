import { cache } from "react";
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
  displayOriginalTitle,
} from "@/lib/display";
import { deriveOgPaletteFromCachedSong } from "@/lib/ogPalette";
import { normalizeOgLocale } from "@/lib/ogLabels";
import { getEventStatus, type ResolvedEventStatus } from "@/lib/eventStatus";
import {
  getSongPerformanceCells,
  type SongPerformanceCells,
} from "@/lib/songPerformance";
import { BRAND_GRADIENT } from "@/lib/artistColor";
import { Breadcrumb } from "@/components/Breadcrumb";
import { InfoCard } from "@/components/InfoCard";
import { TabBar } from "@/components/TabBar";
import { SectionLabel } from "@/components/SectionLabel";
import { AlbumCard } from "@/components/AlbumCard";
import { getSongAlbums } from "@/lib/songAlbums";
import {
  PerformanceGroup,
  type PerformanceSeries,
  type PerformanceEvent,
} from "@/components/PerformanceGroup";
// Layout primitives import directly from the server-safe module — NOT
// from `PerformanceGroup.tsx` (which carries `"use client"`). Crossing
// the RSC boundary for plain values can resolve them to `undefined` at
// SSR, which produces invalid CSS like `padding: 8px 16px 8px undefinedpx`
// — silently rejected by the browser, dropping padding to 0 and
// breaking the column-header strip's alignment with the row tracks.
import {
  PERFORMANCE_ROW_GRID,
  PERFORMANCE_ROW_INDENT_PX,
  PERFORMANCE_ROW_GAP_PX,
  STATUS_BADGE_INDENT_PX,
  STATUS_COL_IDX,
  TRAILING_COL_IDX,
} from "@/components/performance-row-layout";
import type { AlbumType } from "@/generated/prisma/enums";
import { colors, radius, shadows } from "@/styles/tokens";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};

const TABS = ["history", "variations"] as const;
type TabKey = (typeof TABS)[number];

function resolveTab(value: string | string[] | undefined): TabKey {
  const v = Array.isArray(value) ? value[0] : value;
  return TABS.includes(v as TabKey) ? (v as TabKey) : "history";
}

// Wrapped in `react.cache()` so the duplicate call across
// `generateMetadata` and `SongPage` collapses to one DB fetch per
// request. Cache is per-request, scoped by RSC's request memoization
// — no cross-request leakage. Matches the same pattern PR #260 set
// up for `getEvent` on the event detail page; without this wrapper,
// every full SongPage render fired the nested-include mega-query
// twice (~220ms each in Sentry trace
// feb38ab569e7432b8960b6a42f6cffaf).
//
// `albumTracks` + `_count.setlistItems` folded inline (Sentry issue
// 7504931765, traced on /en/songs/12/kibouteki-prism): the previous
// standalone `prisma.albumTrack.findFirst` (`getFirstAlbumTrack`,
// 190.7ms) and `prisma.setlistItemSong.count` (`getPerformanceCount`,
// 182.7ms) were both parallel siblings under the page render parent,
// sharing Sentry's prisma db_query group hash with `Song.findFirst`
// and `SetlistItemSong.findMany take:50` — five sibling spans hashing
// to one group trips the ≥4 N+1 detector. Folding the album +
// performance-count reads into this query's LATERAL tree drops the
// page's prisma fan-out from 5 → 3 (Song + Performances + variant
// groupBy), comfortably below the detector threshold while keeping
// the variant `groupBy` isolated (cross-variant aggregation,
// SQL-efficient as a single set operation — see `page.tsx:512`).
//
// `vocalTracks: { take: 1 }` picks the earliest-released album as
// the canonical "first" (matches the prior `getFirstAlbumTrack`
// semantics: `album.releaseDate ASC, discNumber ASC, trackNumber
// ASC` is deterministic regardless of insertion order and matches
// the user's mental model — "the album where this song first
// appeared"; disc/track as secondary so re-issues + special editions
// don't overrule the original release).
//
// b01b note: `albumTracks` was split into `vocalTracks` (this song
// is the vocal — Pattern 1) and `offVocalTracks` (this song is the
// vocal *parent* of an off-vocal AlbumTrack on the same album —
// Pattern 2). The sidebar "first album" only makes sense for the
// vocal side, so we only walk `vocalTracks` here.
//
// `_count: { select: { setlistItems: { where: ... } } }` mirrors the
// prior `getPerformanceCount` filter exactly (`SetlistItem.isDeleted
// = false AND Event.isDeleted = false`) so the sidebar's "total
// performances" number is identical pre/post-fold.
const getSong = cache(async (id: bigint) => {
  const song = await prisma.song.findFirst({
    where: { id, isDeleted: false },
    include: {
      translations: true,
      artists: {
        include: {
          artist: { include: { translations: true } },
        },
      },
      variants: {
        where: { isDeleted: false },
        include: { translations: true },
      },
      baseVersion: {
        include: {
          translations: true,
          variants: {
            where: { isDeleted: false },
            include: { translations: true },
          },
        },
      },
      // Albums this song appears on (Pattern 1 vocal AlbumTracks).
      // Ordered earliest-release-first so vocalTracks[0] continues to
      // feed the sidebar's existing `albumInfo` stat row (replacing
      // the original `getFirstAlbumTrack` standalone helper folded
      // inline per the Sentry-issue comment block above), AND the
      // full array drives the b08 수록 앨범 section beneath the
      // performance count box. The previous `take: 1` cap is dropped
      // — the section needs every album, and Phase 2 catalog scale
      // makes the unbounded fetch trivially small (typical song
      // sits on 1–3 albums; outliers like anniversary compilations
      // hit ~5 max).
      //
      // Include extensions vs the take:1 era:
      //   - `artists.artist.translations` — feeds the gradient
      //     fallback color on AlbumCard's cover thumbnail when an
      //     album has no `imageUrl` (uses the first credited
      //     artist's `color`).
      //   - `listings.bonuses` — supplies the active-bonus count
      //     for AlbumCard's 特典 N badge. Mirrors the formula
      //     AlbumInfoCard already uses (see lib/songAlbums.ts).
      vocalTracks: {
        orderBy: [
          { album: { releaseDate: "asc" } },
          { album: { id: "asc" } },
          { discNumber: "asc" },
          { trackNumber: "asc" },
        ],
        include: {
          album: {
            include: {
              translations: true,
              artists: {
                include: {
                  artist: { include: { translations: true } },
                },
              },
              listings: {
                include: { bonuses: true },
              },
            },
          },
        },
      },
      // Total active performance count. Filter mirrors the prior
      // `getPerformanceCount` exactly — see the comment block above.
      _count: {
        select: {
          setlistItems: {
            where: {
              setlistItem: {
                isDeleted: false,
                event: { isDeleted: false },
              },
            },
          },
        },
      },
    },
  });
  if (!song) return null;
  return serializeBigInt(song);
});

// Wrapped in `react.cache()` for the same reason as `getSong` above:
// `generateMetadata` now consumes the performance list to derive the
// OG palette (via `deriveOgPaletteFromCachedSong`), and `SongPage`
// then iterates the same list for the history-tab rendering. Without
// the cache the two callers would each fire a separate (identical)
// query.
//
// The `performers.stageIdentity.color` projection is added solely
// for the palette derivation — the page body itself never reads it.
// Adding it here (instead of a separate query) is the substitute for
// the standalone `collectSongPerformerColors` SQL the prior
// `deriveOgPaletteFromSong(songId)` was firing: Sentry trace
// feb38ab569e7432b8960b6a42f6cffaf measured that query at 392ms
// against /ja/songs/17/deepness. Folding it into this query — which
// was going to run anyway for the history tab — saves the entire
// roundtrip on a full page render.
//
// Trade-off vs the standalone query: `take: 50` now bounds the
// palette's frequency sample to the 50 most recent performances. For
// Phase 1A this is invisible (no song hits 50 performances), but it
// IS a quiet behavior change for songs that eventually exceed that
// threshold — the palette will shift slightly toward whichever units
// have been performing the song recently. The operator accepted this
// trade-off when scoping the fix.
const getSongPerformances = cache(async (songId: bigint) => {
  // Limit to 50 for now — Phase 1A songs don't exceed that yet.
  // The total count is fetched separately so the sidebar number is
  // accurate even if the list is truncated.
  const performances = await prisma.setlistItemSong.findMany({
    where: {
      songId,
      setlistItem: { isDeleted: false, event: { isDeleted: false } },
    },
    include: {
      setlistItem: {
        // Setlist `note` is not surfaced on any public page (operator
        // decision, 2026-04-29) — omitted to keep the payload small
        // and aligned with the event detail page's same omit.
        omit: { note: true },
        include: {
          event: {
            include: {
              translations: true,
              eventSeries: { include: { translations: true } },
            },
          },
          // Performer colors only — used by
          // `deriveOgPaletteFromCachedSong` to build the frequency
          // map. The page body does not read these.
          performers: {
            select: {
              stageIdentity: { select: { color: true } },
            },
          },
        },
      },
    },
    orderBy: { setlistItem: { event: { date: "desc" } } },
    take: 50,
  });
  return serializeBigInt(performances);
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const metaT = await getTranslations({ locale, namespace: "Meta" });
  if (!/^\d+$/.test(id)) return { title: metaT("notFound") };
  const songId = BigInt(id);
  // Load the cached song + the cached performance list in parallel.
  // Both are wrapped in `react.cache`, so `SongPage` re-uses the same
  // results (no second roundtrip). The palette is derived
  // in-process from those two payloads — see
  // `deriveOgPaletteFromCachedSong` for what was previously two extra
  // Prisma queries (`SongArtist.findFirst` for the anchor +
  // `SetlistItemSong.findMany` for the performer frequency map, 237ms
  // and 392ms respectively in Sentry trace
  // feb38ab569e7432b8960b6a42f6cffaf on /ja/songs/17/deepness).
  const [song, performances] = await Promise.all([
    getSong(songId),
    getSongPerformances(songId),
  ]);
  if (!song) return { title: metaT("notFound") };
  const palette = await deriveOgPaletteFromCachedSong(song, performances);
  // Songs are work-primary: OG title shows the original-language
  // title with the locale-resolved variant label. Going through
  // `displayOriginalTitle` instead of hand-resolving via
  // `pickLocaleTranslation` keeps the OG meta in lockstep with the
  // detail-page H1 (which already uses the helper) — so a shared
  // OG card never reads a different title than the page itself.
  const { main: songTitle, variant: metaVariant } = displayOriginalTitle(
    song,
    song.translations,
    locale,
  );
  const firstArtist = song.artists[0]?.artist ?? null;
  const artistName = firstArtist
    ? displayNameWithFallback(firstArtist, firstArtist.translations, locale)
    : null;

  const title = `${songTitle}${metaVariant ? ` (${metaVariant})` : ""} | OpenSetlist`;
  const description = artistName
    ? `${artistName} · ${metaT("performanceHistory")}`
    : metaT("performanceHistory");

  const ogImage = `/api/og/song/${id}?lang=${normalizeOgLocale(locale)}&v=${palette.fingerprint}`;
  const pageUrl = `/${locale}/songs/${id}/${song.slug}`;

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

export default async function SongPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const sp = await searchParams;
  // `requestedTab` is the tab the URL asked for; `activeTab` is the
  // tab we actually render. They diverge when the URL says
  // `?tab=variations` on a song that doesn't have variations — the
  // <TabBar> hides the variations tab in that case, but without
  // this clamp the body tries to render `activeTab === "variations"`
  // and shows nothing. Force `history` when variations isn't an
  // option. Computed after `hasVariations` is known further down.
  const requestedTab = resolveTab(sp.tab);

  let songId: bigint;
  try {
    songId = BigInt(id);
  } catch {
    notFound();
  }

  // `getSong` now carries the first AlbumTrack + the total performance
  // count inline via its `vocalTracks: { take: 1 }` + `_count.setlistItems`
  // includes — see the comment block on `getSong` above for the
  // Sentry-issue context (issue 7504931765). Page render fans out to
  // 2 prisma queries now (Song + Performances) instead of the prior 4.
  const [song, performances] = await Promise.all([
    getSong(songId),
    getSongPerformances(songId),
  ]);

  if (!song) notFound();

  const albumTrack = song.vocalTracks[0] ?? null;
  const performanceCount = song._count.setlistItems;

  // b08: per-album rows for the sidebar's 수록 앨범 section. Same
  // input array the existing `albumTrack` (line above) reads from —
  // the sort order is now ASC-by-releaseDate (oldest first), so
  // vocalTracks[0] is still the canonical album just like before
  // the take:1 → unbounded change. See src/lib/songAlbums.ts for
  // sort + tiebreak + activeBonusCount semantics.
  const songAlbums = getSongAlbums(song.vocalTracks);

  const [t, ct, et, at] = await Promise.all([
    getTranslations("Song"),
    getTranslations("Common"),
    getTranslations("Event"),
    getTranslations("Artist"),
  ]);

  // Reference instant pinned at the top of the request — every event
  // status downstream resolves against the same `now` (CLAUDE.md UTC
  // rule + matches the artist-page pattern).
  const referenceNow = new Date();

  const { main, sub, variant } = displayOriginalTitle(
    song,
    song.translations,
    locale,
  );

  // Primary artist drives the sidebar `<ColorStripe>` + the artist
  // badge. Falls back to first artist by index if no `primary` role
  // is set, then null (which makes ColorStripe use BRAND_GRADIENT).
  const primaryArtist =
    song.artists.find((sa) => sa.role === "primary")?.artist ??
    song.artists[0]?.artist ??
    null;
  const primaryArtistName = primaryArtist
    ? displayNameWithFallback(
        primaryArtist,
        primaryArtist.translations,
        locale,
      ) || at("unknown")
    : null;

  // Album info for the sidebar stats. Only the first album is shown
  // (mockup intent — Phase 1A songs are single-album in practice;
  // multi-album list is a Phase 2 concern).
  const albumInfo = albumTrack
    ? (() => {
        // Albums are work-primary too — same helper as song titles
        // so the sidebar reads the same original-language label that
        // the song detail H1 reads above. `displayOriginalTitle.main`
        // is the original; the locale subtitle (`.sub`) is dropped
        // here because the sidebar row only carries one line.
        const { main: albumName } = displayOriginalTitle(
          albumTrack.album,
          albumTrack.album.translations,
          locale,
        );
        return { name: albumName, type: albumTrack.album.type };
      })()
    : null;

  // Build a flat per-performance view-model first, then group by
  // series for `<PerformanceGroup>`. Same shape as the artist page —
  // each entry carries enough data to render the row + sort.
  // `trailing` is pre-rendered server-side: PerformanceGroup is a
  // client component, and React refuses to serialize a function prop
  // (e.g. a `renderTrailing` callback) across the RSC boundary.
  // ReactNode trees do serialize, so the trailing JSX lives here.
  type PerformanceView = PerformanceEvent & {
    seriesId: number | null;
    seriesName: string | null;
    rawDateMs: number;
  };

  const performanceViews: PerformanceView[] = [];
  const tourSeriesIds = new Set<number>();
  for (const p of performances) {
    const event = p.setlistItem.event;
    const status = getEventStatus(
      { status: event.status, startTime: event.startTime },
      referenceNow,
    );
    const seriesId = event.eventSeries
      ? Number(event.eventSeries.id)
      : null;
    if (seriesId !== null) tourSeriesIds.add(seriesId);
    const seriesName = event.eventSeries
      ? displayNameWithFallback(
          event.eventSeries,
          event.eventSeries.translations,
          locale,
        ) || null
      : null;
    const eventName =
      displayNameWithFallback(event, event.translations, locale) ||
      et("unknownEvent");
    const cells = getSongPerformanceCells(p.setlistItem);
    performanceViews.push({
      // React key. Each appearance is a SetlistItemSong row, so use
      // its setlistItemId (unique per appearance) instead of
      // `event.id`. A song that appears twice in one event (medley
      // reprise, encore reprise) produces two performances with the
      // same `event.id`, which collided as duplicate React keys and
      // could mis-attribute trailing cells (#position, encore badge)
      // on collapse / expand or tab switches.
      id: String(p.setlistItemId),
      seriesId,
      seriesName,
      status,
      formattedDate: formatDate(event.date, locale, HISTORY_ROW_DATE_FORMAT),
      name: eventName,
      href: `/${locale}/events/${event.id}/${event.slug}`,
      rawDateMs: new Date(String(event.date)).getTime(),
      trailing: (
        <SongRowTrailing cells={cells} encoreLabel={t("encoreBadge")} />
      ),
    });
  }

  // Group by series. Performances with no series go into a synthetic
  // "Other performances" bucket at the end — keeps standalone events
  // (festivals, one-offs) discoverable instead of dropping them.
  const seriesBuckets = new Map<string, PerformanceView[]>();
  const ungrouped: PerformanceView[] = [];
  for (const view of performanceViews) {
    if (view.seriesId === null) {
      ungrouped.push(view);
    } else {
      const key = String(view.seriesId);
      const bucket = seriesBuckets.get(key);
      if (bucket) bucket.push(view);
      else seriesBuckets.set(key, [view]);
    }
  }

  type SongSeriesView = PerformanceSeries & { sortKey: number };
  const seriesViews: SongSeriesView[] = [];
  for (const bucket of seriesBuckets.values()) {
    // Within a series, keep the desc-by-date order produced by the
    // top-level Prisma orderBy.
    bucket.sort((a, b) => b.rawDateMs - a.rawDateMs);
    const hasOngoing = bucket.some((v) => v.status === "ongoing");
    const mostRecentMs = bucket.reduce(
      (m, v) => (v.rawDateMs > m ? v.rawDateMs : m),
      0,
    );
    seriesViews.push({
      seriesId: String(bucket[0].seriesId),
      seriesShort: bucket[0].seriesName ?? et("unknownEvent"),
      hasOngoing,
      events: bucket,
      sortKey: hasOngoing ? Number.MAX_SAFE_INTEGER : mostRecentMs,
    });
  }
  seriesViews.sort((a, b) => b.sortKey - a.sortKey);

  if (ungrouped.length > 0) {
    ungrouped.sort((a, b) => b.rawDateMs - a.rawDateMs);
    seriesViews.push({
      seriesId: "ungrouped",
      seriesShort: et("ungrouped"),
      hasOngoing: ungrouped.some((v) => v.status === "ongoing"),
      events: ungrouped,
      sortKey: 0,
    });
  }

  // Variations: include the current song so the user sees the
  // "현재" highlight. `baseVersion?.variants ?? variants` keeps the
  // two-level pattern (song-of-base, base-of-variant) without
  // recursing further.
  type VariantSong = (typeof song)["variants"][number];
  const variantSiblings: VariantSong[] = song.baseVersion?.variants ?? song.variants;
  const variationList: Array<{
    id: number;
    slug: string;
    title: string;
    variantLabel: string | null;
    isCurrent: boolean;
    isBase: boolean;
  }> = [];
  // Each variant is a Song; resolve via `displayOriginalTitle` so
  // the variants list is internally consistent with the page H1
  // (both work-primary). `.main` is the original title; `.variant`
  // is the locale-resolved variant label that powers the row's
  // "기본" / variant pill.
  if (song.baseVersion) {
    // Current song is itself a variant — list base + siblings.
    const baseDisplay = displayOriginalTitle(
      song.baseVersion,
      song.baseVersion.translations,
      locale,
    );
    variationList.push({
      id: Number(song.baseVersion.id),
      slug: song.baseVersion.slug,
      title: baseDisplay.main,
      variantLabel: baseDisplay.variant,
      isCurrent: false,
      isBase: true,
    });
  }
  for (const v of variantSiblings) {
    const vDisplay = displayOriginalTitle(v, v.translations, locale);
    variationList.push({
      id: Number(v.id),
      slug: v.slug,
      title: vDisplay.main,
      variantLabel: vDisplay.variant,
      isCurrent: Number(v.id) === Number(song.id),
      isBase: false,
    });
  }
  // If the current song is itself a base (no `baseVersion`) and we
  // already pushed its variants above, add the base itself at the
  // top with `isCurrent: true`.
  if (!song.baseVersion && variationList.length > 0) {
    variationList.unshift({
      id: Number(song.id),
      slug: song.slug,
      title: main,
      variantLabel: variant ?? null,
      isCurrent: true,
      isBase: true,
    });
  }

  // Per-variant active-performance counts. Mirrors the filter from
  // getPerformanceCount() (excludes deleted setlist items + deleted
  // events), but batched into a single round-trip via groupBy so
  // each variant row can show "{N}회 공연" without N extra queries.
  const variantSongIds = variationList.map((v) => BigInt(v.id));
  const variantCountRows =
    variantSongIds.length === 0
      ? []
      : await prisma.setlistItemSong.groupBy({
          by: ["songId"],
          where: {
            songId: { in: variantSongIds },
            setlistItem: {
              isDeleted: false,
              event: { isDeleted: false },
            },
          },
          _count: { _all: true },
        });
  const variantCountBySongId = new Map<string, number>(
    variantCountRows.map((row) => [String(row.songId), row._count._all]),
  );
  const variationListWithCounts = variationList.map((v) => ({
    ...v,
    timesPerformed: variantCountBySongId.get(String(v.id)) ?? 0,
  }));

  const hasVariations = variationList.length > 1;
  // Clamp `requestedTab` against what's actually available. The
  // <TabBar> hides the variations tab when `hasVariations` is false,
  // so leaving activeTab pinned to "variations" would render an
  // empty body with the history tab visually unselected.
  const activeTab: TabKey =
    requestedTab === "variations" && !hasVariations
      ? "history"
      : requestedTab;

  const tabs = [
    {
      key: "history",
      label: t("tabHistory", { count: performanceCount }),
    },
    ...(hasVariations
      ? [
          {
            key: "variations",
            label: t("tabVariations", { count: variationList.length }),
          },
        ]
      : []),
  ];

  // Exhaustive AlbumType → label map. Using a Record keyed on the
  // Prisma enum (rather than a dynamic `t(\`albumType.${type}\`)`
  // template) means a future enum addition (e.g. `compilation`) is a
  // TypeScript error here, not a silent missing-key fallback in the
  // info-card render.
  const albumTypeLabels: Record<AlbumType, string> = {
    single: t("albumType.single"),
    album: t("albumType.album"),
    ep: t("albumType.ep"),
    live_album: t("albumType.live_album"),
    soundtrack: t("albumType.soundtrack"),
  };

  const statusLabels: Record<ResolvedEventStatus, string> = {
    // Mirror events list / home hero — the ongoing pill on row-shaped
    // surfaces reads "LIVE" rather than the locale "진행중" /
    // "開催中" / "Live now". Same `Event.live` key used by both.
    ongoing: et("live"),
    upcoming: et("status.upcoming"),
    completed: et("status.completed"),
    cancelled: et("status.cancelled"),
  };

  return (
    <main style={{ minHeight: "100vh", background: colors.bgPage }}>
      <div className="mx-auto" style={{ maxWidth: 1100, padding: "0 16px" }}>
        <Breadcrumb
          ariaLabel={ct("breadcrumb")}
          items={[
            { label: ct("home"), href: `/${locale}` },
            { label: main },
          ]}
        />

        {/* See artist-page comment on the same wrapper — `grid-cols-1`
            on mobile clamps the implicit track to viewport so nowrap
            text inside cards can't push the grid wider than the
            screen. */}
        <div
          className="grid grid-cols-1 lg:grid-cols-[280px_1fr] lg:gap-7"
          style={{ alignItems: "start", paddingBottom: 60 }}
        >
          {/* Sidebar */}
          <div
            // `min-w-0` overrides the grid-item default `min-width: auto`
            // so the sidebar (and its children) can shrink to the column
            // track instead of expanding the column to fit min-content.
            // Mirrored on the Main grid item below — without this the
            // history-tab row's grid-intrinsic width pushes the page
            // wider than the mobile viewport (horizontal scroll bar).
            className="lg:sticky lg:top-[72px] min-w-0"
            style={{ marginBottom: 12 }}
          >
            <InfoCard artist={primaryArtist}>
              {primaryArtist && primaryArtistName && (
                <Link
                  href={`/${locale}/artists/${primaryArtist.id}/${primaryArtist.slug}`}
                  style={{ textDecoration: "none" }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      color: primaryArtist.color ?? colors.primary,
                      background: primaryArtist.color
                        ? `${primaryArtist.color}15`
                        : colors.primaryBg,
                      borderRadius: 10,
                      padding: "2px 8px",
                      textTransform: "uppercase",
                    }}
                  >
                    {primaryArtistName}
                  </span>
                </Link>
              )}
              <h1
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: colors.textPrimary,
                  lineHeight: 1.35,
                  marginTop: 10,
                  marginBottom: sub || variant ? 4 : 14,
                }}
              >
                {main}
              </h1>
              {sub && (
                <div
                  style={{
                    fontSize: 13,
                    color: colors.textSecondary,
                    marginBottom: 4,
                  }}
                >
                  {sub}
                </div>
              )}
              {variant && (
                <span
                  style={{
                    display: "inline-block",
                    color: colors.variant,
                    background: colors.variantBg,
                    borderRadius: 10,
                    padding: "2px 9px",
                    fontSize: 11,
                    fontWeight: 600,
                    marginTop: 6,
                    marginBottom: 14,
                  }}
                >
                  {variant}
                </span>
              )}

              {(albumInfo || song.releaseDate) && (
                <dl
                  style={{
                    margin: 0,
                    marginBottom: 18,
                    display: "grid",
                    gridTemplateColumns: "auto 1fr",
                    rowGap: 6,
                    columnGap: 12,
                    fontSize: 12,
                  }}
                >
                  {song.releaseDate && (
                    <>
                      <dt
                        style={{
                          color: colors.textMuted,
                          fontWeight: 600,
                          fontSize: 11,
                        }}
                      >
                        {t("releaseYearLabel")}
                      </dt>
                      <dd
                        style={{
                          color: colors.textPrimary,
                          margin: 0,
                        }}
                      >
                        {new Date(String(song.releaseDate)).getUTCFullYear()}
                      </dd>
                    </>
                  )}
                  {albumInfo && (
                    <>
                      <dt
                        style={{
                          color: colors.textMuted,
                          fontWeight: 600,
                          fontSize: 11,
                        }}
                      >
                        {t("albumLabel")}
                      </dt>
                      <dd
                        style={{
                          color: colors.textPrimary,
                          margin: 0,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {albumInfo.name}
                      </dd>
                      <dt
                        style={{
                          color: colors.textMuted,
                          fontWeight: 600,
                          fontSize: 11,
                        }}
                      >
                        {t("albumTypeLabel")}
                      </dt>
                      <dd
                        style={{
                          color: colors.textPrimary,
                          margin: 0,
                        }}
                      >
                        {albumTypeLabels[albumInfo.type]}
                      </dd>
                    </>
                  )}
                </dl>
              )}

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: BRAND_GRADIENT,
                    color: "white",
                    fontSize: 18,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {performanceCount}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: colors.textPrimary,
                    }}
                  >
                    {t("performanceCount", { count: performanceCount })}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: colors.textMuted,
                    }}
                  >
                    {tourSeriesIds.size} {t("statsTours")}
                  </div>
                </div>
              </div>

              {/* b08: 수록 앨범 section. Sidebar placement per the v2
                  mockup (raw/mockups/song-page-v2-mockup.jsx lines
                  444–463) — separated from the performance count box
                  above by a borderTop divider. Section returns nothing
                  for songs with no album rows (orphans), so the
                  divider is also conditional. Canonical album (oldest
                  releaseDate) gets the bordered + "원본 수록" pill
                  emphasis; siblings render plainer. */}
              {songAlbums.length > 0 && (
                <div
                  style={{
                    borderTop: `1px solid ${colors.borderLight}`,
                    paddingTop: 14,
                    marginTop: 14,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: colors.textMuted,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      marginBottom: 10,
                    }}
                  >
                    {t("albumsSectionLabel")}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    {songAlbums.map((row) => (
                      <AlbumCard
                        key={String(row.album.id)}
                        variant="mini"
                        album={row.album}
                        locale={locale}
                        isCanonical={row.isCanonical}
                        discNumber={row.discNumber}
                        trackNumber={row.trackNumber}
                        activeBonusCount={row.activeBonusCount}
                      />
                    ))}
                  </div>
                  {songAlbums.length > 1 && (
                    <div
                      style={{
                        fontSize: 11,
                        color: colors.textMuted,
                        marginTop: 8,
                        textAlign: "center",
                      }}
                    >
                      {t("albumsTotalCount", { count: songAlbums.length })}
                    </div>
                  )}
                </div>
              )}
            </InfoCard>
          </div>

          {/* Main */}
          <div className="min-w-0">
            <TabBar
              tabs={tabs}
              active={activeTab}
              ariaLabel={ct("tabsAriaLabel")}
            />

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
                    {t("recentPerformances")}
                  </SectionLabel>
                </div>
                {/* Desktop column-header strip — uses the exact same
                    grid template as the row beneath, so the header
                    labels line up with their respective columns.
                    Mobile keeps the existing layout (no strip) — the
                    column header is desktop-only per the mockup. */}
                {seriesViews.length > 0 && (
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
                      t("tableHeader.status"),
                      t("tableHeader.date"),
                      t("tableHeader.event"),
                      t("tableHeader.position"),
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
                          // Anchor trailing column with row chips
                          // (right-aligned), and pad STATUS by the
                          // badge's internal padding so the header
                          // text aligns with the badge text. See
                          // performance-row-layout.ts for the
                          // detailed rationale.
                          textAlign:
                            i === TRAILING_COL_IDX ? "right" : "left",
                          paddingLeft:
                            i === STATUS_COL_IDX ? STATUS_BADGE_INDENT_PX : 0,
                        }}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                )}
                {seriesViews.length === 0 ? (
                  <p
                    style={{
                      padding: "32px 16px",
                      fontSize: 14,
                      color: colors.textMuted,
                      textAlign: "center",
                    }}
                  >
                    {t("noPerformances")}
                  </p>
                ) : (
                  seriesViews.map((sv) => (
                    <PerformanceGroup
                      key={sv.seriesId}
                      series={sv}
                      statusLabels={statusLabels}
                      eventCountLabel={at("eventCount", {
                        count: sv.events.length,
                      })}
                    />
                  ))
                )}
              </div>
            )}

            {activeTab === "variations" && hasVariations && (
              <div
                style={{
                  background: colors.bgCard,
                  borderRadius: radius.card,
                  overflow: "hidden",
                  boxShadow: shadows.card,
                }}
              >
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {variationListWithCounts.map((v, i) => {
                    const isLast = i === variationListWithCounts.length - 1;
                    const rowStyle = {
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "12px 20px",
                      borderBottom: isLast
                        ? "none"
                        : `1px solid ${colors.borderFaint}`,
                      background: v.isCurrent
                        ? colors.primaryHoverBg
                        : "transparent",
                    } as const;
                    // Wrap title + pills in a single flex:1 container
                    // so the pills hug the title on the left instead
                    // of being pushed to the row's right edge by the
                    // title's own flex:1. The right-side count then
                    // sits on its own column at the row's end.
                    const inner = (
                      <>
                        <div
                          style={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            overflow: "hidden",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 700,
                              color: v.isCurrent
                                ? colors.primary
                                : colors.textPrimary,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {v.title}
                          </span>
                          {v.variantLabel ? (
                            <span
                              style={{
                                color: colors.variant,
                                background: colors.variantBg,
                                borderRadius: 10,
                                padding: "2px 8px",
                                fontSize: 10,
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {v.variantLabel}
                            </span>
                          ) : v.isBase ? (
                            <span
                              style={{
                                color: colors.primary,
                                background: colors.primaryBg,
                                borderRadius: 10,
                                padding: "2px 8px",
                                fontSize: 10,
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {t("baseVariant")}
                            </span>
                          ) : null}
                          {v.isCurrent && (
                            <span
                              style={{
                                color: colors.primary,
                                background: colors.primaryBg,
                                borderRadius: 10,
                                padding: "2px 8px",
                                fontSize: 10,
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {t("currentVariant")}
                            </span>
                          )}
                        </div>
                        <span
                          style={{
                            fontSize: 12,
                            color: colors.textMuted,
                            flexShrink: 0,
                          }}
                        >
                          {t("performanceCount", { count: v.timesPerformed })}
                        </span>
                        {!v.isCurrent && (
                          <span
                            aria-hidden="true"
                            style={{
                              fontSize: 13,
                              color: colors.borderSubtle,
                              flexShrink: 0,
                            }}
                          >
                            ›
                          </span>
                        )}
                      </>
                    );
                    return (
                      <li key={v.id}>
                        {v.isCurrent ? (
                          <div style={{ ...rowStyle, cursor: "default" }}>
                            {inner}
                          </div>
                        ) : (
                          <Link
                            href={`/${locale}/songs/${v.id}/${v.slug}`}
                            className="row-hover-bg"
                            style={{
                              ...rowStyle,
                              textDecoration: "none",
                              color: "inherit",
                            }}
                          >
                            {inner}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

interface SongRowTrailingProps {
  cells: SongPerformanceCells;
  encoreLabel: string;
}

function SongRowTrailing({ cells, encoreLabel }: SongRowTrailingProps) {
  return (
    <>
      {cells.isEncore && (
        <span
          style={{
            color: colors.variant,
            background: colors.variantBg,
            borderRadius: radius.chip,
            padding: "2px 8px",
            fontSize: 10,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {encoreLabel}
        </span>
      )}
      <span
        style={{
          color: colors.textSubtle,
          background: colors.borderLight,
          borderRadius: radius.chip,
          padding: "2px 8px",
          fontSize: 10,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        #{cells.position}
      </span>
    </>
  );
}
