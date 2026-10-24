import { cache } from "react";
import { CACHE_TTL, cachedQuery } from "@/lib/dataCache";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import {
  entityAlternates,
  entityPath,
  enforceCanonicalSlug,
} from "@/lib/seo/entityUrl";
import { prisma } from "@/lib/prisma";
import { serializeBigIntAsString } from "@/lib/utils";
import { AlbumType } from "@/generated/prisma/enums";
import { FireAlbumView } from "@/components/FireAlbumView";
import { resolveStoreKey, countActiveBonuses } from "@/lib/albumBonusDisplay";
import { Breadcrumb, type BreadcrumbItem } from "@/components/Breadcrumb";
import { AlbumIdentity } from "@/components/albums/detail/AlbumIdentity";
import { AlbumTabs } from "@/components/albums/detail/AlbumTabs";
import { AlbumTracksPanel } from "@/components/albums/detail/AlbumTracksPanel";
import { AlbumEventsPanel } from "@/components/albums/detail/AlbumEventsPanel";
import { AlbumPurchasePanel } from "@/components/albums/detail/AlbumPurchasePanel";
import styles from "@/components/albums/detail/albumDetail.module.css";
import {
  getAlbumRelatedEvents,
  getAlbumRelatedEventsCount,
  type RelatedEvent,
} from "@/lib/albumRelatedEvents";
import { resolveLocalizedField, displayOriginalName } from "@/lib/display";
import { normalizeOgLocale } from "@/lib/ogLabels";
import { FALLBACK_LOCALE } from "@/i18n/routing";

/*
 * Tab discriminator. Audio albums show tracks → events → purchase and
 * open on tracks; `live_album` (BD) has no audio tracklist, hides the
 * tracks tab and opens on events. `bonus` is the purchase tab's key —
 * kept as the URL value so existing `?tab=bonus` links still land there.
 */
type AlbumTabKey = "bonus" | "tracks" | "events";

/*
 * Album detail page — `/[locale]/albums/[id]/[[...slug]]/`.
 *
 * Public route shipped in Sprint B1 Task b02. Renders an Album row's
 * sidebar InfoCard + a tab bar whose contents (bonus grid / tracklist
 * / related-events list) are filled in by the b03 / b04 follow-on
 * tasks. This file's job at b02 is to:
 *   1. Resolve the `id` segment to an Album row (notFound if missing
 *      or invalid).
 *   2. Fan out the include tree so b03 / b04 can read from the same
 *      cached fetch via `react.cache()` — no duplicate DB roundtrips
 *      across `generateMetadata` + the page body.
 *   3. Render the sidebar + tab shell with placeholder tab content
 *      until b03 / b04 fill them in.
 *
 * Locale filter on every nested `translations` block mirrors the
 * Event detail page's pattern (`{ locale: { in: [locale, FALLBACK_LOCALE] } }`):
 * fetch the requested locale plus the canonical ja-original fallback,
 * not the whole locale Cartesian product. The display helpers cascade
 * through the parent row's `original*` columns when neither match.
 * `FALLBACK_LOCALE` lives in `src/i18n/routing.ts` so this site and
 * every other consumer (event-page SSR, /api/setlist polling, OG
 * routes, top3 wishes loader, album-related-events helper) move in
 * sync when non-JP IPs eventually require broadening the fallback set.
 *
 * v0.14.x reshape — corrections vs the original task spec which
 * predated b01 / b01b:
 *   - `artists` is the AlbumArtist[] junction, not a single relation
 *     (Album → AlbumArtist → Artist).
 *   - Store bonus data lives on `listings: AlbumStoreListing[]` and
 *     `listings[].bonuses: AlbumStoreBonus[]` (b01 reshape replaced
 *     the single `storeBonuses` collection).
 *   - `imageUrl` is the cover column name (spec called it `coverUrl`).
 *   - `tracks[].song` is nullable post-b01b (Pattern 2/3 rows have
 *     `songId = NULL`); display helpers must null-check before
 *     reaching for `song.translations`.
 */
