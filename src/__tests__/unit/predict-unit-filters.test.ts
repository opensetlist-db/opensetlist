import { describe, it, expect } from "vitest";
import { deriveUnitFilters } from "@/lib/predict/unitFilters";
import type { AvailableSong } from "@/lib/types/predict";

function makeSong(
  songId: number,
  unitOver: Partial<AvailableSong["unit"]>,
  songOver: Partial<Pick<AvailableSong, "isMultiArtist">> = {},
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
      isMainUnit: false,
      ...unitOver,
    },
    isMultiArtist: false,
    ...songOver,
  };
}

describe("deriveUnitFilters", () => {
  it("empty songs + null primaryArtistId → only `all`", () => {
    const out = deriveUnitFilters([], null, "", "All", "Others", "#0277BD");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: "all", kind: "all", color: null });
  });

  it("songs include only group-direct → [all, group] (no individual chips, no others)", () => {
    const songs = [makeSong(10, { artistId: 1, isSubUnit: false })];
    const out = deriveUnitFilters(songs, 1, "Hasunosora", "All", "Others", "#0277BD");
    expect(out.map((f) => f.kind)).toEqual(["all", "group"]);
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
        isMainUnit: true,
      }),
    ];
    const out = deriveUnitFilters(songs, 1, "Hasunosora", "All", "Others", "#0277BD");
    const groupChip = out.find((f) => f.kind === "group");
    expect(groupChip).toBeDefined();
    expect(groupChip?.color).toBe("#0277BD");
  });

  it("isMainUnit=true sub-unit always gets its own chip (1 song, well under threshold)", () => {
    const songs = [
      makeSong(10, { artistId: 1, isSubUnit: false }),
      makeSong(20, {
        artistId: 2,
        slug: "cerise",
        label: "Cerise",
        color: "#e91e8c",
        isSubUnit: true,
        isMainUnit: true,
      }),
    ];
    const out = deriveUnitFilters(songs, 1, "Hasunosora", "All", "Others", "#0277BD");
    expect(out.map((f) => f.kind)).toEqual(["all", "group", "individual"]);
    expect(out[2]).toMatchObject({ kind: "individual", artistId: 2, label: "Cerise" });
  });

  it("isMainUnit=false sub-unit with count ≤ threshold (10) is bucketed into 'others'", () => {
    // 3 songs from a non-main solo artist — under threshold, lands in `others`.
    const songs = [1, 2, 3].map((i) =>
      makeSong(100 + i, {
        artistId: 5,
        slug: "kozue",
        label: "Kozue",
        color: "#a0a0a0",
        isSubUnit: true,
        isMainUnit: false,
      }),
    );
    const out = deriveUnitFilters(songs, 1, "Hasunosora", "All", "Others", "#0277BD");
    expect(out.map((f) => f.kind)).toEqual(["all", "group", "others"]);
    expect(out.find((f) => f.kind === "others")).toMatchObject({
      label: "Others",
      artistId: null,
    });
  });

  it("isMainUnit=false sub-unit with count > threshold (11+) earns its own chip", () => {
    // 12 songs from a non-main solo (e.g. future Nijigasaki member) — > 10
    // threshold, gets its own `individual` chip.
    const songs = Array.from({ length: 12 }, (_, i) =>
      makeSong(200 + i, {
        artistId: 9,
        slug: "ayumu",
        label: "Ayumu",
        color: "#ff7e94",
        isSubUnit: true,
        isMainUnit: false,
      }),
    );
    const out = deriveUnitFilters(songs, 8, "Nijigasaki", "All", "Others", "#0277BD");
    expect(out.map((f) => f.kind)).toEqual(["all", "group", "individual"]);
    expect(out[2]).toMatchObject({ artistId: 9, label: "Ayumu" });
  });

  it("threshold is strictly greater than 10 (10 songs from non-main → 'others')", () => {
    const songs = Array.from({ length: 10 }, (_, i) =>
      makeSong(300 + i, {
        artistId: 7,
        slug: "border",
        label: "Border",
        color: "#888",
        isSubUnit: true,
        isMainUnit: false,
      }),
    );
    const out = deriveUnitFilters(songs, 1, "Hasunosora", "All", "Others", "#0277BD");
    expect(out.map((f) => f.kind)).toEqual(["all", "group", "others"]);
  });

  it("main units sort before non-main individual chips, slug ASC within each group", () => {
    const songs = [
      // Two main units + one high-count non-main
      makeSong(10, {
        artistId: 4,
        slug: "mira-cra-park",
        label: "Mira-Cra Park!",
        isSubUnit: true,
        isMainUnit: true,
      }),
      makeSong(11, {
        artistId: 2,
        slug: "cerise",
        label: "Cerise",
        isSubUnit: true,
        isMainUnit: true,
      }),
      // High-count non-main solo (count > 10)
      ...Array.from({ length: 11 }, (_, i) =>
        makeSong(200 + i, {
          artistId: 9,
          slug: "ayumu-solo",
          label: "Ayumu",
          isSubUnit: true,
          isMainUnit: false,
        }),
      ),
    ];
    const out = deriveUnitFilters(songs, 1, "Hasunosora", "All", "Others", "#0277BD");
    const individuals = out.filter((f) => f.kind === "individual");
    // Main units (slug ASC) → non-main individual (slug ASC). Cerise + Mira are
    // both main; Cerise < Mira-Cra Park lexicographically. Ayumu non-main comes
    // last regardless of slug.
    expect(individuals.map((f) => f.key)).toEqual([
      "cerise",
      "mira-cra-park",
      "ayumu-solo",
    ]);
  });

  it("'others' chip absent when every non-primary artist either is main or exceeds threshold", () => {
    const songs = [
      makeSong(10, {
        artistId: 2,
        slug: "cerise",
        label: "Cerise",
        isSubUnit: true,
        isMainUnit: true,
      }),
    ];
    const out = deriveUnitFilters(songs, 1, "Hasunosora", "All", "Others", "#0277BD");
    expect(out.find((f) => f.kind === "others")).toBeUndefined();
  });

  it("multiple low-count non-main units collapse into the same 'others' chip (one chip, not many)", () => {
    const songs = [
      makeSong(10, {
        artistId: 5,
        slug: "kozue-solo",
        label: "Kozue",
        isSubUnit: true,
        isMainUnit: false,
      }),
      makeSong(11, {
        artistId: 6,
        slug: "rurino-solo",
        label: "Rurino",
        isSubUnit: true,
        isMainUnit: false,
      }),
      makeSong(12, {
        artistId: 7,
        slug: "tsuzuri-solo",
        label: "Tsuzuri",
        isSubUnit: true,
        isMainUnit: false,
      }),
    ];
    const out = deriveUnitFilters(songs, 1, "Hasunosora", "All", "Others", "#0277BD");
    // 1 catch-all `others` chip — not 3 individual.
    expect(out.filter((f) => f.kind === "others")).toHaveLength(1);
    expect(out.filter((f) => f.kind === "individual")).toHaveLength(0);
  });

  it("multi-artist songs don't contribute to any individual chip count (skip in per-artist bucket walk)", () => {
    // Member A has 8 solo songs (normally → 'others' since
    // ≤ 10) + 5 multi-artist collabs. Without the skip, the
    // multi-artist songs would inflate A's bucket to 13 → push
    // A into its own `individual` chip. With the skip, A stays
    // at 8 → bucketed into `others` as expected.
    const aSolos = Array.from({ length: 8 }, (_, i) =>
      makeSong(100 + i, {
        artistId: 5,
        slug: "kozue",
        label: "Kozue",
        isSubUnit: true,
        isMainUnit: false,
      }),
    );
    const collabs = Array.from({ length: 5 }, (_, i) =>
      makeSong(
        200 + i,
        {
          artistId: 5,
          slug: "kozue",
          label: "Kozue",
          isSubUnit: true,
          isMainUnit: false,
        },
        { isMultiArtist: true },
      ),
    );
    const out = deriveUnitFilters(
      [...aSolos, ...collabs],
      1,
      "Hasunosora",
      "All",
      "Others",
      "#0277BD",
    );
    // No individual chip for Kozue (count would be 8 + 5 = 13
    // without the skip, but the skip drops Kozue to 8 → others).
    expect(out.find((f) => f.key === "kozue")).toBeUndefined();
    // `others` chip emitted because both kinds of song route there.
    expect(out.find((f) => f.kind === "others")).toBeDefined();
  });

  it("'others' chip is emitted purely from multi-artist collabs (zero per-artist bucket overflow)", () => {
    // No solo songs at all, only multi-artist collabs whose `unit`
    // points at sub-unit fallback. The bucket walk skips them, so
    // `othersSongCount` from buckets is 0. But the explicit
    // multi-artist pass still increments the count → chip emitted.
    const songs = Array.from({ length: 3 }, (_, i) =>
      makeSong(
        100 + i,
        {
          artistId: 2,
          slug: "cerise",
          label: "Cerise",
          isSubUnit: true,
          isMainUnit: true, // Main unit; would normally get its own chip…
        },
        { isMultiArtist: true }, // …but multi-artist skips bucket population.
      ),
    );
    const out = deriveUnitFilters(songs, 1, "Hasunosora", "All", "Others", "#0277BD");
    // Cerise's individual chip is NOT emitted because all 3 songs
    // were skipped by the multi-artist filter on the bucket walk.
    expect(out.find((f) => f.key === "cerise")).toBeUndefined();
    // But `others` IS emitted (3 multi-artist songs route there).
    expect(out.find((f) => f.kind === "others")).toBeDefined();
  });

  it("primaryArtistId null + sub-unit songs → no `group` chip, but other chips still apply", () => {
    const songs = [
      makeSong(10, {
        artistId: 2,
        slug: "cerise",
        label: "Cerise",
        isSubUnit: true,
        isMainUnit: true,
      }),
    ];
    const out = deriveUnitFilters(songs, null, "", "All", "Others", "#0277BD");
    expect(out.map((f) => f.kind)).toEqual(["all", "individual"]);
  });
});
