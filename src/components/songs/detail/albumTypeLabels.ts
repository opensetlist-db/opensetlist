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
