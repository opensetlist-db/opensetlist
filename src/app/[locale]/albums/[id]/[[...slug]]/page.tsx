import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

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
};

export default async function AlbumDetailPage({ params }: Props) {
  const { locale, id } = await params;
  // Numeric-id guard mirrors the event/song detail pages — a non-numeric
  // path segment isn't an album we can render, so route past metadata
  // straight to 404 rather than throwing on BigInt(...) coercion.
  if (!/^\d+$/.test(id)) notFound();
  const album = await getAlbum(BigInt(id), locale);
  if (!album) notFound();

  // Body composition lands across the next b02 step commits in this
  // PR: Step 2 adds the AlbumInfoCard sidebar; Step 3 adds the TabBar
  // and the bonus/tracks/events tab content slots. This commit emits
  // only the page chrome + the original-language album title so the
  // route returns a non-empty response between steps. The title is a
  // DB value (Album.originalTitle) — not a hardcoded UI string — so
  // it doesn't trip the i18n hard rule.
  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 16px" }}>
      <h1>{album.originalTitle}</h1>
    </main>
  );
}
