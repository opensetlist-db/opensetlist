import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Artist, StageIdentity } from "@/generated/prisma/client";

vi.mock("@/lib/admin-auth", () => ({ verifyAdminAPI: vi.fn(async () => null) }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), unstable_cache: (_fn: unknown) => _fn }));

import { prisma } from "@/lib/prisma";
import { PUT } from "@/app/api/admin/artists/[id]/stage-identities/route";
import { POST as IMPORT } from "@/app/api/admin/import/route";
import { membershipOrderBy } from "@/lib/officialOrder";
import { warmEntryCache, WARM_PUBLIC_DATA_TAG } from "@/lib/dataCache";
import { revalidateTag } from "next/cache";

const PREFIX = "membershiporder-itest-";
let root: Artist, unitA: Artist, unitB: Artist;
const members: StageIdentity[] = [];

async function purge() {
  const eventWhere = { event: { slug: { startsWith: PREFIX } } };
  const itemWhere = { setlistItem: eventWhere };
  await prisma.setlistItemMember.deleteMany({ where: itemWhere });
  await prisma.setlistItemArtist.deleteMany({ where: itemWhere });
  await prisma.setlistItemSong.deleteMany({ where: itemWhere });
  await prisma.setlistItem.deleteMany({ where: eventWhere });
  await prisma.eventPerformer.deleteMany({ where: eventWhere });
  await prisma.event.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.stageIdentityArtist.deleteMany({ where: { stageIdentity: { slug: { startsWith: PREFIX } } } });
  await prisma.stageIdentityTranslation.deleteMany({ where: { stageIdentity: { slug: { startsWith: PREFIX } } } });
  await prisma.stageIdentity.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.realPerson.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.song.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.artist.deleteMany({ where: { slug: { startsWith: PREFIX }, parentArtistId: { not: null } } });
  await prisma.artist.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await purge();
  root = await prisma.artist.create({ data: { slug: `${PREFIX}root`, originalName: "fixture root", type: "group" } });
  unitA = await prisma.artist.create({ data: { slug: `${PREFIX}a`, originalName: "fixture A", type: "unit", parentArtistId: root.id } });
  unitB = await prisma.artist.create({ data: { slug: `${PREFIX}b`, originalName: "fixture B", type: "unit", parentArtistId: root.id } });
  for (const [index, name] of ["one", "two", "three"].entries()) {
    members.push(await prisma.stageIdentity.create({ data: {
      slug: `${PREFIX}${name}`, originalName: name, type: "character", sortOrder: index + 1,
      translations: { create: { locale: "ko", name: `fixture ${name}` } },
      artistLinks: { create: [root, unitA, unitB].map((a) => ({ artistId: a.id, startDate: new Date("2020-01-01T00:00:00Z"), endDate: new Date("2021-01-01T00:00:00Z"), note: "graduated fixture" })) },
    } }));
  }
  const voice = await prisma.realPerson.create({ data: { slug: `${PREFIX}voice`, originalName: "fixture voice" } });
  const song = await prisma.song.create({ data: { slug: `${PREFIX}song`, originalTitle: "fixture song" } });
  await prisma.event.create({ data: {
    slug: `${PREFIX}past`, type: "concert", originalName: "historical fixture", status: "completed", date: new Date("2020-01-01T00:00:00Z"), startTime: new Date("2020-01-01T09:00:00Z"),
    performers: { create: members.map((m, i) => ({ stageIdentityId: m.id, isGuest: i === 2 })) },
    setlistItems: { create: { position: 7, isEncore: true, artists: { create: { artistId: unitA.id } }, songs: { create: { songId: song.id, order: 2 } }, performers: { create: members.slice(0, 2).map((m) => ({ stageIdentityId: m.id, realPersonId: voice.id })) } } },
  } });
});

afterAll(async () => {
  await purge();
  const where = { slug: { startsWith: PREFIX } };
  expect(await prisma.artist.count({ where })).toBe(0);
  expect(await prisma.stageIdentity.count({ where })).toBe(0);
  expect(await prisma.event.count({ where })).toBe(0);
});

