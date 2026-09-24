import { describe, it, expect } from "vitest";
import { pickRowArtistBadge } from "@/lib/setlistRowBadge";
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

describe("pickRowArtistBadge", () => {
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
    expect(pickRowArtistBadge(row(stageType, credit), eventArtistId)).toBe(
      expected,
    );
  });
});
