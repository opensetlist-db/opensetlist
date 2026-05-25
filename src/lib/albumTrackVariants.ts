// Canonical allowlist of `AlbumTrack.variant` values + a narrowing guard.
//
// Mirrors the discriminator values documented in the AlbumTrack model
// docstring (prisma/schema.prisma): Pattern 2 uses one of
// `off-vocal | instrumental | karaoke`; Pattern 3 uses `drama | bgm`.
// The column itself is plain String (not a Prisma enum, by design — the
// set is small enough to maintain in TypeScript but loose enough that
// future variants can land without a destructive schema migration), so
// the importer and the display helper both consult this list to reject
// operator typos before they reach the DB or the rendered page.
export const KNOWN_ALBUM_TRACK_VARIANTS = [
  "off-vocal",
  "instrumental",
  "karaoke",
  "drama",
  "bgm",
] as const;

export type AlbumTrackVariant = (typeof KNOWN_ALBUM_TRACK_VARIANTS)[number];

export function isKnownAlbumTrackVariant(v: string): v is AlbumTrackVariant {
  return (KNOWN_ALBUM_TRACK_VARIANTS as readonly string[]).includes(v);
}
