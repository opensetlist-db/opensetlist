import { createOfficialOrdering, type ArtistOrderKey, type MemberDisplayContext } from "./officialOrder";
import type { MemberOrderKey } from "./memberOrder";

type AdminMember = MemberOrderKey & {
  readonly artistLinks: readonly { readonly artistId: bigint; readonly sortOrder: number | null }[];
};

/** Catalog administration deliberately includes historical memberships. */
export function sortAdminMembers<T>(
  rows: readonly T[],
  key: (row: T) => AdminMember,
  artists: readonly ArtistOrderKey[],
  context: MemberDisplayContext = { kind: "mixed" },
): T[] {
  const groups = new Set(artists.filter((artist) => artist.type === "group").map((artist) => String(artist.id)));
  return createOfficialOrdering(artists).sortMembers(rows, (row) => {
    const member = key(row);
    return {
      ...member,
      membershipOrders: member.artistLinks,
      groupArtistIds: member.artistLinks.filter((link) => groups.has(String(link.artistId))).map((link) => link.artistId),
    };
  }, context);
}
