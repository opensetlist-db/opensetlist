import { prisma } from "@/lib/prisma";

export async function getBonusCheckQueue(albumId?: bigint) {
  const rows = await prisma.albumStoreBonus.findMany({
    where: { listing: {
      albumId,
      OR: [
        { includesPerformanceVideo: true },
        { includesPerformanceVideo: null, album: { bdEvents: { some: { isDeleted: false } } } },
      ],
    } },
    relationLoadStrategy: "join",
    include: {
      listing: { include: { album: { select: { originalTitle: true } } } },
      lifecycle: {
        take: 1,
        orderBy: [{ observedAt: "desc" }, { appliedAt: "desc" }, { operationId: "asc" }],
        select: { action: true, evidenceUrl: true, observedAt: true, summary: true },
      },
    },
    orderBy: [{ listing: { albumId: "asc" } }, { listing: { officialOrder: "asc" } }, { id: "asc" }],
  });
  const now = new Date();
  type Entry = Omit<(typeof rows)[number], "lifecycle"> & {
    latestObservation: (typeof rows)[number]["lifecycle"][number] | null;
  };
  const queue = { current: [] as Entry[], review: [] as Entry[], ended: [] as Entry[] };
  for (const { lifecycle: [latestObservation = null], ...bonus } of rows) {
    const { listing } = bonus;
    const entry = {
      ...bonus,
      latestObservation,
      lastVerifiedAt: bonus.lastVerifiedAt ?? (
        latestObservation?.action === "end" || latestObservation?.action === "restore"
          ? latestObservation.observedAt : null
      ),
    };
    if (bonus.endedAt || (bonus.endsAt && bonus.endsAt <= now) ||
        listing.status === "ended" || (listing.endsAt && listing.endsAt <= now)) {
      queue.ended.push(entry);
    } else if (latestObservation?.action === "review_needed" || latestObservation?.action === "access_failed") {
      queue.review.push(entry);
    } else {
      queue.current.push(entry);
    }
  }
  return queue;
}
