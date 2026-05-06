/**
 * Pure match-highlight rule for wishlist + predicted-setlist surfaces.
 *
 * Returns true when the user's wished/predicted song appears anywhere
 * in the event's actual setlist. Two rules combined:
 *
 *  1. **Direct**: a song in any `SetlistItem.songs[]` has `id === wishedSongId`.
 *  2. **Variant (forward)**: a song in any `SetlistItem.songs[]` has
 *     `baseVersionId === wishedSongId` — i.e. the actual setlist
 *     contains a variant of the wished base. Spec example: wished
 *     "Dream Believers" hits actual "Dream Believers (105th Ver.)".
 *
 * Both surfaces feed `<SongSearch>` with `includeVariants={false}` (its
 * default), so wishedSongId always points to a base song and the
 * forward direction is the only variant case we need.
 *
 * Medley handling falls out for free: a medley is a SetlistItem with
 * multiple `songs[]` entries; we iterate them all, so any constituent
 * match flips the SetlistItem to "hit". Spec source:
 * `raw/20260503-wish-song-ui-architecture.md` §"Variant 처리".
 *
 * The signature accepts the narrowest possible shape (not the full
 * `LiveSetlistItem`) so unit tests don't need to construct every
 * unrelated field.
 */

export type SongMatchInputItem = {
  songs: Array<{
    song: {
      id: number;
      baseVersionId: number | null;
    };
  }>;
};

export function isSongMatched(
  wishedSongId: number,
  setlistItems: SongMatchInputItem[],
): boolean {
  for (const item of setlistItems) {
    for (const { song } of item.songs) {
      if (song.id === wishedSongId) return true;
      if (song.baseVersionId === wishedSongId) return true;
    }
  }
  return false;
}
