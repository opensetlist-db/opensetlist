import { describe, it, expect } from "vitest";

import { buildArtistHierarchy } from "@/lib/artistHierarchyTree";
import {
  boardGroupRootIds,
  boardGroupsFromRows,
  fanBoardRootIds,
  resolveBoardGroups,
  seriesPrimaryArtistOf,
  type BoardGroupArtistRow,
} from "@/lib/board/boardGroups";
import { safeBigIntToNumber } from "@/lib/copyPastSetlist";
import { displayNameWithFallback } from "@/lib/display";
import { resolveFestivalGroups } from "@/lib/predict/festivalCatalog";
import type { AvailableSong } from "@/lib/types/predict";
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
  member("ayumu", [rosterArtist(30, null), rosterArtist(20, null)], true),
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

// Same tree as H, with the cross-IP collab root (20) flagged as a side
// project and an operator series order on the rest.
const H_SIDE = buildArtistHierarchy([
  { id: BigInt(1), parentArtistId: null, sortOrder: 2 },
  { id: BigInt(2), parentArtistId: BigInt(1) },
  { id: BigInt(3), parentArtistId: BigInt(1) },
  { id: BigInt(10), parentArtistId: null, sortOrder: 3 },
  { id: BigInt(11), parentArtistId: BigInt(10) },
  { id: BigInt(20), parentArtistId: null, isSideProject: true },
  { id: BigInt(30), parentArtistId: null, sortOrder: 1 },
]);

describe("fanBoardRootIds (side projects off the board)", () => {
  it("festival: drops a side project, everything else keeps the picker's order", () => {
    const picker = boardGroupRootIds({ roster: FES_ROSTER, hierarchy: H_SIDE, primaryArtistId: null, collaborationArtistIds: [20] });
    // The picker keeps the side project (unordered → last) …
    expect(picker).toEqual(["30", "1", "10", "20"]);
    // … the board does not, and agrees with the picker on the rest.
    expect(
      fanBoardRootIds({ roster: FES_ROSTER, hierarchy: H_SIDE, primaryArtistId: null, collaborationArtistIds: [20] }),
    ).toEqual(["30", "1", "10"]);
  });

  it("festival without side projects: identical to boardGroupRootIds", () => {
    expect(
      fanBoardRootIds({ roster: FES_ROSTER, hierarchy: H, primaryArtistId: null }),
    ).toEqual(boardGroupRootIds({ roster: FES_ROSTER, hierarchy: H, primaryArtistId: null }));
  });

  it("single-artist: a side project's own show keeps its one group", () => {
    expect(
      fanBoardRootIds({ roster: FES_ROSTER, hierarchy: H_SIDE, primaryArtistId: 20 }),
    ).toEqual(["20"]);
  });

  it("resolveBoardGroups goes through the same filter", () => {
    const groups = resolveBoardGroups({
      roster: FES_ROSTER,
      hierarchy: H_SIDE,
      primaryArtist: null,
      groupArtists: FES_ROWS,
      locale: "ko",
    });
    expect(groups.map((g) => g.artistId)).toEqual([30, 1, 10]);
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

// Verbatim port of the festival branch of the event page as it stood
// before the board resolver existed (index-aligned groups + catalogs).
// The characterization test below pins the page's new code path —
// `boardGroupRootIds` → `boardGroupsFromRows` → catalogs by root id —
// to this output, so a later change to the resolver that would move a
// picker chip fails here rather than on the Fes page.
function legacyFestivalPath(
  roster: EventRosterEntry[],
  hierarchy: typeof H,
  groupArtists: BoardGroupArtistRow[],
  perGroupById: Map<string, AvailableSong[]>,
  locale: string,
) {
  const groupRefs = resolveFestivalGroups(roster, hierarchy);
  const perGroup = groupRefs.map((g) => perGroupById.get(g.rootId) ?? []);
  const artistById = new Map(groupArtists.map((a) => [String(a.id), a]));
  const groups: Array<{ artistId: number; slug: string; label: string; color: string | null }> = [];
  const groupCatalogs: AvailableSong[][] = [];
  groupRefs.forEach((ref, i) => {
    const artist = artistById.get(ref.rootId);
    const artistId = artist ? safeBigIntToNumber(BigInt(artist.id)) : null;
    if (!artist || artistId === null) return;
    groups.push({
      artistId,
      slug: artist.slug,
      label: displayNameWithFallback(artist, artist.translations, locale, "short"),
      color: artist.color,
    });
    groupCatalogs.push(perGroup[i]);
  });
  return { groups, groupCatalogs };
}

function newFestivalPath(
  roster: EventRosterEntry[],
  hierarchy: typeof H,
  groupArtists: BoardGroupArtistRow[],
  perGroupById: Map<string, AvailableSong[]>,
  locale: string,
) {
  const rootIds = boardGroupRootIds({ roster, hierarchy, primaryArtistId: null });
  const perGroup = rootIds.map((id) => perGroupById.get(id) ?? []);
  const groups = boardGroupsFromRows(rootIds, groupArtists, locale);
  const catalogByRoot = new Map(rootIds.map((id, i) => [id, perGroup[i]]));
  const groupCatalogs = groups.map((g) => catalogByRoot.get(String(g.artistId)) ?? []);
  return { groups, groupCatalogs };
}

function catalog(rootId: number): AvailableSong[] {
  // Identity is all that matters here — the test checks which catalog
  // array lines up with which group, not its contents.
  return [{ songId: rootId * 100 } as AvailableSong];
}

describe("festival page path — characterization against the pre-resolver page", () => {
  const perGroupById = new Map(
    [1, 10, 20, 30].map((id) => [String(id), catalog(id)]),
  );

  it("full Fes roster: identical groups and catalog alignment", () => {
    for (const locale of ["ko", "ja", "en"]) {
      expect(newFestivalPath(FES_ROSTER, H, FES_ROWS, perGroupById, locale)).toEqual(
        legacyFestivalPath(FES_ROSTER, H, FES_ROWS, perGroupById, locale),
      );
    }
  });

  it("a missing display row: same drop, catalogs stay aligned", () => {
    const rows = [row(1), row(20), row(30)];
    const next = newFestivalPath(FES_ROSTER, H, rows, perGroupById, "ko");
    expect(next).toEqual(legacyFestivalPath(FES_ROSTER, H, rows, perGroupById, "ko"));
    expect(next.groupCatalogs.map((c) => c[0].songId)).toEqual([100, 2000, 3000]);
  });
});

describe("boardGroupsFromRows", () => {
  it("last row wins on a duplicate id", () => {
    const groups = boardGroupsFromRows(
      ["1"],
      [row(1, { color: "#111111" }), row(1, { color: "#222222" })],
      "ko",
    );
    expect(groups.map((g) => g.color)).toEqual(["#222222"]);
  });
});

describe("seriesPrimaryArtistOf", () => {
  it("returns the alive series artist", () => {
    const artist = { id: 1, isDeleted: false };
    expect(seriesPrimaryArtistOf({ artist })).toBe(artist);
  });

  it("null for no series, a festival series, or a soft-deleted artist", () => {
    expect(seriesPrimaryArtistOf(null)).toBeNull();
    expect(seriesPrimaryArtistOf(undefined)).toBeNull();
    expect(seriesPrimaryArtistOf({ artist: null })).toBeNull();
    expect(seriesPrimaryArtistOf({ artist: { id: 1, isDeleted: true } })).toBeNull();
  });
});
