import { describe, it, expect, vi, beforeEach } from "vitest";

// getAlbumsPage is the only DB reader under test here; the spies capture
// the two Prisma calls so the shared filter/ordering contract can be
// asserted without a database.
const db = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { album: { count: db.count, findMany: db.findMany } },
}));

import {
  groupAlbumsByYear,
  getAlbumsPage,
  parseAlbumPageParam,
  albumPageParamValue,
  albumPageItems,
  ALBUMS_PER_PAGE,
  type AlbumsListItem,
} from "@/lib/albums";

// groupAlbumsByYear only reads `id` (for assertions here) + `releaseDate`.
// Build minimal fixtures and cast — the full Prisma payload shape is
// irrelevant to the grouping logic under test.
function mk(id: number, releaseDate: string | null): AlbumsListItem {
  return { id, releaseDate } as unknown as AlbumsListItem;
}

const ids = (group: { albums: AlbumsListItem[] }) =>
  group.albums.map((a) => a.id);

describe("groupAlbumsByYear", () => {
  it("returns an empty array for no albums", () => {
    expect(groupAlbumsByYear([])).toEqual([]);
  });

  it("groups a single album into its release year", () => {
    const groups = groupAlbumsByYear([mk(1, "2024-08-07")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].year).toBe(2024);
    expect(ids(groups[0])).toEqual([1]);
  });

  it("buckets albums by year and orders years descending", () => {
    const groups = groupAlbumsByYear([
      mk(1, "2026-09-25"),
      mk(2, "2026-06-04"),
      mk(3, "2025-06-04"),
      mk(4, "2023-04-05"),
    ]);
    expect(groups.map((g) => g.year)).toEqual([2026, 2025, 2023]);
    expect(ids(groups[0])).toEqual([1, 2]); // both 2026, input order preserved
    expect(ids(groups[1])).toEqual([3]);
    expect(ids(groups[2])).toEqual([4]);
  });

  it("preserves input (newest-first) order within a year", () => {
    const groups = groupAlbumsByYear([
      mk(10, "2026-12-01"),
      mk(11, "2026-03-01"),
    ]);
    expect(ids(groups[0])).toEqual([10, 11]);
  });

  it("sinks the null-release bucket to the end", () => {
    const groups = groupAlbumsByYear([
      mk(1, "2026-01-01"),
      mk(2, null),
      mk(3, "2024-01-01"),
    ]);
    expect(groups.map((g) => g.year)).toEqual([2026, 2024, null]);
    expect(ids(groups[2])).toEqual([2]);
  });

  it("collapses multiple null-release albums into one trailing bucket", () => {
    const groups = groupAlbumsByYear([mk(1, null), mk(2, "2025-05-05"), mk(3, null)]);
    expect(groups.map((g) => g.year)).toEqual([2025, null]);
    expect(ids(groups[1])).toEqual([1, 3]);
  });

  it("buckets a year-end date by its UTC year (no local-TZ drift)", () => {
    // A date-only `2025-12-31` parses as UTC midnight; getUTCFullYear
    // must read 2025 regardless of the machine's timezone.
    const groups = groupAlbumsByYear([mk(1, "2025-12-31")]);
    expect(groups[0].year).toBe(2025);
  });

  it("treats an unparseable releaseDate as undated", () => {
    const groups = groupAlbumsByYear([mk(1, "not-a-date")]);
    expect(groups[0].year).toBeNull();
  });
});

