import { describe, it, expect } from "vitest";
import { groupAlbumsByYear, type AlbumsListItem } from "@/lib/albums";

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
