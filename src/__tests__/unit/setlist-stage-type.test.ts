import { describe, it, expect } from "vitest";
import { deriveStageType } from "@/lib/setlistStageType";

// Pure function tests for the unit-vs-full-group classification.
// These guarantee the rules from the task spec stay encoded the same
// way on both sides (client uses for performer auto-fill UX; server
// uses for the authoritative DB write — both run THIS helper, so a
// test here covers both call sites).
describe("deriveStageType", () => {
  it("non-song itemTypes → 'special' regardless of artists", () => {
    // MC / video / interval rows render without performers per spec;
    // 'special' is the SetlistItemStageType enum that the existing
    // operator-side code uses for these.
    for (const itemType of ["mc", "video", "interval"] as const) {
      expect(deriveStageType(itemType, [])).toEqual({
        stageType: "special",
        unitArtistId: null,
      });
      // Even if a stray songArtists list slips through (defensive
      // call sites), non-song types ignore it.
      expect(
        deriveStageType(itemType, [{ artistId: 1, type: "unit" }]),
      ).toEqual({ stageType: "special", unitArtistId: null });
    }
  });

  it("exactly one unit credit → 'unit' (+ unitArtistId returned)", () => {
    // The canonical unit-type case: "Holiday∞Holiday" credited solely
    // to スリーズブーケ (Artist.type === 'unit'). Caller uses
    // unitArtistId to fetch the unit's current members for the
    // performer auto-check.
    expect(
      deriveStageType("song", [{ artistId: 42, type: "unit" }]),
    ).toEqual({ stageType: "unit", unitArtistId: 42 });
  });

  it("exactly one solo credit → 'solo'", () => {
    expect(
      deriveStageType("song", [{ artistId: 7, type: "solo" }]),
    ).toEqual({ stageType: "solo", unitArtistId: null });
  });

  it("exactly one group credit → 'full_group' (the canonical full-group case)", () => {
    // "Dream Believers" credited solely to 蓮ノ空女学院スクールアイドルクラブ
    // (Artist.type === 'group'). All event performers default-check.
    expect(
      deriveStageType("song", [{ artistId: 100, type: "group" }]),
    ).toEqual({ stageType: "full_group", unitArtistId: null });
  });

  it("multi-artist credit → 'full_group' (collab / multiple units)", () => {
    // "Link to the FUTURE" — three primary credits, each a sub-unit.
    // From the event's POV this is a full-group performance (no single
    // unit owns it), so all event performers default-check.
    expect(
      deriveStageType("song", [
        { artistId: 1, type: "unit" },
        { artistId: 2, type: "unit" },
        { artistId: 3, type: "unit" },
      ]),
    ).toEqual({ stageType: "full_group", unitArtistId: null });
  });

  it("empty artists array → 'full_group' (defensive — should never happen for real songs)", () => {
    // A song with zero SongArtist rows is a data bug, but the helper
    // shouldn't throw. 'full_group' is the safest default — fan can
    // adjust the performer list manually.
    expect(deriveStageType("song", [])).toEqual({
      stageType: "full_group",
      unitArtistId: null,
    });
  });
});
