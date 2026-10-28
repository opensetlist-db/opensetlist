import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StageIdentity } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { byStageIdentityOrderBy } from "@/lib/memberOrder";
import { createOfficialOrdering, membershipOrderBy } from "@/lib/officialOrder";

// All writes live in a transaction deliberately rolled back, even on a
// failed assertion/disconnection. A fixed prefix also permits recovery of
// any abandoned older fixture without touching real catalog records.
const PREFIX = "officialorder-itest-";
async function purge() {
  const events = { event: { slug: { startsWith: PREFIX } } };
  const items = { setlistItem: events };
  await prisma.setlistItemMember.deleteMany({ where: items });
  await prisma.setlistItemArtist.deleteMany({ where: items });
  await prisma.setlistItemSong.deleteMany({ where: items });
  await prisma.setlistItem.deleteMany({ where: events });
  await prisma.eventPerformer.deleteMany({ where: events });
  await prisma.event.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.stageIdentityArtist.deleteMany({ where: { stageIdentity: { slug: { startsWith: PREFIX } } } });
  await prisma.stageIdentity.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.realPerson.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.song.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.artist.deleteMany({ where: { slug: { startsWith: PREFIX }, parentArtistId: { not: null } } });
  await prisma.artist.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}
beforeAll(purge);
afterAll(purge);

