import { Prisma } from "@/generated/prisma/client";
import { createEventDisplayOrdering, type EventDisplayOrder } from "@/lib/eventDisplayOrder";

type Item = {
  stageType: string;
  artists: { artist: { id: bigint; type: string } }[];
  performers: { stageIdentity: { id: string; artistLinks: { artistId: bigint }[] } }[];
};

export function withDisplayIds<T extends Item>(item: T) {
  return {
    ...item,
    artists: item.artists.map((row) => ({ ...row, artist: { ...row.artist, orderId: String(row.artist.id) } })),
    performers: item.performers.map((row) => ({
      ...row, stageIdentity: { ...row.stageIdentity,
        artistLinks: row.stageIdentity.artistLinks.map((link) => ({ ...link, orderArtistId: String(link.artistId) })),
      },
    })),
  };
}

export async function readEventDisplayOrder(
  tx: Prisma.TransactionClient,
  items: Item[],
  guestIds: string[],
): Promise<EventDisplayOrder> {
  if (!items.some((item) => item.artists.length || item.performers.length)) return { artists: [], guestIds };
  const rows = await tx.artist.findMany({
    where: { isDeleted: false },
    select: { id: true, parentArtistId: true, type: true, sortOrder: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const relevant = new Set<bigint>();
  function include(id: bigint) {
    let current: bigint | null = id;
    while (current !== null && !relevant.has(current)) {
      const row = byId.get(current);
      if (!row) break;
      relevant.add(current);
      current = row.parentArtistId;
    }
  }
  for (const item of items) {
    for (const { artist } of item.artists) include(artist.id);
    for (const { stageIdentity } of item.performers) {
      for (const { artistId } of stageIdentity.artistLinks) include(artistId);
    }
  }
  return {
    guestIds,
    artists: [...relevant].map((id) => {
      const row = byId.get(id)!;
      return { ...row, id: String(id), parentArtistId: row.parentArtistId?.toString() ?? null };
    }),
  };
}

type WriterItem = {
  stageType: string;
  artists: Item["artists"];
  performers: { stageIdentity: { id: string } }[];
};

type WriterMember = {
  id: string;
  sortOrder: number | null;
  createdAt: string;
  isGuest: boolean;
  artistLinks: { artistId: string; sortOrder: number | null }[];
};

export async function orderSetlistWriteResponse<T extends WriterItem>(tx: Prisma.TransactionClient, eventId: bigint, item: T) {
  if (!item.artists.length && !item.performers.length) return item;
  const ids = item.performers.map(({ stageIdentity }) => stageIdentity.id);
  const memberWhere = ids.length ? Prisma.sql`si.id IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`;
  // Writers use READ COMMITTED. Read the ranks and guest flags together
  // so a concurrent catalog edit cannot split the ordering snapshot.
  const [metadata] = await tx.$queryRaw<{ artists: EventDisplayOrder["artists"]; members: WriterMember[] }[]>`
    SELECT
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', a.id::text, 'parentArtistId', a."parentArtistId"::text,
          'type', a.type, 'sortOrder', a."sortOrder"
        ))
        FROM "Artist" a WHERE NOT a."isDeleted"
      ), '[]'::jsonb) AS artists,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', si.id, 'sortOrder', si."sortOrder",
          'createdAt', to_char(si."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'isGuest', COALESCE(ep."isGuest", false),
          'artistLinks', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('artistId', sa."artistId"::text, 'sortOrder', sa."sortOrder"))
            FROM "StageIdentityArtist" sa WHERE sa."stageIdentityId" = si.id
          ), '[]'::jsonb)
        ))
        FROM "StageIdentity" si
        LEFT JOIN "EventPerformer" ep ON ep."stageIdentityId" = si.id AND ep."eventId" = ${eventId}
        WHERE ${memberWhere}
      ), '[]'::jsonb) AS members
  `;
  const members = new Map(metadata.members.map((member) => [member.id, member]));
  const ordering = createEventDisplayOrdering({
    artists: metadata.artists,
    guestIds: metadata.members.filter(({ isGuest }) => isGuest).map(({ id }) => id),
  });
  const ordered = ordering.sortItem({
    stageType: item.stageType,
    artists: item.artists,
    performers: item.performers.map((row) => ({
      row, stageIdentity: members.get(row.stageIdentity.id) ?? { ...row.stageIdentity, artistLinks: [] },
    })),
  });
  return { ...item, artists: ordered.artists, performers: ordered.performers.map(({ row }) => row) };
}
