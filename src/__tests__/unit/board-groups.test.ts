import { describe, it, expect } from "vitest";

import { buildArtistHierarchy } from "@/lib/artistHierarchyTree";
import {
  boardGroupRootIds,
  resolveBoardGroups,
  type BoardGroupArtistRow,
} from "@/lib/board/boardGroups";
import { resolveFestivalGroups } from "@/lib/predict/festivalCatalog";
import type { EventRosterEntry, RosterArtist } from "@/lib/types/setlist";

const H = buildArtistHierarchy([
  { id: BigInt(1), parentArtistId: null }, // 蓮ノ空
  { id: BigInt(2), parentArtistId: BigInt(1) }, // Cerise Bouquet
  { id: BigInt(3), parentArtistId: BigInt(1) }, // DOLLCHESTRA
  { id: BigInt(10), parentArtistId: null }, // Liella!
  { id: BigInt(11), parentArtistId: BigInt(10) }, // CatChu!
  { id: BigInt(20), parentArtistId: null }, // AiScReam (cross-IP collab)
  { id: BigInt(30), parentArtistId: null }, // 虹ヶ咲
]);

function rosterArtist(id: number, parentArtistId: number | null, isDeleted = false): RosterArtist {
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

function member(id: string, links: RosterArtist[], isGuest = false): EventRosterEntry {
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

function row(
  id: number | bigint,
  overrides: Partial<BoardGroupArtistRow> = {},
): BoardGroupArtistRow {
  return {
    id,
    slug: `group-${id}`,
    color: `#00000${id}`.slice(0, 7),
    originalName: `原名${id}`,
    originalShortName: `原${id}`,
    originalLanguage: "ja",
    translations: [
      { locale: "ko", name: `그룹${id}`, shortName: `그${id}` },
      { locale: "ja", name: `グループ${id}`, shortName: null },
    ],
    ...overrides,
  };
}

// A Fes-shaped roster: 蓮ノ空 members linked only via sub-units,
// a Liella! block, a cross-IP collab member reaching two roots, a
// guest from a third IP, and a deleted link that must not count.
const FES_ROSTER: EventRosterEntry[] = [
  member("kaho", [rosterArtist(2, 1)]),
  member("sayaka", [rosterArtist(3, 1)]),
  member("kozue", [rosterArtist(2, 1)]),
  member("kanon", [rosterArtist(10, null)]),
  member("kinako", [rosterArtist(11, 10), rosterArtist(20, null)]),
  member("ayumu", [rosterArtist(30, null)], true),
  member("ghost", [rosterArtist(99, null, true)]),
];

const FES_ROWS = [row(1), row(10), row(20), row(30)];

describe("boardGroupRootIds", () => {
  it("festival: same ids, same order as resolveFestivalGroups (characterization)", () => {
    const expected = resolveFestivalGroups(FES_ROSTER, H).map((g) => g.rootId);
    expect(expected).toEqual(["1", "10", "20", "30"]);
    expect(
      boardGroupRootIds({ roster: FES_ROSTER, hierarchy: H, primaryArtistId: null }),
    ).toEqual(expected);
  });

  it("single-artist: exactly the primary's root, roster ignored", () => {
    expect(
      boardGroupRootIds({ roster: FES_ROSTER, hierarchy: H, primaryArtistId: BigInt(1) }),
    ).toEqual(["1"]);
    // A sub-unit series still yields its root group.
    expect(
      boardGroupRootIds({ roster: [], hierarchy: H, primaryArtistId: 2 }),
    ).toEqual(["1"]);
  });

  it("no primary and empty roster → no groups", () => {
    expect(boardGroupRootIds({ roster: [], hierarchy: H, primaryArtistId: null })).toEqual([]);
  });
});

describe("resolveBoardGroups", () => {
  it("festival: groups in festival order with localized short name and colour", () => {
    const groups = resolveBoardGroups({
      roster: FES_ROSTER,
      hierarchy: H,
      primaryArtist: null,
      // Arrival order of the display rows must not affect the output.
      groupArtists: [...FES_ROWS].reverse(),
      locale: "ko",
    });
    expect(groups).toEqual([
      { artistId: 1, slug: "group-1", label: "그1", color: "#000001" },
      { artistId: 10, slug: "group-10", label: "그10", color: "#000001" },
      { artistId: 20, slug: "group-20", label: "그20", color: "#000002" },
      { artistId: 30, slug: "group-30", label: "그30", color: "#000003" },
    ]);
  });

  it("festival: short-name fallback follows displayNameWithFallback", () => {
    const groups = resolveBoardGroups({
      roster: [member("kanon", [rosterArtist(10, null)])],
      hierarchy: H,
      primaryArtist: null,
      groupArtists: [row(10)],
      locale: "ja",
    });
    // ja translation has no shortName → its full name wins over the original short.
    expect(groups.map((g) => g.label)).toEqual(["グループ10"]);
  });

  it("festival: a root whose display row is missing drops out, order kept", () => {
    const groups = resolveBoardGroups({
      roster: FES_ROSTER,
      hierarchy: H,
      primaryArtist: null,
      groupArtists: [row(1), row(20), row(30)],
      locale: "ko",
    });
    expect(groups.map((g) => g.artistId)).toEqual([1, 20, 30]);
  });

  it("single-artist: exactly one group carrying the root's id, short name and colour", () => {
    const primary = row(BigInt(1), { color: "#fb8a9b" });
    const groups = resolveBoardGroups({
      roster: FES_ROSTER,
      hierarchy: H,
      primaryArtist: primary,
      groupArtists: [],
      locale: "ko",
    });
    expect(groups).toEqual([
      { artistId: 1, slug: "group-1", label: "그1", color: "#fb8a9b" },
    ]);
  });

  it("single-artist: a sub-unit series resolves to its root's display row", () => {
    const groups = resolveBoardGroups({
      roster: [],
      hierarchy: H,
      primaryArtist: row(2),
      groupArtists: [row(1)],
      locale: "ko",
    });
    expect(groups.map((g) => g.artistId)).toEqual([1]);
  });

  it("drops a root whose id is not JS-safe", () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(10);
    const h = buildArtistHierarchy([{ id: huge, parentArtistId: null }]);
    const groups = resolveBoardGroups({
      roster: [],
      hierarchy: h,
      primaryArtist: row(huge),
      groupArtists: [],
      locale: "ko",
    });
    expect(groups).toEqual([]);
  });
});
