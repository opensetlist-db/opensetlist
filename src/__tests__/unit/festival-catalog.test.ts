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
      { rootId: "1", performerCount: 3 },
      { rootId: "10", performerCount: 1 },
      { rootId: "20", performerCount: 1 },
    ]);
  });

  it("counts guests and ignores deleted links", () => {
    const roster = [
      member("guest", [artist(10, null)], true),
      member("ghost", [artist(1, null, true)]),
    ];
    expect(resolveFestivalGroups(roster, H)).toEqual([
      { rootId: "10", performerCount: 1 },
    ]);
  });

  it("empty roster → no groups", () => {
    expect(resolveFestivalGroups([], H)).toEqual([]);
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
