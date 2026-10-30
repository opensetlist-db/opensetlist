import { describe, expect, it } from "vitest";
import {
  createOfficialOrdering, isOfficialRank, membershipOrderBy,
  type ArtistOrderKey, type MemberDisplayKey, type MemberDisplayContext,
} from "@/lib/officialOrder";
import { compareMemberOrder } from "@/lib/memberOrder";

const artists: readonly ArtistOrderKey[] = [
  { id: BigInt(10), parentArtistId: null, type: "group", sortOrder: 1 },
  { id: BigInt(2), parentArtistId: null, type: "group", sortOrder: 2 },
  { id: BigInt(30), parentArtistId: BigInt(10), type: "unit", sortOrder: 2 },
  { id: BigInt(40), parentArtistId: BigInt(10), type: "unit", sortOrder: 1 },
  { id: BigInt(41), parentArtistId: BigInt(40), type: "unit", sortOrder: null },
  { id: BigInt(50), parentArtistId: BigInt(10), type: "solo", sortOrder: 0 },
  { id: BigInt(60), parentArtistId: BigInt(2), type: "unit", sortOrder: -1 },
];
const timestamp = "2026-01-01T00:00:00.000Z";
function member(id: string, sortOrder: number | null, options: Partial<MemberDisplayKey> = {}): MemberDisplayKey {
  return { id, sortOrder, createdAt: timestamp, groupArtistIds: [BigInt(10)], membershipOrders: [], ...options };
}
const members = [
  member("a", 1, { membershipOrders: [{ artistId: BigInt(30), sortOrder: 2 }, { artistId: BigInt(40), sortOrder: 1 }] }),
  member("b", 2, { membershipOrders: [{ artistId: BigInt(30), sortOrder: 1 }, { artistId: BigInt(40), sortOrder: 2 }] }),
  member("c", null),
  member("d", null),
];
function shuffled<T>(rows: readonly T[], seed: number): T[] {
  const result = [...rows];
  for (let i = result.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);

describe("official display ordering", () => {
  it("orders ancestor paths, local child/solo ranks and unknown artists independently of shuffles", () => {
    const displayed = [BigInt(2), BigInt(60), BigInt(30), BigInt(10), BigInt(41), BigInt(40), BigInt(50), BigInt(100), BigInt(99)];
    for (let seed = 1; seed <= 80; seed++) {
      const order = createOfficialOrdering(shuffled(artists, seed));
      expect(order.sortArtists(shuffled(displayed, seed), (artistId) => ({ artistId })))
        .toEqual([BigInt(10), BigInt(50), BigInt(40), BigInt(41), BigInt(30), BigInt(2), BigInt(60), BigInt(99), BigInt(100)]);
    }
  });

  it("uses numeric BigInt IDs for tied and null ranks without precision loss", () => {
    const order = createOfficialOrdering([
      { id: "10", parentArtistId: null, type: "group", sortOrder: 0 },
      { id: "2", parentArtistId: null, type: "group", sortOrder: 0 },
    ]);
    const input = ["9007199254740993", "10", "9007199254740992", "2"];
    expect(order.sortArtists(input, (artistId) => ({ artistId })))
      .toEqual(["2", "10", "9007199254740992", "9007199254740993"]);
    expect(() => order.compareArtists(Number.MAX_SAFE_INTEGER + 1, BigInt(2))).toThrow(/safe integers/);
  });

  it("keeps a child with a missing/deleted ancestor and rejects cycles and duplicate metadata", () => {
    const orphan = { id: BigInt(7), parentArtistId: BigInt(999), type: "unit", sortOrder: 0 } as const;
    const order = createOfficialOrdering([orphan]);
    expect(order.sortArtists([BigInt(10), BigInt(7)], (artistId) => ({ artistId }))).toEqual([BigInt(7), BigInt(10)]);
    expect(createOfficialOrdering([]).sortArtists([], (artistId: bigint) => ({ artistId }))).toEqual([]);
    expect(() => createOfficialOrdering([{ ...orphan, parentArtistId: BigInt(7) }])).toThrow(/Cyclic/);
    expect(() => createOfficialOrdering([orphan, orphan])).toThrow(/Duplicate/);
  });

  it("keeps default order and two different relation orders independent across shuffles/locales", () => {
    for (const locale of ["ko", "ja", "en"]) {
      for (let seed = 1; seed <= 60; seed++) {
        const order = createOfficialOrdering(shuffled(artists, seed));
        const rows = shuffled(members, seed).map((m) => ({ ...m, name: `${locale}-${seed}-${m.id}` }));
        expect(ids(order.sortMembers(rows, (m) => m, { kind: "artist", artistId: BigInt(30) }))).toEqual(["b", "a", "c", "d"]);
        expect(ids(order.sortMembers(rows, (m) => m, { kind: "artist", artistId: BigInt(40) }))).toEqual(["a", "b", "c", "d"]);
        expect(ids(order.sortMembers(rows, (m) => m, { kind: "artist", artistId: BigInt(10) }))).toEqual(["a", "b", "c", "d"]);
        expect(ids(order.sortMembers(rows, (m) => m, { kind: "mixed" }))).toEqual(["a", "b", "c", "d"]);
      }
    }
  });

  it("puts explicit relation ranks before defaults, breaking rank ties with the full default key", () => {
    const rows = [
      member("z", -100),
      member("b", null, { membershipOrders: [{ artistId: BigInt(30), sortOrder: 0 }] }),
      member("a", null, { membershipOrders: [{ artistId: BigInt(30), sortOrder: 0 }] }),
      member("c", null, { createdAt: new Date("2025-01-01T00:00:00Z"), membershipOrders: [{ artistId: BigInt(30), sortOrder: 0 }] }),
      member("d", 2, { membershipOrders: [{ artistId: BigInt(30), sortOrder: 0 }] }),
    ];
    const order = createOfficialOrdering(artists);
    expect(ids(order.sortMembers(rows, (m) => m, { kind: "artist", artistId: BigInt(30) }))).toEqual(["d", "c", "a", "b", "z"]);
    const defaults = order.sortMembers(rows, (m) => m, { kind: "artist", artistId: BigInt(10) });
    expect(ids(defaults)).toEqual(["z", "d", "c", "a", "b"]);
    expect(ids([...rows].sort(compareMemberOrder))).toEqual(ids(defaults));
  });

  it("uses only resolved groups, first official candidate as a key, unknown groups last", () => {
    const rows = [
      member("unknown", -10, { groupArtistIds: [BigInt(999)] }),
      member("second", 1, { groupArtistIds: [BigInt(2)] }),
      member("multi", 2, { groupArtistIds: [BigInt(2), BigInt(10)] }),
      member("first", 1),
      member("none", null, { groupArtistIds: [], membershipOrders: [{ artistId: BigInt(40), sortOrder: -10 }] }),
    ];
    const order = createOfficialOrdering(artists);
    expect(ids(order.sortMembers(rows, (m) => m, { kind: "mixed" }))).toEqual(["first", "multi", "second", "unknown", "none"]);
    expect(rows[2].groupArtistIds).toEqual([BigInt(2), BigInt(10)]);
  });

  it("places ordinary performers before guests, including artists with only guests", () => {
    const rows = [member("guest", 0, { isGuest: true }), member("host", null, { groupArtistIds: [BigInt(2)] })];
    const order = createOfficialOrdering(artists);
    expect(ids(order.sortMembers(rows, (m) => m, { kind: "mixed" }))).toEqual(["host", "guest"]);
    const groups = [{ artistId: BigInt(10), isGuest: true }, { artistId: BigInt(2), isGuest: false }];
    expect(order.sortArtists(groups, (g) => g).map((g) => g.artistId)).toEqual([BigInt(2), BigInt(10)]);
    expect(ids(order.sortMembers(rows, (m) => m, { kind: "artist", artistId: BigInt(30) }))).toEqual(["host", "guest"]);
  });

  it("keeps resolved group contexts distinct from solo/unit page contexts", () => {
    const rows = [member("solo", 0, { groupArtistIds: [BigInt(50)], membershipOrders: [{ artistId: BigInt(50), sortOrder: -1 }] }), member("group", 1)];
    const order = createOfficialOrdering(artists);
    expect(ids(order.sortMembers(rows, (m) => m, { kind: "mixed" }))).toEqual(["group", "solo"]);
    expect(ids(order.sortMembers(rows, (m) => m, { kind: "artist", artistId: BigInt(50) }))).toEqual(["solo", "group"]);
  });

  it("requires explicit timestamp zones and compares different offset forms as the same instant", () => {
    const order = createOfficialOrdering(artists);
    const rows = [member("c", null, { createdAt: new Date(timestamp) }), member("b", null, { createdAt: "2026-01-01T09:00:00+09:00" }), member("a", null)];
    expect(ids(order.sortMembers(rows, (m) => m, { kind: "mixed" }))).toEqual(["a", "b", "c"]);
    for (const createdAt of ["1", "2026-01-01", "2026-01-01 00:00:00", "2026-01-01T00:00:00", "2026-01-01T00:00:00+99:00"]) {
      expect(() => order.sortMembers([member("a", null, { createdAt })], (m) => m, { kind: "mixed" })).toThrow(/timestamp/);
    }
  });

  it("sorts eligible multi-unit credits and overlapping members without adding performers", () => {
    const order = createOfficialOrdering(artists);
    const rows = [...members, member("e", 0, { groupArtistIds: [BigInt(2)] })];
    const credits: MemberDisplayContext = { kind: "credits", eligibleUnitCredits: [
      { artistId: BigInt(30), stageIdentityIds: ["b", "a", "not-performing"] },
      { artistId: BigInt(40), stageIdentityIds: ["c", "a"] },
    ] };
    expect(ids(order.sortMembers(rows, (m) => m, credits))).toEqual(["a", "c", "b", "d", "e"]);
    expect(ids(order.sortMembers(rows, (m) => m, {
      kind: "credits", eligibleUnitCredits: [...credits.eligibleUnitCredits].reverse(),
    }))).toEqual(["a", "c", "b", "d", "e"]);
    expect(ids(order.sortMembers([members[0], members[1]], (m) => m, {
      kind: "credits", eligibleUnitCredits: [{ artistId: BigInt(30), stageIdentityIds: ["a", "b", "not-performing"] }],
    }))).toEqual(["b", "a"]);
  });

  it("prefers the most specific explicit unit per member; rejects solo credits rather than normalizing eligibility", () => {
    const order = createOfficialOrdering(artists);
    const rows = [member("a", 1), member("b", 2), member("c", 3)];
    expect(ids(order.sortMembers(rows, (m) => m, { kind: "credits", eligibleUnitCredits: [
      { artistId: BigInt(40), stageIdentityIds: ["a", "b"] },
      { artistId: BigInt(41), stageIdentityIds: ["a"] },
    ] }))).toEqual(["b", "a", "c"]);
    expect(() => order.sortMembers(rows, (m) => m, { kind: "credits", eligibleUnitCredits: [
      { artistId: BigInt(50), stageIdentityIds: ["a"] },
    ] })).toThrow(/unit artist/);
    for (const kind of ["solo", "special", "full_group", "no-credit"]) {
      const actual = rows.map((m) => ({ ...m, stageType: kind }));
      expect(ids(order.sortMembers(actual, (m) => m, { kind: "credits", eligibleUnitCredits: [] }))).toEqual(["a", "b", "c"]);
    }
  });

  it("preserves frozen inputs, nested metadata, historical facts and row identity", () => {
    const input = members.map((m, i) => Object.freeze({
      ...m, groupArtistIds: Object.freeze([...m.groupArtistIds]),
      membershipOrders: Object.freeze(m.membershipOrders.map((r) => Object.freeze({ ...r }))),
      realPersonId: `voice-${i}`, position: i + 1, medleyOrder: 4 - i,
    }));
    const before = structuredClone(input);
    const frozenArtists = Object.freeze(artists.map((a) => Object.freeze({ ...a })));
    const order = createOfficialOrdering(frozenArtists);
    const sorted = order.sortMembers(Object.freeze(input), (m) => m, { kind: "artist", artistId: BigInt(30) });
    expect(ids(sorted)).toEqual(["b", "a", "c", "d"]);
    expect(sorted).not.toBe(input);
    expect(sorted[0]).toBe(input[1]);
    expect(input).toEqual(before);
    const mutable = artists.map((a) => ({ ...a }));
    const snapshot = createOfficialOrdering(mutable);
    mutable[0].sortOrder = 100;
    expect(snapshot.compareArtists(BigInt(10), BigInt(2))).toBeLessThan(0);
    expect(createOfficialOrdering(mutable).compareArtists(BigInt(10), BigInt(2))).toBeGreaterThan(0);
  });

  it("validates signed Int ranks and timestamps; Prisma order arrays are independent", () => {
    for (const value of [null, 0, -2_147_483_648, 2_147_483_647]) expect(isOfficialRank(value)).toBe(true);
    for (const value of [undefined, "1", NaN, Infinity, 0.1, -2_147_483_649, 2_147_483_648]) expect(isOfficialRank(value)).toBe(false);
    expect(() => createOfficialOrdering([{ ...artists[0], sortOrder: NaN }])).toThrow(/rank/);
    expect(() => createOfficialOrdering(artists).sortMembers([member("a", 0, { createdAt: "invalid" })], (m) => m, { kind: "mixed" })).toThrow(/timestamp/);
    const first = membershipOrderBy();
    expect(first).toEqual([{ sortOrder: { sort: "asc", nulls: "last" } },
      { stageIdentity: { sortOrder: { sort: "asc", nulls: "last" } } }, { stageIdentity: { createdAt: "asc" } }, { stageIdentityId: "asc" }]);
    first.splice(0);
    expect(membershipOrderBy()).toHaveLength(4);
  });
});
