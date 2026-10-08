import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { deriveDefaultPerformerIds } from "@/app/admin/events/SetlistBuilder";
import { buildArtistHierarchy } from "@/lib/artistHierarchyTree";

// Minimal performer shape: id + the Artist ids the StageIdentity links to.
function si(id: string, ...artistIds: number[]) {
  return {
    id,
    artistLinks: artistIds.map((aid) => ({
      artist: { id: aid, translations: [] },
    })),
  };
}

// Festival-style roster: two groups' members on one event.
const AQOURS = 10;
const NIJI = 20;
const CERISE = 2;
const roster = [
  si("chika", AQOURS),
  si("riko", AQOURS),
  si("ayumu", NIJI),
  si("kaho", CERISE), // Hasunosora member linked only to her sub-unit
];

describe("deriveDefaultPerformerIds", () => {
  it("non-song rows get no performers", () => {
    expect(deriveDefaultPerformerIds("mc", "full_group", [], roster)).toEqual([]);
  });

  it("full_group with no credit → full roster (pre-festival behavior)", () => {
    expect(deriveDefaultPerformerIds("song", "full_group", [], roster)).toEqual([
      "chika",
      "riko",
      "ayumu",
      "kaho",
    ]);
  });

  it("full_group credited to a group → only that group's members", () => {
    expect(
      deriveDefaultPerformerIds("song", "full_group", [AQOURS], roster),
    ).toEqual(["chika", "riko"]);
  });

  it("full_group credited to an artist nobody links to → [] (no roster fallback)", () => {
    // The old fallback pre-checked the whole multi-group Fes roster.
    expect(
      deriveDefaultPerformerIds("song", "full_group", [999], roster),
    ).toEqual([]);
  });

  describe("with the artist hierarchy", () => {
    const HASUNOSORA = 1;
    const MUSICAL = 50;
    const hierarchy = buildArtistHierarchy([
      { id: HASUNOSORA, parentArtistId: null },
      { id: CERISE, parentArtistId: HASUNOSORA },
      { id: AQOURS, parentArtistId: null },
      { id: NIJI, parentArtistId: null },
      { id: MUSICAL, parentArtistId: null },
    ]);

    it("group credit matches members linked only to its sub-units", () => {
      expect(
        deriveDefaultPerformerIds("song", "full_group", [HASUNOSORA], roster, hierarchy),
      ).toEqual(["kaho"]);
    });

    it("credit with no member rows (Musical) → []", () => {
      expect(
        deriveDefaultPerformerIds("song", "full_group", [MUSICAL], roster, hierarchy),
      ).toEqual([]);
    });

    it("direct group links are unchanged", () => {
      expect(
        deriveDefaultPerformerIds("song", "full_group", [AQOURS], roster, hierarchy),
      ).toEqual(["chika", "riko"]);
    });

    it("unit credit does not widen to the parent group", () => {
      expect(
        deriveDefaultPerformerIds("song", "unit", [CERISE], roster, hierarchy),
      ).toEqual(["kaho"]);
    });

    it("no credit on full_group still seeds the whole roster", () => {
      expect(
        deriveDefaultPerformerIds("song", "full_group", [], roster, hierarchy),
      ).toHaveLength(roster.length);
    });
  });

  it("unit row → members of the credited unit", () => {
    expect(deriveDefaultPerformerIds("song", "unit", [CERISE], roster)).toEqual([
      "kaho",
    ]);
  });

  it("unit row without a credit → empty until the unit is picked", () => {
    expect(deriveDefaultPerformerIds("song", "unit", [], roster)).toEqual([]);
  });
});
