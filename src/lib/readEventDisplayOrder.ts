import { Prisma } from "@/generated/prisma/client";
import { createEventDisplayOrdering, type EventDisplayMember, type EventDisplayOrder } from "@/lib/eventDisplayOrder";

type Item = {
  stageType: string;
  artists: { artist: { id: bigint; type: string } }[];
  performers: { stageIdentity: { id: string } }[];
};

const exactId = (id: bigint) => id > BigInt(Number.MAX_SAFE_INTEGER) ? id.toString() : undefined;

type WireItem = Omit<Item, "performers"> & {
  performers: { stageIdentity: { id: string; artistLinks: { artistId: bigint }[] } }[];
};

export function withDisplayIds<T extends WireItem>(item: T) {
  return {
    ...item,
    artists: item.artists.map((row) => ({ ...row, artist: { ...row.artist, orderId: exactId(row.artist.id) } })),
    performers: item.performers.map((row) => ({
      ...row, stageIdentity: { ...row.stageIdentity,
        artistLinks: row.stageIdentity.artistLinks.map((link) => ({ ...link, orderArtistId: exactId(link.artistId) })),
      },
    })),
  };
}

type MemberRow = EventDisplayMember & { isGuest: boolean };

export async function readEventDisplayOrder(
  tx: Prisma.TransactionClient,
  eventId: bigint,
  items: Item[],
): Promise<EventDisplayOrder> {
  const ids = [...new Set(items.flatMap((item) => item.performers.map(({ stageIdentity }) => stageIdentity.id)))];
  const artistIds = [...new Set(items.flatMap((item) => item.artists.map(({ artist }) => artist.id)))];
  if (!ids.length && !artistIds.length) return { artists: [], guestIds: [] };
  const memberWhere = ids.length ? Prisma.sql`si.id IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`;
  const linkWhere = ids.length ? Prisma.sql`sa."stageIdentityId" IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`;
  const artistWhere = artistIds.length ? Prisma.sql`a.id IN (${Prisma.join(artistIds)})` : Prisma.sql`FALSE`;
  // One read captures the ranks and guest flags even for READ COMMITTED writers.
  const [metadata] = await tx.$queryRaw<{ artists: EventDisplayOrder["artists"]; members: MemberRow[] }[]>`
    WITH RECURSIVE links AS (
      SELECT sa."stageIdentityId", sa."artistId", sa."sortOrder" FROM "StageIdentityArtist" sa
      WHERE ${linkWhere}
    ), relevant AS (
      SELECT a.id, a."parentArtistId", a.type, a."sortOrder"
      FROM "Artist" a
      WHERE NOT a."isDeleted" AND (${artistWhere} OR a.id IN (SELECT "artistId" FROM links))
      UNION
      SELECT parent.id, parent."parentArtistId", parent.type, parent."sortOrder"
      FROM "Artist" parent JOIN relevant child ON child."parentArtistId" = parent.id
      WHERE NOT parent."isDeleted"
    )
    SELECT
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', a.id::text, 'parentArtistId', a."parentArtistId"::text,
          'type', a.type, 'sortOrder', a."sortOrder"
        ))
        FROM relevant a
      ), '[]'::jsonb) AS artists,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', si.id, 'sortOrder', si."sortOrder",
          'createdAt', to_char(si."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'isGuest', COALESCE(ep."isGuest", false),
          'artistLinks', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('artistId', sa."artistId"::text, 'sortOrder', sa."sortOrder"))
            FROM links sa WHERE sa."stageIdentityId" = si.id
          ), '[]'::jsonb)
        ))
        FROM "StageIdentity" si
        LEFT JOIN "EventPerformer" ep ON ep."stageIdentityId" = si.id AND ep."eventId" = ${eventId}
        WHERE ${memberWhere}
      ), '[]'::jsonb) AS members
  `;
  return {
    artists: metadata.artists,
    members: metadata.members.map(({ id, sortOrder, createdAt, artistLinks }) => ({ id, sortOrder, createdAt, artistLinks })),
    guestIds: metadata.members.filter(({ isGuest }) => isGuest).map(({ id }) => id),
  };
}

export async function orderSetlistWriteResponse<T extends Item>(tx: Prisma.TransactionClient, eventId: bigint, item: T) {
  if (!item.artists.length && !item.performers.length) return item;
  const ordering = createEventDisplayOrdering(await readEventDisplayOrder(tx, eventId, [item]));
  return ordering.sortItem(item);
}
