import { cache } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { AlbumType } from "@/generated/prisma/enums";
import { AlbumInfoCard } from "@/components/AlbumInfoCard";
import { TabBar } from "@/components/TabBar";
import { colors } from "@/styles/tokens";

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
  const { locale, id } = await params;
  const { tab: rawTab } = await searchParams;
  // Numeric-id guard mirrors the event/song detail pages — a non-numeric
  // path segment isn't an album we can render, so route past metadata
  // straight to 404 rather than throwing on BigInt(...) coercion.
  if (!/^\d+$/.test(id)) notFound();
  const album = await getAlbum(BigInt(id), locale);
  if (!album) notFound();

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
        {/* Tab body slots are placeholders for the b03 (bonus grid)
            and b04 (tracks + related events) follow-on tasks. The
            i18n key strings explain the empty state in the viewer's
            locale so the placeholder period never reads as a broken
            page. */}
        <div
          style={{
            background: colors.bgCard,
            borderRadius: 12,
            padding: "32px 20px",
            textAlign: "center",
            color: colors.textMuted,
            fontSize: 14,
          }}
        >
          {t(`tabBody.${activeTab}`)}
        </div>
      </section>
    </main>
  );
}
