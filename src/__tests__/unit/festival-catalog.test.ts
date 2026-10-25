import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { buildArtistHierarchy } from "@/lib/artistHierarchy";
import {
  mergeFestivalCatalog,
  resolveFestivalGroups,
} from "@/lib/predict/festivalCatalog";
import { deriveFestivalFilters } from "@/lib/predict/unitFilters";
import type { AvailableSong } from "@/lib/types/predict";
import type { EventRosterEntry, RosterArtist } from "@/lib/types/setlist";

const H = buildArtistHierarchy([
  { id: BigInt(1), parentArtistId: null }, // 蓮ノ空
  { id: BigInt(2), parentArtistId: BigInt(1) }, // Cerise Bouquet
  { id: BigInt(10), parentArtistId: null }, // Liella!
  { id: BigInt(20), parentArtistId: null }, // AiScReam (cross-IP collab)
]);

function artist(
  id: number,
  parentArtistId: number | null,
  isDeleted = false,
): RosterArtist {
  return {
    id,
    slug: `a${id}`,
    type: parentArtistId === null ? "group" : "unit",
    color: null,
    parentArtistId,
    isMainUnit: false,
    isDeleted,
    originalName: `A${id}`,
    originalShortName: null,
    originalLanguage: "ja",
    translations: [],
  };
}

function member(
  id: string,
  links: RosterArtist[],
  isGuest = false,
): EventRosterEntry {
  return {
    isGuest,
    stageIdentity: {
      id,
      slug: id,
      originalName: id,
      originalShortName: null,
      originalLanguage: "ja",
      translations: [],
      artistLinks: links.map((a) => ({ artist: a })),
    },
  };
}

function song(songId: number, festivalGroupIds: number[] = []): AvailableSong {
  return {
    songId,
    originalTitle: `s${songId}`,
    originalLanguage: "ja",
    variantLabel: null,
    baseVersionId: null,
    translations: [],
    unit: {
      artistId: 1,
      slug: "a1",
      label: "A1",
      color: "#000",
      isSubUnit: false,
      isMainUnit: false,
    },
    isMultiArtist: false,
    creditedArtistIds: [1],
    festivalGroupIds,
    releaseDate: null,
  };
}

