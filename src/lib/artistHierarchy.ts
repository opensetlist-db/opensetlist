import { prisma } from "@/lib/prisma";
import { CACHE_TTL, cachedQuery } from "@/lib/dataCache";
import { buildArtistHierarchy, type ArtistHierarchy } from "@/lib/artistHierarchyTree";

// The pure tree type + walks live in `artistHierarchyTree.ts` so client
// code can use them; re-exported here so server callers don't care.
export {
  buildArtistHierarchy,
  descendantsOf,
  rootOf,
  type ArtistHierarchy,
} from "@/lib/artistHierarchyTree";

// Whole-tree read. Rides the global `public-data` tag that every
// `cachedQuery` carries, so admin artist writes (which call
// `revalidatePublicData()`) expire it alongside the rest of the
// catalog; the entity TTL is only the backstop for out-of-band edits.
const getArtistHierarchyRowsCached = cachedQuery(
  "artist-hierarchy",
  () =>
    prisma.artist.findMany({
      where: { isDeleted: false },
      select: { id: true, parentArtistId: true },
    }),
  { revalidate: CACHE_TTL.entity },
);

export async function getArtistHierarchyCached(): Promise<ArtistHierarchy> {
  return buildArtistHierarchy(await getArtistHierarchyRowsCached());
}
