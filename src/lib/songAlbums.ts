// Pure transformer for the Song page's 수록 앨범 sidebar section
// (b08). Takes the page-fetched `vocalTracks` array (Pattern 1
// AlbumTrack rows whose `songId` matches the current song) and
// returns one ordered row per album, flagged canonical-first.
//
// Sort rules:
//   1. Album.releaseDate ASC — oldest album wins canonical. Albums
//      with NULL releaseDate sort to the end (defensive: rare per
//      operator data discipline, but cheap to guard).
//   2. Tie-break by Album.id ASC — deterministic when two albums
//      share a date (anniversary BOX shipping same day as a
//      single, etc.) or when both are NULL.
//
// `isCanonical` flag set on the first row only; downstream renders
// (AlbumCard mini variant) read it for the bordered emphasis +
// "원본 수록" pill.
//
// `activeBonusCount` mirrors the formula AlbumInfoCard already uses
// for the Album detail sidebar (`src/components/AlbumInfoCard.tsx`
// lines 143–145) — listings that aren't `ended` × their bonus
// arrays. Sharing the exact same shape across both surfaces avoids
// the "tab badge says 5, sidebar says 4" divergence that earlier
// Album-page work hit.
import { isEndedListing } from "@/lib/albumBonusDisplay";

// Structural input shape. Stays narrow (only fields the transformer
// reads) so the page can hand the Prisma payload directly without
// adapter glue. `albumId` / `songId` etc. live on the row but aren't
// read here. Numbers + strings both accepted for ids per the
// LiveSetlistItem precedent — page passes serializeBigInt(song) so
// runtime ids are Numbers, TS types still say bigint; the
// transformer doesn't care which.
export type SongAlbumsVocalTrack = {
  discNumber: number;
  trackNumber: number;
  album: SongAlbumsAlbum | null;
};

export type SongAlbumsAlbum = {
  id: string | number | bigint;
  slug: string;
  type: string;
  releaseDate: string | Date | null;
  imageUrl: string | null;
  originalTitle: string;
  originalLanguage: string;
  translations: Array<{ locale: string; title: string }>;
  artists: Array<{
    artist: {
      color: string | null;
      translations: Array<{ locale: string; name: string }>;
    };
  }>;
  listings: Array<{
    status: string;
    bonuses: Array<unknown>;
  }>;
};

export type SongAlbumRow = {
  album: SongAlbumsAlbum;
  discNumber: number;
  trackNumber: number;
  isCanonical: boolean;
  activeBonusCount: number;
};

function getReleaseDateMs(date: string | Date | null): number {
  if (date === null) return Number.POSITIVE_INFINITY; // NULL sorts last
  const d = date instanceof Date ? date : new Date(date);
  const ms = d.getTime();
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

function albumIdAsString(id: string | number | bigint): string {
  return typeof id === "string" ? id : String(id);
}

function countActiveBonuses(
  listings: SongAlbumsAlbum["listings"],
): number {
  return listings
    .filter((l) => !isEndedListing(l))
    .reduce((sum, l) => sum + l.bonuses.length, 0);
}

export function getSongAlbums(
  vocalTracks: ReadonlyArray<SongAlbumsVocalTrack>,
): SongAlbumRow[] {
  // 1. Drop rows whose album was soft-deleted or otherwise missing.
  //    Post-b01b this shouldn't happen for Pattern 1 rows (vocal
  //    tracks always FK to a live Album), but the guard keeps a
  //    stale dataset from crashing the render.
  const live = vocalTracks.filter(
    (t): t is SongAlbumsVocalTrack & { album: SongAlbumsAlbum } =>
      t.album !== null,
  );

  // 2. Dedupe by album.id — a song can sit on the same album at more
  //    than one disc/track position (medley reprises, intro+full
  //    pairings). The section answers "which albums is this song
  //    on?" with one entry per album; the surviving row carries the
  //    lowest-disc-then-track position as the canonical context. The
  //    input is expected to already be sorted by (releaseDate ASC,
  //    album.id ASC, disc ASC, track ASC) per the page's Prisma
  //    orderBy chain, so a simple "first wins" pass over a Map
  //    preserves the lowest-position pick without a second sort.
  const dedupedByAlbum = new Map<string, SongAlbumsVocalTrack & { album: SongAlbumsAlbum }>();
  for (const t of live) {
    const key = albumIdAsString(t.album.id);
    if (!dedupedByAlbum.has(key)) {
      dedupedByAlbum.set(key, t);
    }
  }
  const deduped = [...dedupedByAlbum.values()];

  // 3. Sort by Album.releaseDate ASC, with Album.id ASC tiebreak.
  //    Re-sort defensively in case the caller hands us an unsorted
  //    array — the dedupe step's first-wins behaviour is only
  //    canonical-correct if the upstream sort is intact. Cheap on
  //    Phase 1/2 scale (<10 albums per song).
  const sorted = deduped.sort((a, b) => {
    const ra = getReleaseDateMs(a.album.releaseDate);
    const rb = getReleaseDateMs(b.album.releaseDate);
    if (ra !== rb) return ra - rb;
    const ia = albumIdAsString(a.album.id);
    const ib = albumIdAsString(b.album.id);
    const na = BigInt(ia);
    const nb = BigInt(ib);
    return na < nb ? -1 : na > nb ? 1 : 0;
  });

  return sorted.map((track, i) => ({
    album: track.album,
    discNumber: track.discNumber,
    trackNumber: track.trackNumber,
    isCanonical: i === 0,
    activeBonusCount: countActiveBonuses(track.album.listings),
  }));
}
