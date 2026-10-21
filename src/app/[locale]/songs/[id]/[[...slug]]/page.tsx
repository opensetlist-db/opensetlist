import { cache } from "react";
import { CACHE_TTL, cachedQuery } from "@/lib/dataCache";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import {
  entityAlternates,
  enforceCanonicalSlug,
  entityPath,
} from "@/lib/seo/entityUrl";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, formatDate } from "@/lib/utils";
import {
  displayNameWithFallback,
  displayOriginalTitle,
} from "@/lib/display";
import { deriveOgPaletteFromCachedSong } from "@/lib/ogPalette";
import { normalizeOgLocale } from "@/lib/ogLabels";
import { getEventStatus } from "@/lib/eventStatus";
import { getSongPerformanceCells } from "@/lib/songPerformance";
import { getSongAlbums } from "@/lib/songAlbums";
import { Breadcrumb } from "@/components/Breadcrumb";
import { SongIdentity } from "@/components/songs/detail/SongIdentity";
import { SongAlbumPanel } from "@/components/songs/detail/SongAlbumPanel";
import { SongTabs } from "@/components/songs/detail/SongTabs";
import { SongHistoryPanel } from "@/components/songs/detail/SongHistoryPanel";
import {
  SongVersionsPanel,
  type SongVersionView,
} from "@/components/songs/detail/SongVersionsPanel";
import {
  groupSongHistory,
  type SongHistoryRow,
} from "@/components/songs/detail/songHistory";
import {
  SONG_HISTORY_DATE_FORMAT,
  utcYear,
} from "@/components/songs/detail/songDate";
import { buildAlbumTypeLabels } from "@/components/songs/detail/albumTypeLabels";
import styles from "@/components/songs/detail/songDetail.module.css";
import type { AlbumType } from "@/generated/prisma/enums";

