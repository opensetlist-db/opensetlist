import { describe, it, expect } from "vitest";
import { groupBadgeLabel, pickRowArtistBadges } from "@/lib/setlistRowBadge";
import type { ArtistRef } from "@/lib/types/setlist";

function artist(id: number, type: string, slug = `a-${id}`): ArtistRef {
  return {
    id,
    slug,
    type,
    color: null,
    originalName: slug,
    originalShortName: null,
    originalLanguage: "ja",
    translations: [],
  };
}

const HASUNOSORA = artist(1, "group", "hasunosora");
const CERISE = artist(2, "unit", "cerise-bouquet");
const KOZUE_SOLO = artist(3, "solo", "otomune-kozue");
const AQOURS = artist(10, "group", "aqours");
// `lovelive-series` umbrella artist — the Fes event's primary artist.
const UMBRELLA_ID = "99";

function row(stageType: string, credit: ArtistRef | null) {
  return { stageType, artists: credit ? [{ artist: credit }] : [] };
}

function rowMulti(stageType: string, credits: ArtistRef[]) {
  return { stageType, artists: credits.map((artist) => ({ artist })) };
}

const NIJI = artist(20, "group", "nijigasaki");
const LIELLA = artist(30, "group", "liella");
const DOLLCHESTRA = artist(4, "unit", "dollchestra");

describe("pickRowArtistBadges", () => {
  it.each([
    // [case, stageType, credit, eventArtistId, expected]
    ["single-artist event × full_group credited to the event artist → no badge", "full_group", HASUNOSORA, "1", null],
    ["single-artist event × full_group, no credit → no badge", "full_group", null, "1", null],
    ["multi-group event × full_group credited to a group → badge", "full_group", AQOURS, UMBRELLA_ID, AQOURS],
    ["multi-group event × Hasunosora full_group → badge", "full_group", HASUNOSORA, UMBRELLA_ID, HASUNOSORA],
    ["no-primary-artist event (null) × full_group credited → badge", "full_group", AQOURS, null, AQOURS],
    ["caller without event context (undefined) × full_group → no badge (legacy)", "full_group", AQOURS, undefined, null],
    ["unit row on single-artist event → badge (unchanged)", "unit", CERISE, "1", CERISE],
    ["unit row on multi-group event → badge (unchanged)", "unit", CERISE, UMBRELLA_ID, CERISE],
    ["solo row with solo credit → badge (unchanged)", "solo", KOZUE_SOLO, "1", KOZUE_SOLO],
    ["F18 misfire: solo credit on unit stage → no badge (unchanged)", "unit", KOZUE_SOLO, "1", null],
    ["F18 misfire on full_group of a multi-group event → still no badge", "full_group", KOZUE_SOLO, UMBRELLA_ID, null],
    ["unit row with no credit → no badge (caller shows stageType fallback)", "unit", null, "1", null],
  ] as const)("%s", (_label, stageType, credit, eventArtistId, expected) => {
    expect(pickRowArtistBadges(row(stageType, credit), eventArtistId)).toEqual(
      expected ? [expected] : [],
    );
  });

  it("multi-group event × 2 groups → both, in credit order", () => {
    expect(
      pickRowArtistBadges(rowMulti("full_group", [AQOURS, NIJI]), UMBRELLA_ID),
    ).toEqual([AQOURS, NIJI]);
  });

  it("multi-group event × 3 groups → all three (row renders 2 + `+1`)", () => {
    expect(
      pickRowArtistBadges(
        rowMulti("full_group", [AQOURS, NIJI, LIELLA]),
        UMBRELLA_ID,
      ),
    ).toEqual([AQOURS, NIJI, LIELLA]);
  });

  it("single-artist event × collab with the event artist → badges both", () => {
    expect(
      pickRowArtistBadges(rowMulti("full_group", [HASUNOSORA, AQOURS]), "1"),
    ).toEqual([HASUNOSORA, AQOURS]);
  });

  it("unit collab → both units", () => {
    expect(
      pickRowArtistBadges(rowMulti("unit", [CERISE, DOLLCHESTRA]), "1"),
    ).toEqual([CERISE, DOLLCHESTRA]);
  });

  it("solo misfire guard is per credit: [unit, solo] on unit stage → unit only", () => {
    expect(
      pickRowArtistBadges(rowMulti("unit", [CERISE, KOZUE_SOLO]), "1"),
    ).toEqual([CERISE]);
  });
});

describe("groupBadgeLabel", () => {
  const niji = {
    originalName: "虹ヶ咲学園スクールアイドル同好会",
    originalShortName: "虹ヶ咲",
    translations: [
      // ko row has only the long name — the case the generic
      // `displayNameWithFallback(..., "short")` cascade gets wrong.
      { locale: "ko", name: "니지가사키 학원 스쿨 아이돌 동호회", shortName: null },
      { locale: "en", name: "Nijigasaki High School Idol Club", shortName: "Nijigasaki" },
    ],
  };

  it("prefers the locale shortName", () => {
    expect(groupBadgeLabel(niji, "en")).toBe("Nijigasaki");
  });

  it("locale has a long name but no shortName → originalShortName, not the long name", () => {
    expect(groupBadgeLabel(niji, "ko")).toBe("虹ヶ咲");
  });

  it("no translation for the locale → originalShortName", () => {
    expect(groupBadgeLabel(niji, "zh-CN")).toBe("虹ヶ咲");
  });

  it("no short form anywhere → locale name, then originalName", () => {
    const noShort = { ...niji, originalShortName: null };
    expect(groupBadgeLabel(noShort, "ko")).toBe("니지가사키 학원 스쿨 아이돌 동호회");
    expect(groupBadgeLabel(noShort, "ja")).toBe("虹ヶ咲学園スクールアイドル同好会");
  });
});
