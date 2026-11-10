import { createResilientOfficialOrdering, type ArtistOrderId, type ArtistOrderKey, type MemberDisplayContext } from "@/lib/officialOrder";

export interface EventDisplayOrder {
  artists: ArtistOrderKey[];
  guestIds: string[];
}

type DisplayArtist = { id: ArtistOrderId; orderId?: string; type: string };
type Membership = { artistId: ArtistOrderId; sortOrder?: number | null; orderArtistId?: string };
type DisplayMember = { id: string; sortOrder?: number | null; createdAt?: Date | string; artistLinks: readonly Membership[] };
export const displayArtistId = (a: DisplayArtist) => a.orderId ?? a.id;
const linkId = (link: Membership) => link.orderArtistId ?? link.artistId;

export function createEventDisplayOrdering(data: EventDisplayOrder) {
  const ordering = createResilientOfficialOrdering(data.artists);
  const artists = new Map(data.artists.map((artist) => [String(artist.id), artist]));
  const guests = new Set(data.guestIds);

  function groupOf(id: string) {
    const seen = new Set<string>();
    let current: string | null = id;
    while (current !== null && !seen.has(current)) {
      seen.add(current);
      const row = artists.get(current);
      if (!row) return undefined;
      if (row.type === "group") return row.id;
      current = row.parentArtistId === null ? null : String(row.parentArtistId);
    }
  }

  function sortMembers<T>(rows: readonly T[], member: (row: T) => DisplayMember, context: MemberDisplayContext, preferredGroups?: (id: string) => readonly ArtistOrderId[]) {
    return ordering.sortMembers(rows, (row) => {
      const person = member(row);
      const membershipOrders = person.artistLinks.map((link) => ({ artistId: linkId(link), sortOrder: link.sortOrder ?? null }));
      const groupArtistIds = membershipOrders.flatMap(({ artistId }) => {
        const group = groupOf(String(artistId));
        return group === undefined ? [] : [group];
      });
      const preferred = preferredGroups?.(person.id).filter((id) => groupArtistIds.some((group) => String(group) === String(id)));
      return {
        id: person.id, sortOrder: person.sortOrder ?? null,
        createdAt: person.createdAt ?? "1970-01-01T00:00:00Z",
        membershipOrders, groupArtistIds: preferred?.length ? preferred : groupArtistIds, isGuest: guests.has(person.id),
      };
    }, context);
  }

  function sortItem<A extends { artist: DisplayArtist }, P extends { stageIdentity: DisplayMember }, T extends { stageType: string; artists: A[]; performers: P[] }>(item: T) {
    const units = item.stageType === "full_group" ? [] : item.artists.map((row) => row.artist).filter((artist) =>
      artists.get(String(displayArtistId(artist)))?.type === "unit");
    const groups = item.artists.map(({ artist }) => displayArtistId(artist)).filter((id) => artists.get(String(id))?.type === "group");
    const performers = sortMembers(item.performers, (row) => row.stageIdentity, {
      kind: "credits",
      eligibleUnitCredits: units.map((unit) => ({
        artistId: displayArtistId(unit),
        stageIdentityIds: item.performers.filter(({ stageIdentity }) =>
          stageIdentity.artistLinks.some((link) => String(linkId(link)) === String(displayArtistId(unit))),
        ).map(({ stageIdentity }) => stageIdentity.id),
      })),
    }, () => groups);
    const orderedArtists = ordering.sortArtists(item.artists, ({ artist }) => ({ artistId: displayArtistId(artist) }));
    return { ...item, performers, artists: orderedArtists };
  }

  return { sortArtists: ordering.sortArtists, sortMembers, sortItem, isGuest: (id: string) => guests.has(id) };
}
export type EventDisplayOrdering = ReturnType<typeof createEventDisplayOrdering>;
