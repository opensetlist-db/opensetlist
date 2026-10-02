import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { deriveDefaultPerformerIds } from "@/app/admin/events/SetlistBuilder";

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

  it("full_group credited to an artist nobody links to → falls back to full roster", () => {
    // e.g. a Hasunosora row credited to 蓮ノ空 where members only link
    // to their sub-units — never collapse to an empty lineup.
    expect(
      deriveDefaultPerformerIds("song", "full_group", [999], roster),
    ).toHaveLength(roster.length);
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
