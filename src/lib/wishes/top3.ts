import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import type { FanTop3Entry } from "@/lib/types/setlist";

/**
 * Per-event "fan TOP-3 wished songs" loader. Single source of truth
 * for the SongWish groupBy + Song findMany pair so the polled
 * `/api/setlist` channel and the standalone GET on
 * `/api/events/[id]/wishes` produce identical shapes — a future
 * change to the matching rules (e.g. tightening the `isDeleted`
 * filter, swapping the locale fallback) lives in one place.
 *
 * Behavior:
 *   - Bounded `take: 3` count-desc + `songId asc` tie-break for
 *     deterministic ordering when two songs share a wish count.
 *   - Soft-deleted songs (`Song.isDeleted = true`) are excluded — a
 *     wish row pointing at a since-deleted song just drops out of
 *     the TOP-3 instead of rendering as "Unknown song". Same
 *     consistency contract POST enforces (it 404s on soft-deleted
 *     songs, so they can't be added in the first place).
 *   - Translation join trimmed to `[locale, "ja"]` when locale is
 *     provided; full set otherwise (rare path used by the standalone
 *     GET when no `?locale=` query param is given).
 *   - `serializeBigInt` casts BigInt fields to numbers at runtime;
 *     the `as unknown as ...` is the project's established
 *     boundary cast (see page.tsx:617). `flatMap`-with-empty for the
 *     "song was deleted between groupBy and findMany" race instead
 *     of `null`+filter, so the type predicate dance stays out.
 */
export async function fetchEventWishlistTop3(
  eventId: bigint,
  locale: string | null,
): Promise<FanTop3Entry[]> {
  const groups = await prisma.songWish.groupBy({
    by: ["songId"],
    where: { eventId },
    _count: { _all: true },
    orderBy: [{ _count: { id: "desc" } }, { songId: "asc" }],
    take: 3,
  });
  if (groups.length === 0) return [];

  const songIds = groups.map((g) => g.songId);
  const localeFilter = locale ? { locale: { in: [locale, "ja"] } } : undefined;
  const songs = await prisma.song.findMany({
    where: { id: { in: songIds }, isDeleted: false },
    select: {
      id: true,
      originalTitle: true,
      originalLanguage: true,
      variantLabel: true,
      baseVersionId: true,
      translations: {
        where: localeFilter,
        select: { locale: true, title: true, variantLabel: true },
      },
    },
  });
  const songById = new Map(songs.map((s) => [s.id, s] as const));

  return groups.flatMap((g) => {
    const song = songById.get(g.songId);
    if (!song) return [];
    return [
      {
        count: g._count._all,
        song: serializeBigInt(song) as unknown as FanTop3Entry["song"],
      },
    ];
  });
}