type Props = {
  params: Promise<{ locale: string; id: string; slug?: string[] }>;
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
// `vocalTracks` is fetched unbounded — b08 dropped the prior
// `take: 1` cap so the sidebar's 수록 앨범 section can render one
// card per album the song appears on. The orderBy chain
// (`album.releaseDate ASC, album.id ASC, discNumber ASC,
// trackNumber ASC`) is deterministic regardless of insertion order
// and matches the user's mental model — "the album where this song
// first appeared." `vocalTracks[0]` post-sort is still the
// earliest-released album, so the existing sidebar `albumInfo`
// stat row that consumes index 0 (replacing the prior
// `getFirstAlbumTrack` standalone helper) reads byte-identically
// to the take:1 era. The full array drives `getSongAlbums` for the
// new section.
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
async function fetchSong(id: bigint) {
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
}

const getSong = cache(
  cachedQuery("song-detail", fetchSong, { revalidate: CACHE_TTL.entity }),
);

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
async function fetchSongPerformances(songId: bigint) {
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
}

const getSongPerformances = cache(
  cachedQuery("song-performances", fetchSongPerformances, { revalidate: CACHE_TTL.entity }),
);

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

  // Group name in the title: song-name queries are ambiguous across
  // IPs (and "Rise Up High! | OpenSetlist" gave no reason to click at
  // position ~11), so name who sings it plus what the page offers.
  const fullSongTitle = `${songTitle}${metaVariant ? ` (${metaVariant})` : ""}`;
  const title = artistName
    ? metaT("songTitle", { title: fullSongTitle, group: artistName })
    : metaT("songTitleNoGroup", { title: fullSongTitle });
  const description = artistName
    ? metaT("songDescription", { title: fullSongTitle, group: artistName })
    : metaT("songDescriptionNoGroup", { title: fullSongTitle });

  const ogImage = `/api/og/song/${id}?lang=${normalizeOgLocale(locale)}&v=${palette.fingerprint}`;
  const alternates = entityAlternates("songs", locale, id, song.slug);

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

export default async function SongPage({ params, searchParams }: Props) {
  const { locale, id, slug } = await params;
  const sp = await searchParams;
  // `requestedTab` is the tab the URL asked for; `activeTab` is the
  // tab we actually render. They diverge when the URL says
  // `?tab=variations` on a song that doesn't have variations — the tab
  // row hides the variations tab in that case, so the body is clamped
  // to `history` once `hasVariations` is known further down.
  const requestedTab = resolveTab(sp.tab);

  let songId: bigint;
  try {
    songId = BigInt(id);
  } catch {
    notFound();
  }

  // `getSong` carries the full `vocalTracks` array + the total
  // performance count inline — see the comment block on `getSong`
  // above for the Sentry-issue context (issue 7504931765). Page render
  // fans out to 2 prisma queries (Song + Performances) plus the
  // version groupBy below.
  const [song, performances] = await Promise.all([
    getSong(songId),
    getSongPerformances(songId),
  ]);

  if (!song) notFound();
  enforceCanonicalSlug("songs", locale, id, song.slug, slug, sp);

  const performanceCount = song._count.setlistItems;

  // Per-album rows for the album panel. `vocalTracks` is sorted
  // oldest-release-first, so the first row is the original recording
  // and also feeds the identity card's album type/title. See
  // src/lib/songAlbums.ts for sort + tiebreak + activeBonusCount
  // semantics.
  const songAlbums = getSongAlbums(song.vocalTracks);

  const [t, ct, et, at] = await Promise.all([
    getTranslations("Song"),
    getTranslations("Common"),
    getTranslations("Event"),
    getTranslations("Artist"),
  ]);
  const albumTypeLabels = buildAlbumTypeLabels(t);

  // Reference instant pinned at the top of the request — every event
  // status downstream resolves against the same `now` (CLAUDE.md UTC
  // rule + matches the artist-page pattern).
  const referenceNow = new Date();

  const title = displayOriginalTitle(song, song.translations, locale);

  // Primary artist drives the identity card's accent border + artist
  // link. Falls back to the first credit by index if no `primary` role
  // is set, then null (no link; a plain "곡" badge).
  const primaryArtist =
    song.artists.find((sa) => sa.role === "primary")?.artist ??
    song.artists[0]?.artist ??
    null;

  const firstAlbum = songAlbums[0]
    ? {
        // Albums are work-primary too — the original title, like the
        // song H1. The locale subtitle stays in the album panel.
        title: displayOriginalTitle(
          songAlbums[0].album,
          songAlbums[0].album.translations,
          locale,
        ).main,
        typeLabel:
          albumTypeLabels[songAlbums[0].album.type as AlbumType] ??
          songAlbums[0].album.type,
      }
    : null;

  // One view row per appearance (SetlistItemSong), grouped by series in
  // `groupSongHistory`.
  const historyRows: SongHistoryRow[] = performances.map((p) => {
    const event = p.setlistItem.event;
    const cells = getSongPerformanceCells(p.setlistItem);
    return {
      // Each appearance is its own row: a song played twice in one
      // event (medley reprise, encore reprise) yields two rows with the
      // same event id, so the key is the setlistItemId.
      id: String(p.setlistItemId),
      seriesId: event.eventSeries ? String(event.eventSeries.id) : null,
      seriesName: event.eventSeries
        ? displayNameWithFallback(
            event.eventSeries,
            event.eventSeries.translations,
            locale,
          ) || null
        : null,
      status: getEventStatus(
        { status: event.status, startTime: event.startTime },
        referenceNow,
      ),
      // Serialized payload: ISO string, so the first 10 characters are
      // the UTC calendar date.
      dateTime: event.date ? String(event.date).slice(0, 10) : "",
      formattedDate: formatDate(event.date, locale, SONG_HISTORY_DATE_FORMAT),
      dateMs: event.date ? new Date(String(event.date)).getTime() : 0,
      name:
        displayNameWithFallback(event, event.translations, locale) ||
        et("unknownEvent"),
      href: entityPath("events", locale, event.id, event.slug),
      isEncore: cells.isEncore,
      position: cells.position,
    };
  });
  const { groups: historyGroups, seriesCount } = groupSongHistory(historyRows);

  // Variations: the base song plus every live version of it, including
  // the current song (highlighted). `baseVersion?.variants ?? variants`
  // keeps the two-level pattern (song-of-base, base-of-variant) without
  // recursing further. Order: base first, then by song id — the order
  // the approved 28-v1 list shows, and deterministic where the previous
  // list followed Prisma's unspecified relation order.
  const baseSong = song.baseVersion ?? song;
  const siblings = (song.baseVersion?.variants ?? song.variants)
    .filter((v) => String(v.id) !== String(baseSong.id))
    .sort((a, b) => Number(a.id) - Number(b.id));
  const versionSources =
    siblings.length > 0 ? [baseSong, ...siblings] : [];

  // Per-version active-performance counts — the same filter as the
  // total count (excludes deleted setlist items + deleted events),
  // batched into one groupBy so each row can show "{N}회 공연" without N
  // extra queries.
  const versionIds = versionSources.map((v) => BigInt(v.id));
  const versionCountRows =
    versionIds.length === 0
      ? []
      : await prisma.setlistItemSong.groupBy({
          by: ["songId"],
          where: {
            songId: { in: versionIds },
            setlistItem: {
              isDeleted: false,
              event: { isDeleted: false },
            },
          },
          _count: { _all: true },
        });
  const versionCountBySongId = new Map<string, number>(
    versionCountRows.map((row) => [String(row.songId), row._count._all]),
  );
  const versions: SongVersionView[] = versionSources.map((v) => {
    const display = displayOriginalTitle(v, v.translations, locale);
    return {
      id: String(v.id),
      slug: v.slug,
      title: display.main,
      sub: display.sub,
      variantLabel: display.variant,
      isBase: String(v.id) === String(baseSong.id),
      isCurrent: String(v.id) === String(song.id),
      performanceCount: versionCountBySongId.get(String(v.id)) ?? 0,
    };
  });

  const hasVariations = versions.length > 1;
  const activeTab: TabKey =
    requestedTab === "variations" && !hasVariations ? "history" : requestedTab;
  const tabs = [
    {
      key: "history" as const,
      label: t("tabHistory", { count: performanceCount }),
    },
    ...(hasVariations
      ? [
          {
            key: "variations" as const,
            label: t("tabVariations", { count: versions.length }),
          },
        ]
      : []),
  ];

  const base = song.baseVersion
    ? {
        id: song.baseVersion.id,
        slug: song.baseVersion.slug,
        title: displayOriginalTitle(
          song.baseVersion,
          song.baseVersion.translations,
          locale,
        ).main,
      }
    : null;

  return (
    // `<main>` is the landmark the skip link targets. It is a block
    // element between body's flex column and the centred column, so
    // `.page` pins width: 100% next to max-width + auto margins.
    <main className={styles.page}>
      <div className={styles.breadcrumb}>
        <Breadcrumb
          ariaLabel={ct("breadcrumb")}
          items={[
            { label: ct("home"), href: `/${locale}` },
            { label: title.main },
          ]}
        />
      </div>

      <SongIdentity
        locale={locale}
        title={title}
        artist={
          primaryArtist
            ? {
                id: primaryArtist.id,
                slug: primaryArtist.slug,
                name:
                  displayNameWithFallback(
                    primaryArtist,
                    primaryArtist.translations,
                    locale,
                  ) || at("unknown"),
                color: primaryArtist.color,
              }
            : null
        }
        base={base}
        releaseYear={utcYear(song.releaseDate)}
        firstAlbum={firstAlbum}
        performanceCount={performanceCount}
        seriesCount={seriesCount}
      />

      <div
        className={`${styles.layout} ${songAlbums.length === 0 ? styles.noAlbums : ""}`}
      >
        <SongAlbumPanel
          rows={songAlbums}
          locale={locale}
          albumTypeLabels={albumTypeLabels}
        />
        <div className={styles.main}>
          <SongTabs
            tabs={tabs}
            active={activeTab}
            basePath={entityPath("songs", locale, song.id, song.slug)}
            ariaLabel={ct("tabsAriaLabel")}
          />
          {activeTab === "variations" ? (
            <SongVersionsPanel versions={versions} locale={locale} />
          ) : (
            <SongHistoryPanel groups={historyGroups} locale={locale} />
          )}
        </div>
      </div>
    </main>
  );
}
