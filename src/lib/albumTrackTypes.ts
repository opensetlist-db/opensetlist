// Plain (non-"use client") module for AlbumTrack admin-form shapes
// that both server pages and client modals need to see. Per the
// project's RSC-boundary rule (memory: feedback_rsc_boundary_constants),
// values exported from a `"use client"` module can resolve to
// `undefined` during server rendering — even pure types are cleaner
// to keep on a server-safe side so the import direction stays
// one-way (client → lib, server → lib).

/**
 * Discriminator the admin form uses to dispatch between the three
 * AlbumTrack row shapes — mirrors b01b's import-side discriminator
 * but lives at the form layer, not on the schema.
 *   - `vocal`              → existing Song connect (Pattern 1)
 *   - `off_vocal_w_parent` → variant + parent Song (Pattern 2)
 *   - `direct`             → variant + title + per-locale translations (Pattern 3)
 */
export type TrackPattern = "vocal" | "off_vocal_w_parent" | "direct";

/**
 * Edit-side initial payload for AlbumTrackFormModal. The pattern
 * value drives which other fields are meaningful — Pattern 1 reads
 * `songId`, Pattern 2 reads `parentSongId` + `variant`, Pattern 3
 * reads `variant` + `title` + `titleLanguage` + `translations`.
 *
 * `selectedSongLabel` is purely display-side — the Korean-resolved
 * title of `song` / `parentSong` so the modal can echo the picked
 * row without a second fetch on open.
 */
export type TrackInitial = {
  id?: string;
  albumId: string;
  pattern: TrackPattern;
  discNumber: number;
  trackNumber: number;
  songId: number | null;
  parentSongId: number | null;
  variant: string | null;
  title: string | null;
  titleLanguage: string | null;
  translations: { locale: string; title: string }[];
  selectedSongLabel: string;
};
