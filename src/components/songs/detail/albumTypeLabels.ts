import type { AlbumType } from "@/generated/prisma/enums";

/*
 * Exhaustive AlbumType → label map for the Song detail page. A Record
 * keyed on the Prisma enum (rather than a dynamic `t(\`albumType.${type}\`)`)
 * makes a future enum value a TypeScript error at the call site that
 * builds the map, not a silent missing-key fallback in the render.
 */
export type AlbumTypeLabels = Record<AlbumType, string>;

export function buildAlbumTypeLabels(
  t: (key: `albumType.${AlbumType}`) => string,
): AlbumTypeLabels {
  return {
    single: t("albumType.single"),
    album: t("albumType.album"),
    ep: t("albumType.ep"),
    live_album: t("albumType.live_album"),
    soundtrack: t("albumType.soundtrack"),
  };
}

/*
 * Label for an album row's `type`. The song payload types it as a plain
 * string (`SongAlbumsAlbum.type`, shared with AlbumCard), so the lookup
 * narrows here once instead of casting at each call site; a value outside
 * the enum shows as-is rather than blank.
 */
export function albumTypeLabel(labels: AlbumTypeLabels, type: string): string {
  return Object.hasOwn(labels, type) ? labels[type as AlbumType] : type;
}