describe("official ordering on isolated dev fixtures", () => {
  it("round-trips nullable relation ranks, isolates contexts and preserves legacy order/history", async () => {
    const rollback = new Error("rollback ordering fixture");
    await expect(prisma.$transaction(async (tx) => {
      const root = await tx.artist.create({ data: { slug: `${PREFIX}root`, originalName: "fixture root", type: "group", sortOrder: 1 } });
      const unitA = await tx.artist.create({ data: { slug: `${PREFIX}unit-a`, originalName: "fixture A", type: "unit", parentArtistId: root.id, sortOrder: 2 } });
      const unitB = await tx.artist.create({ data: { slug: `${PREFIX}unit-b`, originalName: "fixture B", type: "unit", parentArtistId: root.id, sortOrder: 1 } });
      const event = await tx.event.create({ data: { slug: `${PREFIX}past`, originalName: "past fixture", type: "concert", status: "completed", date: new Date("2020-01-01T00:00:00Z"), startTime: new Date("2020-01-01T09:00:00Z") } });
      const voice = await tx.realPerson.create({ data: { slug: `${PREFIX}voice`, originalName: "explicit voice" } });
      const song = await tx.song.create({ data: { slug: `${PREFIX}song`, originalTitle: "actual song" } });
      const identities: StageIdentity[] = [];
      for (const [index, name] of ["a", "b", "c"].entries()) {
        identities.push(await tx.stageIdentity.create({ data: {
          slug: `${PREFIX}${name}`, originalName: name, type: "character", sortOrder: index + 1,
          createdAt: new Date("2020-01-01T00:00:00Z"),
          artistLinks: { create: [root, unitA, unitB].map((artist) => ({ artistId: artist.id, startDate: new Date("2019-01-01T00:00:00Z"), endDate: new Date("2021-01-01T00:00:00Z"), note: "preserve membership" })) },
          eventPerformers: { create: { eventId: event.id, isGuest: name === "c" } },
        } }));
      }
      const item = await tx.setlistItem.create({ data: {
        eventId: event.id, position: 7, isEncore: true, stageType: "unit",
        artists: { create: { artistId: unitA.id } },
        songs: { create: { songId: song.id, order: 2 } },
        // Exactly two actual performers; a full unit membership must
        // never introduce the third identity into the historical item.
        performers: { create: identities.slice(0, 2).map((m) => ({ stageIdentityId: m.id, realPersonId: voice.id })) },
      } });
      const history = () => tx.event.findUniqueOrThrow({ where: { id: event.id }, include: {
        performers: { orderBy: { stageIdentityId: "asc" } },
        setlistItems: { include: { performers: { orderBy: { stageIdentityId: "asc" } }, artists: true, songs: true } },
      } });
      const before = await history();
      expect(before.performers).toHaveLength(3);
      expect(before.setlistItems[0].performers).toHaveLength(2);
      expect(before.setlistItems[0].performers.every((p) => p.realPersonId === voice.id)).toBe(true);
      const linksBefore = await tx.stageIdentityArtist.findMany({ where: { artistId: { in: [root.id, unitA.id, unitB.id] } }, orderBy: { id: "asc" } });
      expect(linksBefore.every((r) => r.sortOrder === null)).toBe(true);
      const relation = { stageIdentityId: identities[1].id, artistId: unitA.id };
      await tx.stageIdentityArtist.update({ where: { stageIdentityId_artistId: relation }, data: { sortOrder: 0 } });
      await tx.stageIdentityArtist.update({ where: { stageIdentityId_artistId: { ...relation, artistId: unitB.id } }, data: { sortOrder: 20 } });
      const links = await tx.stageIdentityArtist.findMany({ where: { artistId: { in: [root.id, unitA.id, unitB.id] } }, orderBy: { id: "asc" } });
      expect(links.map((r) => ({ ...r, sortOrder: null })))
        .toEqual(linksBefore);
      expect(links.find((r) => r.stageIdentityId === identities[1].id && r.artistId === unitA.id)?.sortOrder).toBe(0);
      expect(links.find((r) => r.stageIdentityId === identities[1].id && r.artistId === unitB.id)?.sortOrder).toBe(20);
      const rows = identities.map((m) => ({ ...m, groupArtistIds: [root.id], membershipOrders: links.filter((r) => r.stageIdentityId === m.id) }));
      const order = createOfficialOrdering([root, unitA, unitB]);
      const names = (artistId: bigint) => order.sortMembers(rows, (m) => m, { kind: "artist", artistId }).map((m) => m.originalName);
      expect(names(unitA.id)).toEqual(["b", "a", "c"]);
      expect(names(unitB.id)).toEqual(["b", "a", "c"]);
      // An independent rank in B changes B, with A/default left alone.
      await tx.stageIdentityArtist.update({ where: { stageIdentityId_artistId: { stageIdentityId: identities[0].id, artistId: unitB.id } }, data: { sortOrder: -1 } });
      const queryNames = async (artistId: bigint, contextual: boolean) => (await tx.stageIdentityArtist.findMany({
        where: { artistId }, orderBy: contextual ? membershipOrderBy() : byStageIdentityOrderBy(), include: { stageIdentity: true },
      })).map((r) => r.stageIdentity.originalName);
      const assertPureMatchesSql = async () => {
        const freshLinks = await tx.stageIdentityArtist.findMany({ where: { artistId: { in: [root.id, unitA.id, unitB.id] } } });
        const freshRows = identities.map((m) => ({ ...m, groupArtistIds: [root.id], membershipOrders: freshLinks.filter((r) => r.stageIdentityId === m.id) }));
        for (const artist of [root, unitA, unitB]) {
          expect(order.sortMembers(freshRows, (m) => m, { kind: "artist", artistId: artist.id }).map((m) => m.originalName))
            .toEqual(await queryNames(artist.id, true));
        }
      };
      await assertPureMatchesSql();
      expect(await queryNames(unitB.id, true)).toEqual(["a", "b", "c"]);
      expect(await queryNames(unitA.id, true)).toEqual(["b", "a", "c"]);
      expect(await queryNames(root.id, true)).toEqual(["a", "b", "c"]);
      expect(await queryNames(unitA.id, false)).toEqual(["a", "b", "c"]);
      expect(await tx.stageIdentity.findMany({ where: { id: { in: identities.map((m) => m.id) } }, orderBy: { id: "asc" } }))
        .toEqual([...identities].sort((a, b) => a.id < b.id ? -1 : 1));
      expect(await history()).toEqual(before);
      expect(before.setlistItems[0].id).toBe(item.id);
      await tx.stageIdentityArtist.update({ where: { stageIdentityId_artistId: relation }, data: { sortOrder: null } });
      expect(await queryNames(unitA.id, true)).toEqual(["a", "b", "c"]);
      await assertPureMatchesSql();
      // Omission is a normal Prisma partial update: it must preserve rank.
      await tx.stageIdentityArtist.update({ where: { stageIdentityId_artistId: { ...relation, artistId: unitB.id } }, data: { note: "preserve membership" } });
      expect((await tx.stageIdentityArtist.findUniqueOrThrow({ where: { stageIdentityId_artistId: { ...relation, artistId: unitB.id } } })).sortOrder).toBe(20);
      throw rollback;
    }, { timeout: 60_000 })).rejects.toBe(rollback);
    expect(await prisma.artist.count({ where: { slug: { startsWith: PREFIX } } })).toBe(0);
    expect(await prisma.stageIdentity.count({ where: { slug: { startsWith: PREFIX } } })).toBe(0);
    expect(await prisma.event.count({ where: { slug: { startsWith: PREFIX } } })).toBe(0);
  });
});
