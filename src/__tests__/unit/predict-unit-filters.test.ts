import { describe, it, expect } from "vitest";
import { deriveUnitFilters } from "@/lib/predict/unitFilters";
import type { AvailableSong } from "@/lib/types/predict";

function makeSong(
  songId: number,
  unitOver: Partial<AvailableSong["unit"]>,
): AvailableSong {
  return {
    songId,
    originalTitle: `t${songId}`,
    originalLanguage: "ja",
    variantLabel: null,
    baseVersionId: null,
    translations: [],
    unit: {
      artistId: 1,
      slug: "hasunosora",
      label: "Hasunosora",
      color: "#0277BD",
      isSubUnit: false,
      ...unitOver,
    },
  };
}

describe("deriveUnitFilters", () => {
  it("empty songs + null primaryArtistId → only `all`", () => {
    const out = deriveUnitFilters([], null, "", "All", "Units / Solo", "#0277BD");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: "all", kind: "all", color: null });
  });

  it("songs include only group-direct → [all, group] (no sub composite)", () => {
    const songs = [makeSong(10, { artistId: 1, isSubUnit: false })];
    const out = deriveUnitFilters(songs, 1, "Hasunosora", "All", "Units / Solo", "#0277BD");
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe("all");
    expect(out[1]).toMatchObject({
      kind: "group",
      label: "Hasunosora",
      artistId: 1,
    });
  });

  it("group chip color falls back to brand primary when no group-direct song exists yet", () => {
    const songs = [
      makeSong(10, {
        artistId: 2,
        slug: "cerise",
        label: "Cerise",
        color: "#e91e8c",
        isSubUnit: true,
      }),
    ];
    const out = deriveUnitFilters(songs, 1, "Hasunosora", "All", "Units / Solo", "#0277BD");
    const groupChip = out.find((f) => f.kind === "group");
    expect(groupChip).toBeDefined();
    // Brand primary fallback — not the sub-unit's color.
    expect(groupChip?.color).not.toBe("#e91e8c");
  });

  it("songs include sub-unit → [all, group, sub, individual]", () => {
    const songs = [
      makeSong(10, { artistId: 1, isSubUnit: false }),
      makeSong(20, {
        artistId: 2,
        slug: "cerise",
        label: "Cerise",
        color: "#e91e8c",
        isSubUnit: true,
      }),
    ];
    const out = deriveUnitFilters(songs, 1, "Hasunosora", "All", "Units / Solo", "#0277BD");
    expect(out.map((f) => f.kind)).toEqual([
      "all",
      "group",
      "sub",
      "individual",
    ]);
  });

  it("sub-unit chips deduped by artistId (multiple songs from same unit → one chip)", () => {
    const songs = [
      makeSong(10, {
        artistId: 2,
        slug: "cerise",
        label: "Cerise",
        color: "#e91e8c",
        isSubUnit: true,
      }),
      makeSong(11, {
        artistId: 2,
        slug: "cerise",
        label: "Cerise",
        color: "#e91e8c",
        isSubUnit: true,
      }),
    ];
    const out = deriveUnitFilters(songs, 1, "Hasunosora", "All", "Units / Solo", "#0277BD");
    const individualChips = out.filter((f) => f.kind === "individual");
    expect(individualChips).toHaveLength(1);
  });

  it("sub-unit chips ordered by slug ASC", () => {
    const songs = [
      makeSong(10, {
        artistId: 4,
        slug: "mira-cra-park",
        label: "Mira-Cra Park!",
        color: "#f57c00",
        isSubUnit: true,
      }),
      makeSong(11, {
        artistId: 2,
        slug: "cerise",
        label: "Cerise",
        color: "#e91e8c",
        isSubUnit: true,
      }),
      makeSong(12, {
        artistId: 3,
        slug: "dollchestra",
        label: "DOLLCHESTRA",
        color: "#6c3fc5",
        isSubUnit: true,
      }),
    ];
    const out = deriveUnitFilters(songs, 1, "Hasunosora", "All", "Units / Solo", "#0277BD");
    const individualChips = out.filter((f) => f.kind === "individual");
    expect(individualChips.map((f) => f.key)).toEqual([
      "cerise",
      "dollchestra",
      "mira-cra-park",
    ]);
  });

  it("primaryArtistId null + sub-unit songs → no `group` chip, but `sub` composite still appears", () => {
    const songs = [
      makeSong(10, {
        artistId: 2,
        slug: "cerise",
        label: "Cerise",
        color: "#e91e8c",
        isSubUnit: true,
      }),
    ];
    const out = deriveUnitFilters(songs, null, "", "All", "Units / Solo", "#0277BD");
    expect(out.map((f) => f.kind)).toEqual(["all", "sub", "individual"]);
  });
});
