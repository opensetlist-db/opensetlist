// Shared Album-side constants used by both the admin form and the
// admin PATCH route. The five values mirror the AlbumType Prisma
// enum — kept as a typed tuple so the form's <option> list and the
// route's validation Set derive from the same source. A schema-side
// enum addition surfaces a TS error here until both sides update.

import type { AlbumType } from "@/generated/prisma/enums";

export const ALBUM_TYPES: readonly AlbumType[] = [
  "single",
  "album",
  "ep",
  "live_album",
  "soundtrack",
] as const;

export const ALBUM_TYPE_SET: ReadonlySet<AlbumType> = new Set(ALBUM_TYPES);
