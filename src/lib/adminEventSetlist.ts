import type { Prisma } from "@/generated/prisma/client";
import { createEventDisplayOrdering } from "@/lib/eventDisplayOrder";
import { readEventDisplayOrder } from "@/lib/readEventDisplayOrder";
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

export async function getAdminEventWithOrderedSetlist(id: bigint) {
  return prisma.$transaction(async (tx) => {
    const row = await fetchAdminEvent(tx, id);
    if (!row) return null;
    const guests = row.performers.filter((performer) => performer.isGuest).map(({ stageIdentityId }) => stageIdentityId);
    const ordering = createEventDisplayOrdering(await readEventDisplayOrder(tx, row.setlistItems, guests));
    return { ...row, setlistItems: row.setlistItems.map(ordering.sortItem) };
  }, { isolationLevel: "RepeatableRead" });
}