async function fetchAlbum(id: bigint, locale: string) {
  const localeFilter = { locale: { in: [locale, FALLBACK_LOCALE] } };
  const album = await prisma.album.findUnique({
    where: { id },
    include: {
      translations: { where: localeFilter },
      artists: {
        include: {
          artist: { include: { translations: { where: localeFilter } } },
        },
      },
      // Tracks include is broad enough for b04's tracklist surface to
      // consume via the same cached fetch. b02 itself only reads the
      // length for the sidebar trackCount chip.
      tracks: {
        include: {
          song: { include: { translations: { where: localeFilter } } },
          parentSong: { include: { translations: { where: localeFilter } } },
          translations: { where: localeFilter },
        },
        orderBy: [{ discNumber: "asc" }, { trackNumber: "asc" }],
      },
      // Listings include is broad enough for b03's bonus grid to
      // consume from the same fetch. b02 reads `length` (listingCount)
      // and `status === "ended"` (endedBonusCount derived) for sidebar
      // stats only.
      listings: {
        include: {
          bonuses: {
            include: { translations: { where: localeFilter } },
          },
          translations: { where: localeFilter },
        },
        orderBy: [{ originalStoreName: "asc" }],
      },
    },
  });
  if (!album) return null;
  // Use the string-coercing serializer rather than the number one so
  // album.id / artists[].artist.id / tracks[].song.id /
  // tracks[].parentSong.id / listings[].id / listings[].bonuses[].id
  // all round-trip without precision loss. Downstream components
  // compose hrefs via template literals (string concatenation works
  // identically for string / number / bigint) so the runtime swap
  // from number-ids to string-ids is transparent to the consumer.
  return serializeBigIntAsString(album);
}

const getAlbum = cache(
  cachedQuery("album-detail", fetchAlbum, { revalidate: CACHE_TTL.entity }),
);

type Props = {
  params: Promise<{ locale: string; id: string; slug?: string[] }>;
  searchParams: Promise<{ tab?: string }>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string; slug?: string[] }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const metaT = await getTranslations({ locale, namespace: "Meta" });
  if (!/^\d+$/.test(id)) return { title: metaT("notFound") };

  // Same cached fetch as the page body — react.cache collapses both
  // calls into one DB roundtrip per request.
  const album = await getAlbum(BigInt(id), locale);
  if (!album) return { title: metaT("notFound") };

  const t = await getTranslations({ locale, namespace: "Album" });

  const title =
    resolveLocalizedField(
      album,
      album.translations,
      locale,
      "title",
      "originalTitle",
    ) ?? t("unknown");

  const primaryArtist = album.artists[0]?.artist ?? null;
  // Same helper as the breadcrumb segment + InfoCard sidebar so the
  // OG/meta artist name reads identically to what the page header
  // shows.
  const artistName = primaryArtist
    ? displayOriginalName(primaryArtist, primaryArtist.translations, locale).main
    : "";

  const fullTitle = t("meta.titleTemplate", { title, artist: artistName });
  const description = t("meta.descriptionTemplate", { title });

  const ogImage = `/api/og/album/${id}?lang=${normalizeOgLocale(locale)}`;
  // Canonical = the DB-slug URL, same as every entity page (CLAUDE.md
  // "URL Strategy"); og:url reuses it so shares and the index agree.
  const alternates = entityAlternates("albums", locale, id, album.slug);

  return {
    title: fullTitle,
    description,
    alternates,
    openGraph: {
      title: fullTitle,
      description,
      url: alternates.canonical,
      siteName: "OpenSetlist",
      images: [{ url: ogImage, width: 1200, height: 630, alt: fullTitle }],
      locale,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [ogImage],
      site: "@opensetlistdb",
    },
  };
}

function resolveActiveTab(
  rawTab: string | undefined,
  visibleTabs: ReadonlyArray<AlbumTabKey>,
  defaultTab: AlbumTabKey,
): AlbumTabKey {
  // Sanitise the URL param: a stale or hand-typed value (?tab=foo, or
  // ?tab=tracks on a live_bd album where the tracks tab is hidden)
  // falls back to the type-aware default so the page never renders a
  // tab body that doesn't match the bar above it.
  if (rawTab && (visibleTabs as ReadonlyArray<string>).includes(rawTab)) {
    return rawTab as AlbumTabKey;
  }
  return defaultTab;
}

