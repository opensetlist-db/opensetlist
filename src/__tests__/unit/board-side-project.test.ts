// @vitest-environment node
//
// Side projects (`Artist.isSideProject`) and the operator series order
// (`Artist.sortOrder`) through the REAL `loadBoardGroups` and the real
// write validators — only the cached reads under them are mocked. The
// pure halves are covered in `board-groups.test.ts`; this pins that
// every board consumer that goes through the loader (pick and publish
// validators here; the board read and the admin editor share it) sees
// the same filtered, ordered list, and that a pick or a publish naming
// the side project's id is refused as `invalid_group`.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { song: { findFirst: vi.fn(), findMany: vi.fn() } },
}));
vi.mock("@/lib/artistHierarchy", () => ({ getArtistHierarchyCached: vi.fn() }));
vi.mock("@/lib/eventRoster", () => ({ getEventRoster: vi.fn() }));
vi.mock("@/lib/predict/availableSongs", () => ({
  getFestivalGroupArtistsCached: vi.fn(),
  getAvailableSongsCached: vi.fn(),
}));

import { buildArtistHierarchy } from "@/lib/artistHierarchyTree";
import { getArtistHierarchyCached } from "@/lib/artistHierarchy";
import { getEventRoster } from "@/lib/eventRoster";
import {
  getAvailableSongsCached,
  getFestivalGroupArtistsCached,
} from "@/lib/predict/availableSongs";
import { prisma } from "@/lib/prisma";
import { loadBoardGroups } from "@/lib/board/loadBoardGroups";
import { validatePickTarget } from "@/lib/board/picks";
import { validatePublishTargets } from "@/lib/board/publish";
import type { AvailableSong } from "@/lib/types/predict";
import type { EventRosterEntry, RosterArtist } from "@/lib/types/setlist";

// Roots 1 and 10 are series; 20 is a cross-series side unit whose
// members also belong to 1 and 10. 1 brings the most performers but
// the operator orders 10 first.
const HIERARCHY = buildArtistHierarchy([
  { id: BigInt(1), parentArtistId: null, sortOrder: 2 },
  { id: BigInt(10), parentArtistId: null, sortOrder: 1 },
  { id: BigInt(20), parentArtistId: null, isSideProject: true },
]);

function artist(id: number): RosterArtist {
  return {
    id,
    slug: `a${id}`,
    type: "group",
    color: null,
    parentArtistId: null,
    isMainUnit: false,
    isDeleted: false,
    originalName: `A${id}`,
    originalShortName: null,
    originalLanguage: "ja",
    translations: [],
  };
}

function member(id: string, roots: number[]): EventRosterEntry {
  return {
    isGuest: false,
    stageIdentity: {
      id,
      slug: id,
      originalName: id,
      originalShortName: null,
      originalLanguage: "ja",
      translations: [],
      artistLinks: roots.map((r) => ({ artist: artist(r) })),
    },
  };
}

const ROSTER = [
  member("a", [1, 20]),
  member("b", [1]),
  member("c", [1]),
  member("d", [10, 20]),
];

function displayRow(id: number) {
  return {
    id: BigInt(id),
    slug: `g${id}`,
    color: null,
    originalName: `G${id}`,
    originalShortName: null,
    originalLanguage: "ja",
    translations: [],
  };
}

const CTX = { eventId: BigInt(107), primaryArtistId: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getArtistHierarchyCached).mockResolvedValue(HIERARCHY);
  vi.mocked(getEventRoster).mockResolvedValue(ROSTER);
  vi.mocked(getFestivalGroupArtistsCached).mockImplementation(
    (async (idKey: string) =>
      idKey.split(",").map((id) => displayRow(Number(id)))) as never,
  );
  // Song 50 is credited to the side project only.
  vi.mocked(getAvailableSongsCached).mockImplementation((async (root: bigint) =>
    [{ songId: Number(root) * 10 + 5 } as AvailableSong]) as never);
  vi.mocked(prisma.song.findFirst).mockResolvedValue({ id: BigInt(205) } as never);
  vi.mocked(prisma.song.findMany).mockResolvedValue([{ id: BigInt(205) }] as never);
});

describe("loadBoardGroups — festival", () => {
  it("drops the side project and orders the rest by sortOrder", async () => {
    const groups = await loadBoardGroups({
      eventId: BigInt(107),
      primaryArtistId: null,
      locale: "ko",
    });
    expect(groups.map((g) => g.artistId)).toEqual([10, 1]);
    // The side project's display row is not even loaded.
    expect(getFestivalGroupArtistsCached).toHaveBeenCalledWith("1,10", "ko");
  });

  it("a side project's own single-artist show keeps its one group", async () => {
    const groups = await loadBoardGroups({
      eventId: BigInt(108),
      primaryArtistId: BigInt(20),
      locale: "ko",
    });
    expect(groups.map((g) => g.artistId)).toEqual([20]);
  });
});

describe("write validators refuse the side project's group id", () => {
  // Positive control: the same fixture accepts a real board group, so
  // the rejections below are about group 20 and not a mock that makes
  // every group invalid.
  it("a board group's pick and publish pass", async () => {
    await expect(validatePickTarget(CTX, BigInt(10), BigInt(105))).resolves.toBeUndefined();
    await expect(
      validatePublishTargets(CTX, [{ groupId: BigInt(10), songId: BigInt(105) }]),
    ).resolves.toBeUndefined();
  });

  it("single pick → 400 invalid_group", async () => {
    await expect(validatePickTarget(CTX, BigInt(20), BigInt(205))).rejects.toMatchObject({
      status: 400,
      code: "invalid_group",
    });
  });

  it("publish → 400 invalid_group, even next to valid picks", async () => {
    await expect(
      validatePublishTargets(CTX, [
        { groupId: BigInt(10), songId: BigInt(105) },
        { groupId: BigInt(20), songId: BigInt(205) },
      ]),
    ).rejects.toMatchObject({ status: 400, code: "invalid_group" });
  });
});