describe("getAlbumsPage", () => {
  beforeEach(() => {
    db.count.mockReset();
    db.findMany.mockReset();
  });

  it("fetches one bounded page and counts with the very same filter", async () => {
    db.count.mockResolvedValue(69);
    db.findMany.mockResolvedValue([]);
    const result = await getAlbumsPage("ko", BigInt(1), 3);

    const countArgs = db.count.mock.calls[0][0];
    const findArgs = db.findMany.mock.calls[0][0];
    // Same where object for both (deleted sub-units excluded, artist
    // OR its direct sub-units) — the total can't drift from the rows.
    expect(findArgs.where).toEqual(countArgs.where);
    expect(countArgs.where).toEqual({
      artists: {
        some: {
          artist: {
            isDeleted: false,
            OR: [{ id: BigInt(1) }, { parentArtistId: BigInt(1) }],
          },
        },
      },
    });
    expect(findArgs.orderBy).toEqual([
      { releaseDate: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ]);
    expect(findArgs.take).toBe(ALBUMS_PER_PAGE);
    expect(findArgs.skip).toBe(40);
    expect(result).toEqual({ albums: [], total: 69, totalPages: 4 });
  });

  it("has no filter for the unfiltered list and 0 pages when empty", async () => {
    db.count.mockResolvedValue(0);
    db.findMany.mockResolvedValue([]);
    const result = await getAlbumsPage("ja", undefined, 1);
    expect(db.count.mock.calls[0][0].where).toBeUndefined();
    expect(db.findMany.mock.calls[0][0].where).toBeUndefined();
    expect(db.findMany.mock.calls[0][0].skip).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it("rounds a partial last page up (474 → 24 pages)", async () => {
    db.count.mockResolvedValue(474);
    db.findMany.mockResolvedValue([]);
    expect((await getAlbumsPage("en", undefined, 24)).totalPages).toBe(24);
    db.count.mockResolvedValue(480);
    expect((await getAlbumsPage("en", undefined, 24)).totalPages).toBe(24);
  });

  it("keeps the optimistic offset bounded for an absurd page number", async () => {
    db.count.mockResolvedValue(474);
    db.findMany.mockResolvedValue([]);
    await getAlbumsPage("ko", undefined, Number.MAX_SAFE_INTEGER);
    const { skip } = db.findMany.mock.calls[0][0];
    expect(Number.isSafeInteger(skip)).toBe(true);
    expect(skip).toBeLessThanOrEqual(100_000 * ALBUMS_PER_PAGE);
  });
});

describe("parseAlbumPageParam", () => {
  it.each([
    [undefined, 1],
    ["1", 1],
    ["2", 2],
    ["024", 24],
    [["3", "5"], 3],
    ["99999999999999999999", Number.MAX_SAFE_INTEGER],
  ] as const)("reads %j as page %i", (raw, page) => {
    expect(parseAlbumPageParam(raw as string | string[] | undefined)).toBe(page);
  });

  it.each(["", "0", "-2", "1.5", "abc", "2abc", " 2", "1e3", "000"])(
    "maps malformed %j to page 1",
    (raw) => {
      expect(parseAlbumPageParam(raw)).toBe(1);
    },
  );
});

describe("albumPageParamValue", () => {
  it("omits the parameter for page 1 and spells later pages plainly", () => {
    expect(albumPageParamValue(1)).toBeUndefined();
    expect(albumPageParamValue(2)).toBe("2");
    expect(albumPageParamValue(24)).toBe("24");
  });
});

describe("albumPageItems", () => {
  // Expected windows are the approved v3 packet's (474 albums, 24 pages).
  it.each([
    [1, [1, 2, "ellipsis", 24]],
    [2, [1, 2, 3, "ellipsis", 24]],
    [3, [1, 2, 3, 4, "ellipsis", 24]],
    [4, [1, "ellipsis", 3, 4, 5, "ellipsis", 24]],
    [10, [1, "ellipsis", 9, 10, 11, "ellipsis", 24]],
    [22, [1, "ellipsis", 21, 22, 23, 24]],
    [24, [1, "ellipsis", 23, 24]],
  ] as const)("page %i of 24", (page, expected) => {
    expect(albumPageItems(page, 24)).toEqual(expected);
  });

  it("lists every page without gaps when they all fit", () => {
    expect(albumPageItems(2, 4)).toEqual([1, 2, 3, 4]);
    expect(albumPageItems(1, 2)).toEqual([1, 2]);
    expect(albumPageItems(1, 1)).toEqual([1]);
  });
});
