import type { Prisma } from "@/generated/prisma/client";
import { createEventDisplayOrdering } from "@/lib/eventDisplayOrder";
import { readEventDisplayOrder, withDisplayIds } from "@/lib/readEventDisplayOrder";
import { prisma } from "@/lib/prisma";
import { byStageIdentityOrderBy } from "@/lib/memberOrder";

function fetchAdminEvent(tx: Prisma.TransactionClient, id: bigint) {
  return tx.event.findFirst({
    where: { id, isDeleted: false },
    include: {
      translations: true,
      eventSeries: { include: { translations: true } },
      performers: {
        orderBy: byStageIdentityOrderBy(),
        include: {
          stageIdentity: {
            include: {
              translations: true,
              artistLinks: {
                include: { artist: { include: { translations: true } } },
              },
            },
          },
        },
      },
      setlistItems: {
        where: { isDeleted: false },
        include: {
          songs: {
            include: { song: { include: { translations: true } } },
            orderBy: { order: "asc" },
          },
          performers: {
            orderBy: byStageIdentityOrderBy(),
            include: {
              stageIdentity: { include: { translations: true, artistLinks: { select: { artistId: true, sortOrder: true } } } },
            },
          },
          artists: {
            include: {
              artist: { include: { translations: true } },
            },
          },
        },
        orderBy: { position: "asc" },
      },
    },
  });
}

export async function getAdminEventWithOrderedSetlist(id: bigint, includeArtistOrder = false) {
  return prisma.$transaction(async (tx) => {
    const row = await fetchAdminEvent(tx, id);
    if (!row) return null;
    const ordering = createEventDisplayOrdering(await readEventDisplayOrder(tx, id, row.setlistItems));
    const artistOrder = includeArtistOrder ? await tx.artist.findMany({
      where: { isDeleted: false },
      select: { id: true, parentArtistId: true, type: true, sortOrder: true },
    }) : undefined;
    return { ...row, artistOrder, setlistItems: row.setlistItems.map((item) => withDisplayIds(ordering.sortItem(item))) };
  }, { isolationLevel: "RepeatableRead" });
}