describe("resolveFestivalGroups", () => {
  it("walks unit-only links to the root and orders by performer count", () => {
    const roster = [
      member("liella-1", [artist(10, null)]),
      // Linked ONLY to the sub-unit — must still count for 蓮ノ空.
      member("hasu-1", [artist(2, 1)]),
      member("hasu-2", [artist(1, null), artist(2, 1)]),
      member("hasu-3", [artist(1, null), artist(20, null)]),
    ];
    expect(resolveFestivalGroups(roster, H)).toEqual([
      { rootId: "1", performerCount: 3, sortOrder: null },
      { rootId: "10", performerCount: 1, sortOrder: null },
      { rootId: "20", performerCount: 1, sortOrder: null },
    ]);
  });

  it("counts guests and ignores deleted links", () => {
    const roster = [
      member("guest", [artist(10, null)], true),
      member("ghost", [artist(1, null, true)]),
    ];
    expect(resolveFestivalGroups(roster, H)).toEqual([
      { rootId: "10", performerCount: 1, sortOrder: null },
    ]);
  });

  it("empty roster → no groups", () => {
    expect(resolveFestivalGroups([], H)).toEqual([]);
  });

  describe("explicit side-project appearances", () => {
    const hierarchy = buildArtistHierarchy([
      { id: BigInt(1), parentArtistId: null },
      { id: BigInt(2), parentArtistId: BigInt(1) },
      { id: BigInt(3), parentArtistId: BigInt(1) },
      { id: BigInt(10), parentArtistId: null },
      { id: BigInt(20), parentArtistId: null, isSideProject: true },
      { id: BigInt(30), parentArtistId: null, isSideProject: true },
    ]);
    const first = member("first", [artist(2, 1), artist(20, null)]);
    const second = member("second", [artist(10, null), artist(20, null)], true);
    const roots = (roster: EventRosterEntry[], assigned: (bigint | number | string)[] = []) =>
      resolveFestivalGroups(roster, hierarchy, assigned).map((g) => g.rootId);

    it("includes only an assigned collaboration even when all its members attend", () => {
      expect(roots([first, second], [20])).toContain("20");
      expect(roots([first, second])).toEqual(["1", "10"]);
    });

    it("an explicit appearance needs neither a second home group nor roster members", () => {
      expect(roots([first], ["20"])).toEqual(["1", "20"]);
      expect(resolveFestivalGroups([], hierarchy, [BigInt(20)])).toEqual([
        { rootId: "20", performerCount: 0, sortOrder: null },
      ]);
    });

    it("deduplicates assignments and ignores unknown or ordinary artists", () => {
      expect(roots([], [20, "20", BigInt(20), 999, 1, 2])).toEqual(["20"]);
      expect(roots([], [999, 1, 2])).toEqual([]);
    });

    it("dropping an assignment removes only that collaboration", () => {
      expect(roots([first, second], [20, 30])).toEqual(["20", "1", "10", "30"]);
      expect(roots([first, second], [30])).toEqual(["1", "10", "30"]);
    });
  });

  describe("Artist.sortOrder (operator's series order)", () => {
    // 1 has the most performers, 10 and 20 one each; 30 two.
    const roster = [
      member("a", [artist(1, null)]),
      member("b", [artist(2, 1)]),
      member("c", [artist(1, null)]),
      member("d", [artist(10, null)]),
      member("e", [artist(30, null)]),
      member("f", [artist(30, null)]),
      member("g", [artist(20, null)]),
    ];
    const ids = (h: ReturnType<typeof buildArtistHierarchy>) =>
      resolveFestivalGroups(roster, h).map((g) => g.rootId);
    const tree = (orders: Record<number, number | null>) =>
      buildArtistHierarchy(
        [1, 10, 20, 30]
          .map((id) => ({
            id: BigInt(id),
            parentArtistId: null as bigint | null,
            sortOrder: orders[id] ?? null,
          }))
          .concat([{ id: BigInt(2), parentArtistId: BigInt(1), sortOrder: null }]),
      );

    it("no sortOrder anywhere → today's order (count desc, first appearance)", () => {
      expect(ids(tree({}))).toEqual(["1", "30", "10", "20"]);
    });

    it("sortOrder wins over performer count", () => {
      // 20 has one performer but the lowest sortOrder → first.
      expect(ids(tree({ 1: 3, 10: 2, 20: 1, 30: 4 }))).toEqual([
        "20",
        "10",
        "1",
        "30",
      ]);
    });

    it("roots without a sortOrder come after every root that has one", () => {
      // Only 10 and 20 are ordered; 1 and 30 (more performers) follow
      // them, between themselves by today's rule.
      expect(ids(tree({ 10: 5, 20: 9 }))).toEqual(["10", "20", "1", "30"]);
    });

    it("equal sortOrder falls back to performer count, then first appearance", () => {
      expect(ids(tree({ 1: 1, 10: 1, 20: 1, 30: 1 }))).toEqual([
        "1",
        "30",
        "10",
        "20",
      ]);
    });

    it("a sub-unit's sortOrder is not the root's — only the root's counts", () => {
      const h = buildArtistHierarchy([
        { id: BigInt(1), parentArtistId: null },
        { id: BigInt(2), parentArtistId: BigInt(1), sortOrder: 0 },
        { id: BigInt(10), parentArtistId: null, sortOrder: 1 },
        { id: BigInt(20), parentArtistId: null },
        { id: BigInt(30), parentArtistId: null },
      ]);
      expect(ids(h)[0]).toBe("10");
      expect(resolveFestivalGroups(roster, h).find((g) => g.rootId === "1")?.sortOrder).toBeNull();
    });
  });
});

describe("mergeFestivalCatalog", () => {
  it("keeps a crossover song once with both group ids", () => {
    const merged = mergeFestivalCatalog(
      [1, 10],
      [
        [song(100), song(200)],
        [song(200), song(300)],
      ],
    );
    expect(merged.map((s) => s.songId)).toEqual([100, 200, 300]);
    expect(merged.find((s) => s.songId === 200)!.festivalGroupIds).toEqual([
      1, 10,
    ]);
    expect(merged.find((s) => s.songId === 300)!.festivalGroupIds).toEqual([
      10,
    ]);
  });

  it("does not mutate the per-group inputs", () => {
    const input = [song(100)];
    mergeFestivalCatalog([1, 10], [input, [song(100)]]);
    expect(input[0].festivalGroupIds).toEqual([]);
  });
});

describe("deriveFestivalFilters", () => {
  const groups = [
    { artistId: 1, slug: "hasunosora", label: "蓮ノ空", color: "#0277BD" },
    { artistId: 10, slug: "liella", label: "Liella!", color: null },
    { artistId: 20, slug: "aiscream", label: "AiScReam", color: "#f0f" },
  ];

  it("all + one chip per group with songs, in group order; no empty chips", () => {
    const filters = deriveFestivalFilters(
      groups,
      [song(1, [1]), song(2, [10]), song(3, [1, 10])],
      "All",
      "Others",
      "#brand",
    );
    expect(filters.map((f) => [f.key, f.kind, f.artistId, f.color])).toEqual([
      ["all", "all", null, null],
      ["festival:hasunosora", "festivalGroup", 1, "#0277BD"],
      ["festival:liella", "festivalGroup", 10, "#brand"],
    ]);
  });

  it("adds `others` only when some song has no group", () => {
    const filters = deriveFestivalFilters(
      groups,
      [song(1, [1]), song(2, [])],
      "All",
      "Others",
      "#brand",
    );
    expect(filters.at(-1)).toMatchObject({ key: "others", kind: "others" });
    expect(
      deriveFestivalFilters(groups, [song(1, [1])], "All", "Others", "#b").some(
        (f) => f.kind === "others",
      ),
    ).toBe(false);
  });
});
