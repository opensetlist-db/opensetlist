import { describe, it, expect } from "vitest";
import {
  isArtistsListFilter,
  synthesizeUngroupedSections,
  type ArtistRowData,
  type ArtistsListFilter,
} from "@/lib/artists";
import type { GroupCategory } from "@/generated/prisma/enums";

function row(
  id: number,
  opts: { hasOngoing?: boolean; totalEvents?: number } = {},
): ArtistRowData {
  return {
    id,
    slug: `artist-${id}`,
    color: null,
    type: "group",
    originalName: `Artist ${id}`,
    originalShortName: null,
    originalLanguage: "ja",
    translations: [],
    subArtists: [],
    hasOngoing: opts.hasOngoing ?? false,
    totalEvents: opts.totalEvents ?? 0,
  };
}

function input(category: GroupCategory | null, artist: ArtistRowData) {
  return { category, artist };
}

describe("isArtistsListFilter", () => {
  it("accepts every active enum value plus `all`", () => {
    for (const v of ["all", "animegame", "kpop", "jpop", "cpop", "others"]) {
      expect(isArtistsListFilter(v)).toBe(true);
    }
  });

  it("rejects retired enum values from the v2 reshape", () => {
    expect(isArtistsListFilter("anime")).toBe(false);
    expect(isArtistsListFilter("game")).toBe(false);
  });

  it("rejects unknown / undefined", () => {
    expect(isArtistsListFilter("kpoop")).toBe(false);
    expect(isArtistsListFilter(undefined)).toBe(false);
  });
});

describe("synthesizeUngroupedSections", () => {
  it("buckets each artist into its `Artist.category` slot", () => {
    const rows = [
      input("animegame", row(1)),
      input("kpop", row(2)),
      input("animegame", row(3)),
    ];
    const sections = synthesizeUngroupedSections(rows, "all");
    const animegame = sections.find((s) => s.category === "animegame");
    const kpop = sections.find((s) => s.category === "kpop");
    expect(animegame?.artists.map((a) => a.id)).toEqual([1, 3]);
    expect(kpop?.artists.map((a) => a.id)).toEqual([2]);
  });

  it("orders sections animegame → kpop → jpop → cpop → others → none", () => {
    const rows = [
      input("others", row(1)),
      input("cpop", row(2)),
      input("jpop", row(3)),
      input("kpop", row(4)),
      input("animegame", row(5)),
      input(null, row(6)),
    ];
    const sections = synthesizeUngroupedSections(rows, "all");
    expect(sections.map((s) => s.category)).toEqual([
      "animegame",
      "kpop",
      "jpop",
      "cpop",
      "others",
      null,
    ]);
  });

  it("emits the null-category section only when filter is `all`", () => {
    const rows = [input(null, row(1)), input("animegame", row(2))];
    const all = synthesizeUngroupedSections(rows, "all");
    expect(all.some((s) => s.category === null)).toBe(true);
    const animegame = synthesizeUngroupedSections(rows, "animegame");
    expect(animegame.some((s) => s.category === null)).toBe(false);
  });

  it("skips empty buckets", () => {
    const rows = [input("animegame", row(1))];
    const sections = synthesizeUngroupedSections(rows, "all");
    expect(sections).toHaveLength(1);
  });

  it("marks synthetic sections with isSynthetic=true and a namespaced id", () => {
    const rows = [input("animegame", row(1))];
    const sections = synthesizeUngroupedSections(rows, "all");
    expect(sections[0].isSynthetic).toBe(true);
    expect(sections[0].id).toBe("synthetic:ungrouped:animegame");
  });

  it("derives section.hasOngoing from any artist's hasOngoing flag", () => {
    const sectionsAllStatic = synthesizeUngroupedSections(
      [input("animegame", row(1, { hasOngoing: false }))],
      "all",
    );
    expect(sectionsAllStatic[0].hasOngoing).toBe(false);

    const sectionsOneOngoing = synthesizeUngroupedSections(
      [
        input("animegame", row(1, { hasOngoing: false })),
        input("animegame", row(2, { hasOngoing: true })),
      ],
      "all",
    );
    expect(sectionsOneOngoing[0].hasOngoing).toBe(true);
  });

  it("returns [] when there are no ungrouped artists", () => {
    const sections = synthesizeUngroupedSections([], "all" as ArtistsListFilter);
    expect(sections).toEqual([]);
  });

  it("uses null on the null-category section so consumers can render no badge", () => {
    const sections = synthesizeUngroupedSections(
      [input(null, row(1))],
      "all",
    );
    expect(sections[0].category).toBeNull();
    expect(sections[0].id).toBe("synthetic:ungrouped:none");
  });
});
