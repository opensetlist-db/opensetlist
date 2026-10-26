import { prisma } from "@/lib/prisma";
import { CACHE_TTL, cachedQuery, eventTag } from "@/lib/dataCache";

// Separate from the live snapshot and the wide event read: only the
// upcoming festival picker needs these IDs. Catalog writes expire the
// public tag; the dedicated settings save expires this event's tag.
export const getEventCollaborationArtistIdsCached = cachedQuery(
  "event-collaboration-artists",
  async (eventId: bigint) => {
    const rows = await prisma.eventCollaborationArtist.findMany({
      where: {
        eventId,
        artist: { isDeleted: false, isSideProject: true, parentArtistId: null },
      },
      select: { artistId: true },
      orderBy: { artistId: "asc" },
    });
    return rows.map((row) => row.artistId);
  },
  { revalidate: CACHE_TTL.event, tags: (eventId) => [eventTag(eventId)] },
);
