import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

type ArtistTranslation = {
  locale: string;
  name: string;
  shortName: string | null;
};

export type ArtistForList = {
  id: number;
  slug: string;
  type: "solo" | "group" | "unit";
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  translations: ArtistTranslation[];
  mostRecentStartMs: number | null;
};

type SeriesAncestor = {
  id: number;
  parentSeriesId: number | null;
  artistId: number | null;
};

const MAX_SERIES_DEPTH = 32;

function getOwningArtistId(
  startSeriesId: number,
  ancestry: Map<number, SeriesAncestor>,
): number | null {
  let cur = startSeriesId;
  for (let i = 0; i < MAX_SERIES_DEPTH; i++) {
    const node = ancestry.get(cur);
    if (!node) return null;
    if (node.artistId != null) return node.artistId;
    if (node.parentSeriesId == null) return null;
    cur = node.parentSeriesId;
  }
  return null;
}

export async function getTopLevelArtists(): Promise<ArtistForList[]> {
  const [artistsRaw, seriesRaw, eventsRaw] = await Promise.all([
    prisma.artist.findMany({
      where: { parentArtistId: null, isDeleted: false },
      select: {
        id: true,
        slug: true,
        type: true,
        originalName: true,
        originalShortName: true,
        originalLanguage: true,
        translations: {
          select: { locale: true, name: true, shortName: true },
        },
      },
    }),
    prisma.eventSeries.findMany({
      where: { isDeleted: false },
      select: { id: true, parentSeriesId: true, artistId: true },
    }),
    prisma.event.findMany({
      where: { isDeleted: false, eventSeriesId: { not: null } },
      select: { eventSeriesId: true, startTime: true },
    }),
  ]);

  const ancestry = new Map(
    (serializeBigInt(seriesRaw) as unknown as SeriesAncestor[]).map((s) => [
      s.id,
      s,
    ]),
  );

  const latestByArtist = new Map<number, number>();
  for (const raw of eventsRaw) {
    if (raw.eventSeriesId == null) continue;
    const seriesId = Number(raw.eventSeriesId);
    const artistId = getOwningArtistId(seriesId, ancestry);
    if (artistId == null) continue;
    const ms = new Date(raw.startTime).getTime();
    const prev = latestByArtist.get(artistId);
    if (prev == null || ms > prev) latestByArtist.set(artistId, ms);
  }

  const serialized = serializeBigInt(artistsRaw) as unknown as Array<
    Omit<ArtistForList, "mostRecentStartMs">
  >;

  return serialized
    .map((a) => ({
      ...a,
      mostRecentStartMs: latestByArtist.get(a.id) ?? null,
    }))
    .sort((a, b) => {
      const am = a.mostRecentStartMs ?? -Infinity;
      const bm = b.mostRecentStartMs ?? -Infinity;
      return bm - am;
    });
}
