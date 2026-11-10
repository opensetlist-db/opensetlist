import { createOfficialOrdering, type ArtistOrderKey, type MemberDisplayContext } from "./officialOrder";
import type { MemberOrderKey } from "./memberOrder";

type AdminMember = MemberOrderKey & {
  readonly artistLinks: readonly { readonly artistId: bigint; readonly sortOrder: number | null }[];
};

/**
 * Keep catalog repair screens available for legacy cycles. Only cycle
 * edges are ignored in this copied ordering snapshot; stored relationships
 * and returned rows stay intact. All other ordering uses the common contract.
 */
export function createAdminOfficialOrdering(artists: readonly ArtistOrderKey[]) {
  const parents = new Map(artists.map((artist) => [String(artist.id), artist.parentArtistId === null ? null : String(artist.parentArtistId)]));
  const cyclic = new Set<string>();
  const visited = new Set<string>();
  for (const start of parents.keys()) {
    const path: string[] = [];
    const positions = new Map<string, number>();
    let current: string | null = start;
    while (current !== null && parents.has(current) && !visited.has(current)) {
      const position = positions.get(current);
      if (position !== undefined) {
        for (const id of path.slice(position)) cyclic.add(id);
        break;
      }
      positions.set(current, path.length);
      path.push(current);
      current = parents.get(current)!;
    }
    for (const id of path) visited.add(id);
  }
  return createOfficialOrdering(artists.map((artist) => cyclic.has(String(artist.id))
    ? { ...artist, parentArtistId: null }
    : artist));
}

/** Catalog administration deliberately includes historical memberships. */
export function sortAdminMembers<T>(
  rows: readonly T[],
  key: (row: T) => AdminMember,
  artists: readonly ArtistOrderKey[],
  context: MemberDisplayContext = { kind: "mixed" },
): T[] {
  const groups = new Set(artists.filter((artist) => artist.type === "group").map((artist) => String(artist.id)));
  return createAdminOfficialOrdering(artists).sortMembers(rows, (row) => {
    const member = key(row);
    return {
      ...member,
      membershipOrders: member.artistLinks,
      groupArtistIds: member.artistLinks.filter((link) => groups.has(String(link.artistId))).map((link) => link.artistId),
    };
  }, context);
}
