// Canonical allowlist of `AlbumTrack.variant` values + narrowing guards.
//
// Mirrors the discriminator values documented in the AlbumTrack model
// docstring (prisma/schema.prisma): Pattern 2 uses one of
// `off-vocal | instrumental | karaoke` and requires a vocal parent on
// the same album; Pattern 3 uses `drama | bgm` and must not have a
// parent. The variant value itself decides which pattern the row is,
// not the presence/absence of `parent_song_slug` — a CSV row whose
// variant says "drama" but also carries a parent slug is a mistake
// (and vice versa), so the importer dispatches on `isPattern2Variant` /
// `isPattern3Variant` and WARNs when the required columns don't match.
//
// The column itself is plain String (not a Prisma enum, by design — the
// set is small enough to maintain in TypeScript but loose enough that
// future variants can land without a destructive schema migration), so
// the importer and the display helper both consult this list to reject
// operator typos before they reach the DB or the rendered page.

export const PATTERN2_ALBUM_TRACK_VARIANTS = [
  "off-vocal",
  "instrumental",
  "karaoke",
] as const;

export const PATTERN3_ALBUM_TRACK_VARIANTS = ["drama", "bgm"] as const;

export const KNOWN_ALBUM_TRACK_VARIANTS = [
  ...PATTERN2_ALBUM_TRACK_VARIANTS,
  ...PATTERN3_ALBUM_TRACK_VARIANTS,
] as const;

export type Pattern2AlbumTrackVariant =
  (typeof PATTERN2_ALBUM_TRACK_VARIANTS)[number];
export type Pattern3AlbumTrackVariant =
  (typeof PATTERN3_ALBUM_TRACK_VARIANTS)[number];
export type AlbumTrackVariant =
  | Pattern2AlbumTrackVariant
  | Pattern3AlbumTrackVariant;

export function isPattern2AlbumTrackVariant(
  v: string,
): v is Pattern2AlbumTrackVariant {
  return (PATTERN2_ALBUM_TRACK_VARIANTS as readonly string[]).includes(v);
}

export function isPattern3AlbumTrackVariant(
  v: string,
): v is Pattern3AlbumTrackVariant {
  return (PATTERN3_ALBUM_TRACK_VARIANTS as readonly string[]).includes(v);
}

export function isKnownAlbumTrackVariant(v: string): v is AlbumTrackVariant {
  return (KNOWN_ALBUM_TRACK_VARIANTS as readonly string[]).includes(v);
}
