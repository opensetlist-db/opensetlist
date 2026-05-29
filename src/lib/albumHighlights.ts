import type { Prisma } from "@/generated/prisma/client";
import { FALLBACK_LOCALE } from "@/i18n/routing";

/*
 * Collect the distinct, non-null BD album ids referenced by a set of
 * events (each event optionally points at one live-BD album via
 * Event.bdAlbumId). Used by the Series tour-BD catalog to fan the
 * series' events out to their BD albums.
 *
 * Pure + generic over the id type so it's unit-testable with plain
 * numbers and works whether the caller passes raw BigInt ids (server
 * query) or already-serialized Number ids. First-occurrence order is
 * preserved (a Set keyed on the value), though the caller re-sorts the
 * resolved albums by release date anyway — the dedupe is what matters
 * here, not the order.
 */
export function collectBdAlbumIds<T>(
  events: ReadonlyArray<{ bdAlbumId: T | null }>,
): T[] {
  const ids = new Set<T>();
  for (const e of events) {
    if (e.bdAlbumId !== null) ids.add(e.bdAlbumId);
  }
  return [...ids];
}

/*
 * Shared Prisma include for the b09 album-highlight surfaces:
 *   - Artist page "최신 앨범" hero + discography (ArtistAlbumsSection)
 *   - Series page tour-BD catalog (SeriesBdAlbumsSection)
 *   - Album page "관련 앨범" sidebar (RelatedAlbumsSection)
 *
 * Produces exactly the fields <AlbumCard>'s `mini` + `hero` variants
 * read, nothing more:
 *   - base scalars (id, slug, type, releaseDate, imageUrl,
 *     originalTitle, originalLanguage) come for free with any
 *     findMany — no projection needed
 *   - `translations` → per-locale album title, narrowed to the
 *     requested locale + the ja-original fallback (same pattern as the
 *     album detail page's getAlbum; avoids pulling the whole locale
 *     Cartesian product)
 *   - `artists.artist.{color, translations}` → the primary artist's
 *     brand color seeds AlbumCard's gradient cover fallback; the
 *     translations satisfy the AlbumCardAlbum shape (AlbumCard doesn't
 *     render the artist name itself in either variant, but the type
 *     requires the field, and keeping it lets a future variant surface
 *     the artist without a query change)
 *   - `listings.bonuses` → feeds countActiveBonuses() for the green
 *     特典 N badge
 *
 * Locale-dependent (the translations `where`), so this is a function,
 * not a const. `satisfies Prisma.AlbumInclude` keeps the shape
 * type-checked against the schema without widening the inferred type.
 */
export function albumCardInclude(locale: string) {
  const localeFilter = { locale: { in: [locale, FALLBACK_LOCALE] } };
  return {
    translations: { where: localeFilter },
    artists: {
      include: {
        artist: {
          select: {
            color: true,
            translations: {
              where: localeFilter,
              select: { locale: true, name: true },
            },
          },
        },
      },
    },
    listings: {
      include: { bonuses: true },
    },
  } satisfies Prisma.AlbumInclude;
}
