import { describe, it, expect } from "vitest";
import { isSongMatched, type SongMatchInputItem } from "@/lib/songMatch";

function item(...songs: Array<{ id: number; baseVersionId?: number | null }>): SongMatchInputItem {
  return {
    songs: songs.map((s) => ({
      song: { id: s.id, baseVersionId: s.baseVersionId ?? null },
    })),
  };
}

describe("isSongMatched", () => {
  it("direct id match", () => {
    expect(isSongMatched(42, [item({ id: 42 })])).toBe(true);
  });

  it("returns false when no song matches", () => {
    expect(isSongMatched(42, [item({ id: 1 }, { id: 2 }, { id: 3 })])).toBe(false);
  });

  it("returns false on empty setlist", () => {
    expect(isSongMatched(42, [])).toBe(false);
  });

  it("variant forward: wished base hits actual variant via baseVersionId", () => {
    // wished "Dream Believers" (id=10) matches actual "Dream Believers (105th Ver.)"
    // (id=11, baseVersionId=10)
    expect(isSongMatched(10, [item({ id: 11, baseVersionId: 10 })])).toBe(true);
  });

  it("does NOT match a different song with a different base", () => {
    // wishedId 10, actual variant whose base is 99 — unrelated.
    expect(isSongMatched(10, [item({ id: 11, baseVersionId: 99 })])).toBe(false);
  });

  it("medley: any constituent songId hit flips the SetlistItem to matched", () => {
    // Medley item with three songs; only the middle one matches.
    expect(
      isSongMatched(50, [item({ id: 1 }, { id: 50 }, { id: 99 })]),
    ).toBe(true);
  });

  it("medley + variant: a medley constituent variant of the wished base matches", () => {
    expect(
      isSongMatched(10, [item({ id: 1 }, { id: 11, baseVersionId: 10 })]),
    ).toBe(true);
  });

  it("multi-occurrence: same wished song twice in the actual setlist still returns true (boolean is sufficient)", () => {
    expect(
      isSongMatched(42, [item({ id: 42 }), item({ id: 42 })]),
    ).toBe(true);
  });

  it("baseVersionId null on every song doesn't match a non-direct wishedId", () => {
    expect(
      isSongMatched(7, [item({ id: 1, baseVersionId: null }, { id: 2, baseVersionId: null })]),
    ).toBe(false);
  });
});
