import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { AlbumType } from "@/generated/prisma/enums";
import { AlbumInfoCard } from "@/components/AlbumInfoCard";
import { AlbumBonusTab } from "@/components/AlbumBonusTab";
import { AlbumTracksTab } from "@/components/AlbumTracksTab";
import { AlbumRelatedEventsTab } from "@/components/AlbumRelatedEventsTab";
import { TabBar } from "@/components/TabBar";
import {
  getAlbumRelatedEvents,
  type RelatedEvent,
} from "@/lib/albumRelatedEvents";
import { colors, radius } from "@/styles/tokens";
import { resolveLocalizedField, displayNameWithFallback } from "@/lib/display";
import { normalizeOgLocale } from "@/lib/ogLabels";

/*
 * Tab discriminator. `live_bd` albums skip the Tracks tab entirely
 * (the BD doesn't carry a recorded-song tracklist in the same sense
 * an audio album does) and default to the Related Events tab so the
 * first thing a viewer lands on is the show(s) the BD captures.
 * Every other album type defaults to the Bonus tab — the primary
 * purchase surface and the win-win monetization landing per the
 * monetization-economics 매장特典 framing.
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
 * Event detail page's pattern (`{ locale: { in: [locale, "ja"] } }`):
 * fetch the requested locale plus the canonical ja-original fallback,
 * not the whole locale Cartesian product. The display helpers cascade
 * through the parent row's `original*` columns when neither match.
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
const getAlbum = cache(async (id: bigint, locale: string) => {
  const localeFilter = { locale: { in: [locale, "ja"] } };
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
  return serializeBigInt(album);
});

type Props = {
  params: Promise<{ locale: string; id: string; slug?: string[] }>;
  searchParams: Promise<{ tab?: string }>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
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
  const artistName = primaryArtist
    ? displayNameWithFallback(primaryArtist, primaryArtist.translations, locale)
    : "";

  const fullTitle = t("meta.titleTemplate", { title, artist: artistName });
  const description = t("meta.descriptionTemplate", { title });

  const ogImage = `/api/og/album/${id}?lang=${normalizeOgLocale(locale)}`;
  // Numeric ID is the canonical URL per CLAUDE.md's URL strategy
  // ("Numeric ID is canonical — slug is decorative only, for SEO and
  // readability."). The slug-bearing path is a display variant that
  // crawlers should be told to consolidate onto the numeric URL.
  const canonicalUrl = `/${locale}/albums/${id}`;
  const displayUrl = `/${locale}/albums/${id}/${album.slug}`;

  return {
    title: fullTitle,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: fullTitle,
      description,
      // og:url uses the display URL — that's the link people share
      // and the URL the unfurl preview should label. The
      // alternates.canonical above tells the search index where to
      // consolidate the signal.
      url: displayUrl,
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

  // Wrong-slug redirect per CLAUDE.md URL strategy: numeric ID is
  // canonical; the slug segment is a display-only decoration. An
  // incoming path with a slug that doesn't match the album's
  // canonical slug (`/albums/42/wrong-slug`, `/albums/42/foo/bar`,
  // a copy-pasted URL from a since-renamed album) 308s back to the
  // canonical numeric-ID URL `/albums/42`. The bare numeric URL
  // (`/albums/42`, no slug at all) and the matched-slug URL
  // (`/albums/42/<album.slug>`) both render directly — they're both
  // valid surfaces, and crawlers are told via the alternates.canonical
  // metadata that the numeric URL is the one to consolidate signal
  // onto.
  const incomingSlug = (slug ?? []).join("/");
  if (incomingSlug !== "" && incomingSlug !== album.slug) {
    permanentRedirect(`/${locale}/albums/${id}`);
  }

  const t = await getTranslations({ locale, namespace: "Album" });

  // Type-aware tab visibility: live_bd albums hide the Tracks tab
  // (BDs don't carry an audio-track listing). Bonus + Events tabs
  // always show.
  const showTracks = album.type !== AlbumType.live_album;
  const visibleTabs: AlbumTabKey[] = ["bonus"];
  if (showTracks) visibleTabs.push("tracks");
  visibleTabs.push("events");
  const defaultTab: AlbumTabKey = album.type === AlbumType.live_album ? "events" : "bonus";
  const activeTab = resolveActiveTab(rawTab, visibleTabs, defaultTab);

  const tabs = visibleTabs.map((key) => ({
    key,
    label: t(`tab.${key}`),
  }));

  // Events tab uses its own cached helper rather than the main getAlbum
  // tree because the query is type-aware (different WHERE clause on
  // live_album vs everything else) and lives off a different relation
  // graph. Only fetch when the user actually landed on the events tab —
  // saves a roundtrip on the bonus / tracks views. react.cache wrap
  // inside getAlbumRelatedEvents collapses re-calls if anything else
  // in this request asks the same question.
  //
  // album.tracks comes back from serializeBigInt with `songId` already
  // narrowed to number | null (BigInt → Number JSON round-trip), so
  // we BigInt() the filtered survivors back here for the helper's
  // bigint[] signature.
  let relatedEvents: RelatedEvent[] = [];
  if (activeTab === "events") {
    // `track` instead of `t` so the parameter doesn't shadow the
    // outer `t = getTranslations(...)` namespace translator a few
    // statements up — a future read site adding a `t("...")` call
    // inside this chain would otherwise silently receive the
    // AlbumTrack row instead of a localized string.
    const pattern1SongIds = album.tracks
      .map((track) => track.songId)
      .filter((sid): sid is NonNullable<typeof sid> => sid !== null && sid !== undefined)
      .map((sid) => BigInt(String(sid)));
    relatedEvents = await getAlbumRelatedEvents(
      BigInt(id),
      album.type as AlbumType,
      pattern1SongIds,
      locale,
    );
  }

  return (
    <main
      style={{
        maxWidth: 1080,
        margin: "0 auto",
        padding: "24px 16px",
        display: "grid",
        gridTemplateColumns: "minmax(0, 280px) minmax(0, 1fr)",
        gap: 24,
        alignItems: "start",
      }}
    >
      <aside>
        <AlbumInfoCard album={album} locale={locale} />
      </aside>
      <section>
        <TabBar tabs={tabs} active={activeTab} ariaLabel={t("tabsAriaLabel")} />
        {/* All three tabs now render real data panels (b03 / b04).
            Explicit per-activeTab branches stay verbose rather than
            collapsing into a map so a future revisit of any single
            tab's component swap doesn't ripple through the others. */}
        {activeTab === "bonus" ? (
          <AlbumBonusTab album={album} locale={locale} />
        ) : activeTab === "tracks" ? (
          <AlbumTracksTab tracks={album.tracks} locale={locale} />
        ) : (
          <AlbumRelatedEventsTab
            events={relatedEvents}
            albumType={album.type as AlbumType}
            locale={locale}
          />
        )}
      </section>
    </main>
  );
}
