import { prisma } from "@/lib/prisma";
import { CACHE_TTL, cachedQuery } from "@/lib/dataCache";

/**
 * In-memory view of the `Artist.parentArtistId` tree.
 *
 * Why a whole-table load instead of recursive SQL: the tree is small
 * (hundreds of artists, two scalar columns each), it changes only on
 * operator writes, and several callers need different walks over it
 * (root-of for the festival picker groups, descendants-of for the
 * picker catalog scope, and the builder's member matching later). One
 * cached read serves all of them; a recursive CTE per call would cost
 * a round-trip each and still need the same post-processing.
 *
 * Ids are normalised to strings internally. Callers hand us a mix of
 * `bigint` (raw Prisma rows) and `number` (anything that went through
 * `serializeBigInt`), and `1n === 1` is `false` — the exact bug that
 * once emptied the picker (see the `getAvailableSongs` docstring).
 * String keys make every lookup type-agnostic.
 */
export interface ArtistHierarchy {
  /** child id → parent id (null for roots). Every non-deleted artist
   *  has an entry, so "missing" means "unknown or deleted". */
  parentOf: Map<string, string | null>;
  /** parent id → direct child ids. */
  childrenOf: Map<string, string[]>;
}

type IdLike = bigint | number | string;

export function buildArtistHierarchy(
  rows: ReadonlyArray<{ id: IdLike; parentArtistId: IdLike | null }>,
): ArtistHierarchy {
  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    const id = String(r.id);
    const parent = r.parentArtistId === null ? null : String(r.parentArtistId);
    parentOf.set(id, parent);
    if (parent !== null) {
      const siblings = childrenOf.get(parent);
      if (siblings) siblings.push(id);
      else childrenOf.set(parent, [id]);
    }
  }
  return { parentOf, childrenOf };
}

/**
 * Top of the chain above `id`. Returns `id` itself for a root, and
 * also for an id the hierarchy doesn't know (deleted / not loaded) —
 * treating an unknown artist as its own root degrades to "one more
 * group" rather than silently dropping a performer.
 *
 * A parent that is itself missing from the map (soft-deleted parent)
 * ends the walk at the last known node. The `seen` guard makes a
 * malformed cycle terminate instead of hanging the render.
 */
export function rootOf(h: ArtistHierarchy, id: IdLike): string {
  let current = String(id);
  const seen = new Set<string>([current]);
  for (;;) {
    const parent = h.parentOf.get(current);
    if (parent === undefined || parent === null) return current;
    if (!h.parentOf.has(parent) || seen.has(parent)) return current;
    seen.add(parent);
    current = parent;
  }
}

/**
 * `id` plus every artist below it, at any depth (breadth-first, so the
 * root is first and direct children precede grandchildren). Depth-1 is
 * the norm today (group → unit / solo), but the picker scope must not
 * silently drop a deeper node if one is ever modelled.
 */
export function descendantsOf(h: ArtistHierarchy, id: IdLike): string[] {
  const root = String(id);
  const out = [root];
  const seen = new Set(out);
  for (let i = 0; i < out.length; i++) {
    for (const child of h.childrenOf.get(out[i]) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
    }
  }
  return out;
}

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