export default async function AlbumDetailPage({ params, searchParams }: Props) {
  const { locale, id, slug } = await params;
  const { tab: rawTab } = await searchParams;
  // Numeric-id guard mirrors the event/song detail pages — a non-numeric
  // path segment isn't an album we can render, so route past metadata
  // straight to 404 rather than throwing on BigInt(...) coercion.
  if (!/^\d+$/.test(id)) notFound();
  const album = await getAlbum(BigInt(id), locale);
  if (!album) notFound();

  // Bare id (`/albums/42`), a wrong or since-renamed slug, or extra
  // segments (`/albums/42/foo/bar`) all 308 to the canonical
  // `/albums/42/<album.slug>` (CLAUDE.md "URL Strategy").
  enforceCanonicalSlug("albums", locale, id, album.slug, slug, {
    tab: rawTab,
  });

  const t = await getTranslations({ locale, namespace: "Album" });

  const showTracks = album.type !== AlbumType.live_album;
  const visibleTabs: AlbumTabKey[] = [];
  if (showTracks) visibleTabs.push("tracks");
  visibleTabs.push("events");
  visibleTabs.push("bonus");
  const defaultTab: AlbumTabKey = visibleTabs[0];
  const activeTab = resolveActiveTab(rawTab, visibleTabs, defaultTab);

  // Derive Pattern 1 song ids once from the already-loaded album.tracks
  // and hand them to both related-event helpers: their two `react.cache`
  // wraps are separate identities, so letting each derive its own would
  // run `albumTrack.findMany` twice. `songId` arrives as a numeric
  // string (serializeBigIntAsString), so `BigInt(...)` restores it
  // without a lossy Number() hop.
  const pattern1SongIds: bigint[] = album.tracks
    .map((t) => t.songId)
    .filter((sid): sid is string => sid !== null)
    .map((sid) => BigInt(sid));

  // The events badge is needed on every tab, so it comes from the cheap
  // COUNT helper (same WHERE as the list, uncapped). The full list (with
  // its include tree and take: 50) is fetched only when the events tab
  // is the one being rendered.
  const eventsCount = await getAlbumRelatedEventsCount(
    BigInt(id),
    album.type as AlbumType,
    pattern1SongIds,
  );

  // Purchase badge = every bonus including ended ones (the summary box
  // repeats the split); the dot marks that at least one bonus is still
  // current — distinct from the count, visible from any tab.
  const bonusTotal = album.listings.reduce(
    (sum, l) => sum + l.bonuses.length,
    0,
  );
  const tabCounts: Record<AlbumTabKey, number> = {
    bonus: bonusTotal,
    tracks: album.tracks.length,
    events: eventsCount,
  };
  const activeBonusCount = countActiveBonuses(album.listings);
  const tabs = visibleTabs.map((key) => ({
    key,
    label: t(`tab.${key}`),
    count: tabCounts[key],
    indicator: key === "bonus" && activeBonusCount > 0,
  }));

  let relatedEvents: RelatedEvent[] = [];
  if (activeTab === "events") {
    relatedEvents = await getAlbumRelatedEvents(
      BigInt(id),
      album.type as AlbumType,
      locale,
      pattern1SongIds,
    );
  }

  // AlbumArtist has no role column, so the first credited row is the
  // album's primary artist for analytics (`artist_id`). The identity
  // card itself lists every credited artist.
  const primaryArtist = album.artists[0]?.artist ?? null;

  // 22-v1 breadcrumb: Home / Albums / <album>. The leaf is the original
  // title, the same string as the H1.
  const breadcrumbItems: BreadcrumbItem[] = [
    { label: t("breadcrumb.home"), href: `/${locale}` },
    { label: t("breadcrumb.albums"), href: `/${locale}/albums` },
    { label: album.originalTitle },
  ];

  return (
    // `<main>` is the landmark the skip link targets. It is a block
    // element between body's flex column and the centred column, so
    // `max-width` + auto margins centre normally (a direct flex child
    // with mx-auto alone would shrink to content width — see
    // feedback-flex-body-mx-auto); `.page` also pins width: 100%.
    <main className={styles.page}>
      <div className={styles.breadcrumb}>
        <Breadcrumb ariaLabel={t("breadcrumb.aria")} items={breadcrumbItems} />
      </div>
      <AlbumIdentity album={album} locale={locale} />
      <AlbumTabs
        tabs={tabs}
        active={activeTab}
        basePath={entityPath("albums", locale, album.id, album.slug)}
        ariaLabel={t("tabsAriaLabel")}
        indicatorLabel={t("stats.bonusSectionLabel")}
      />
      {activeTab === "tracks" ? (
        <AlbumTracksPanel tracks={album.tracks} locale={locale} />
      ) : activeTab === "events" ? (
        <AlbumEventsPanel
          events={relatedEvents}
          albumType={album.type as AlbumType}
          locale={locale}
        />
      ) : (
        <AlbumPurchasePanel album={album} locale={locale} />
      )}
      {/* `album_view` on client mount; renders nothing.
          `has_amazon_listing` = any listing resolves to Amazon JP (no
          ASIN column — store data lives on productUrl). */}
      <FireAlbumView
        albumId={String(album.id)}
        albumType={album.type}
        artistId={primaryArtist ? String(primaryArtist.id) : ""}
        locale={locale}
        hasAmazonListing={album.listings.some(
          (l) => resolveStoreKey(l.originalStoreName) === "amazon_jp",
        )}
      />
    </main>
  );
}
