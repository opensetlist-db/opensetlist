// Display-layer helper for AlbumTrack rows. Resolves the title to show
// for a given locale by dispatching off the row's pattern (see the
// AlbumTrack model docstring in prisma/schema.prisma for the
// authoritative pattern definitions):
//
//   Pattern 1 (vocal):           track.song.translations / originalTitle
//   Pattern 2 (off-vocal w/ parent): "{parent title} ({variantSuffix})"
//   Pattern 3 (direct title):    track.translations / track.title
//
// The `t` callback is the next-intl root translator — callers pass it
// in (rather than calling `useTranslations` inside the helper) so this
// stays usable from both server (`getTranslations`) and client
// (`useTranslations`) contexts and from any namespace. The Pattern 2
// suffix lives under `AlbumTrack.variantSuffix.<variant>` in the
// per-locale messages files.
import type {
  AlbumTrackModel,
  AlbumTrackTranslationModel,
  SongModel,
  SongTranslationModel,
} from "@/generated/prisma/models";
import { isKnownAlbumTrackVariant } from "@/lib/albumTrackVariants";
import type { BigIntStringified } from "@/lib/utils";

// BigIntStringified-wrapped — `AlbumTracksTab` receives tracks via
// page.tsx's `serializeBigIntAsString(album)` JSON boundary, so the
// `id` / `albumId` / `songId` / `parentSongId` fields arrive as
// strings and `Date` columns as ISO strings. The Prisma-generated
// `Model` types still declare the raw shapes; wrapping keeps the
// dispatch helper signature honest about what survives the wire.
type EnrichedSong = BigIntStringified<
  SongModel & { translations?: SongTranslationModel[] }
>;

export type EnrichedAlbumTrack = BigIntStringified<
  AlbumTrackModel & {
    song?: SongModel & { translations?: SongTranslationModel[] } | null;
    parentSong?: SongModel & { translations?: SongTranslationModel[] } | null;
    translations?: AlbumTrackTranslationModel[];
  }
>;

export function getAlbumTrackTitle(
  track: EnrichedAlbumTrack,
  locale: string,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  // Pattern 1 — vocal Song-backed
  if (track.song) {
    return getSongTitle(track.song, locale);
  }

  // Pattern 2 — off-vocal w/ vocal parent
  // `variant` is the discriminator for the suffix; without it the row
  // shouldn't have a parentSong, but be defensive in case of stale data.
  // The allowlist guard prevents `t()` from emitting a raw key string
  // (e.g. "AlbumTrack.variantSuffix.live") if a stale or misspelled
  // variant ever lands in the DB — we fall back to the raw variant
  // string in that case so the row stays human-readable.
  if (track.parentSong && track.variant) {
    const base = getSongTitle(track.parentSong, locale);
    const suffix = isKnownAlbumTrackVariant(track.variant)
      ? t(`AlbumTrack.variantSuffix.${track.variant}`)
      : track.variant;
    return `${base} (${suffix})`;
  }

  // Pattern 3 — direct title (drama/bgm or a Pattern 2 fallback whose
  // parent didn't resolve at import time). Locale translation wins;
  // original-language title is the fallback; a synthetic "Track N"
  // string is the last resort so the row never renders empty.
  const translated = track.translations?.find((tr) => tr.locale === locale);
  if (translated) return translated.title;
  if (track.title) return track.title;
  return t("AlbumTrack.fallbackTrack", { number: track.trackNumber });
}

function getSongTitle(song: EnrichedSong, locale: string): string {
  const translated = song.translations?.find((tr) => tr.locale === locale);
  return translated?.title ?? song.originalTitle ?? "";
}