const json = (method: string, body: unknown) => new NextRequest("http://localhost/api/admin/import", {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const save = (body: unknown) => PUT(json("PUT", body), { params: Promise.resolve({ id: unitA.id.toString() }) });
const order = async (artistId: bigint) => (await prisma.stageIdentityArtist.findMany({ where: { artistId }, orderBy: membershipOrderBy(), include: { stageIdentity: true } })).map((r) => r.stageIdentity.id);
const history = () => prisma.event.findUniqueOrThrow({ where: { slug: `${PREFIX}past` }, include: { performers: { orderBy: { id: "asc" } }, setlistItems: { include: { performers: { orderBy: { id: "asc" } }, songs: true, artists: true } } } });
const identities = () => prisma.stageIdentity.findMany({ where: { slug: { startsWith: PREFIX } }, include: { translations: true }, orderBy: { id: "asc" } });
const relations = () => prisma.stageIdentityArtist.findMany({ where: { stageIdentity: { slug: { startsWith: PREFIX } } }, orderBy: { id: "asc" } });

describe("admin and CSV relationship order on isolated dev fixtures", () => {
  it("writes only one rank, invalidates actual warm entries, preserves history/defaults and clears", async () => {
    const before = { history: await history(), identities: await identities(), relations: await relations() };
    const cache = warmEntryCache();
    await cache.set(`${PREFIX}warm`, { old: true }, { tags: [WARM_PUBLIC_DATA_TAG] });
    const response = await save({ stageIdentityId: members[1].id, sortOrder: -1 });
    expect(response.status).toBe(200);
    expect((await response.json()).sortOrder).toBe(-1);
    expect(await order(unitA.id)).toEqual([members[1].id, members[0].id, members[2].id]);
    expect(await order(unitB.id)).toEqual(members.map((m) => m.id));
    expect(await order(root.id)).toEqual(members.map((m) => m.id));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await cache.get(`${PREFIX}warm`)).toBeNull();
    expect(revalidateTag).toHaveBeenCalledWith("public-data", { expire: 0 });
    expect((await save({ stageIdentityId: members[1].id })).status).toBe(200);
    expect((await relations()).find((r) => r.artistId === unitA.id && r.stageIdentityId === members[1].id)?.sortOrder).toBe(-1);
    for (const invalid of ["", "1", 1.2, 2147483648]) expect((await save({ stageIdentityId: members[1].id, sortOrder: invalid })).status).toBe(400);
    expect((await save({ stageIdentityId: "nonexistent", sortOrder: 1 })).status).toBe(404);
    expect((await save({ stageIdentityId: members[1].id, sortOrder: null })).status).toBe(200);
    expect(await order(unitA.id)).toEqual(members.map((m) => m.id));
    expect(await history()).toEqual(before.history);
    expect(await identities()).toEqual(before.identities);
    expect(await relations()).toEqual(before.relations);
  });

  it("imports/replays partial rows, preserves blanks and clears explicitly without creating relationships", async () => {
    const baseline = await relations();
    const csv = ["artistSlug,memberSlug,sortOrder",
      `${unitA.slug},${members[2].slug},0`,
      `${unitA.slug},${members[0].slug},2147483648`,
      `${unitA.slug},missing-member,1`,
      `missing-artist,${members[0].slug},1`,
      `${unitA.slug},${members[1].slug},-2147483648`,
    ].join("\n");
    const run = (value: string) => IMPORT(json("POST", { type: "membership-order", csv: value }));
    const first = await (await run(csv)).json();
    expect(first.count).toBe(2);
    expect(first.log.filter((line: string) => line.startsWith("ERROR:"))).toHaveLength(3);
    expect((await (await run(csv)).json()).count).toBe(0);
    await run(`artistSlug,memberSlug,sortOrder\n${unitA.slug},${members[2].slug},`);
    expect(await order(unitA.id)).toEqual([members[1].id, members[2].id, members[0].id]);
    // An artist/member may exist with no relationship; it is an error,
    // even for a blank/preserve row, never an upsert.
    const unlinked = await prisma.stageIdentity.create({ data: { slug: `${PREFIX}unlinked`, originalName: "unlinked", type: "character" } });
    const missing = await (await run(`artistSlug,memberSlug,sortOrder\n${unitA.slug},${unlinked.slug},1`)).json();
    expect(missing.log[0]).toMatch(/^ERROR:/);
    expect(await prisma.stageIdentityArtist.count({ where: { stageIdentityId: unlinked.id } })).toBe(0);
    for (const member of members.slice(1)) await run(`artistSlug,memberSlug,sortOrder\n${unitA.slug},${member.slug},__CLEAR__`);
    expect(await relations()).toEqual(baseline);
    expect(await order(unitA.id)).toEqual(members.map((m) => m.id));
  });
});
