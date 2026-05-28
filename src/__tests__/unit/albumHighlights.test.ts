import { describe, it, expect } from "vitest";
import { collectBdAlbumIds } from "@/lib/albumHighlights";
import { countActiveBonuses } from "@/lib/albumBonusDisplay";

describe("collectBdAlbumIds", () => {
  it("returns the distinct non-null bdAlbumIds", () => {
    const events = [
      { bdAlbumId: 10 },
      { bdAlbumId: 20 },
      { bdAlbumId: 10 }, // duplicate (multi-day show sharing one BD)
      { bdAlbumId: null }, // event with no BD announced
    ];
    expect(collectBdAlbumIds(events)).toEqual([10, 20]);
  });

  it("returns an empty array when no event has a BD album", () => {
    expect(
      collectBdAlbumIds([{ bdAlbumId: null }, { bdAlbumId: null }]),
    ).toEqual([]);
  });

  it("returns an empty array for no events", () => {
    expect(collectBdAlbumIds([])).toEqual([]);
  });

  it("preserves first-occurrence order while deduping", () => {
    const events = [
      { bdAlbumId: 3 },
      { bdAlbumId: 1 },
      { bdAlbumId: 3 },
      { bdAlbumId: 2 },
      { bdAlbumId: 1 },
    ];
    expect(collectBdAlbumIds(events)).toEqual([3, 1, 2]);
  });

  it("works with bigint ids (server-query shape)", () => {
    const events = [
      { bdAlbumId: 10n },
      { bdAlbumId: 10n },
      { bdAlbumId: 99n },
    ];
    expect(collectBdAlbumIds(events)).toEqual([10n, 99n]);
  });
});

describe("countActiveBonuses", () => {
  it("sums bonuses across non-ended listings", () => {
    const listings = [
      { status: "active", bonuses: [{}, {}] },
      { status: "sold_out", bonuses: [{}] },
      { status: "unknown", bonuses: [{}] },
    ];
    // sold_out + unknown still count as active (buyable, unconfirmed).
    expect(countActiveBonuses(listings)).toBe(4);
  });

  it("excludes bonuses on ended listings", () => {
    const listings = [
      { status: "active", bonuses: [{}, {}] },
      { status: "ended", bonuses: [{}, {}, {}] },
    ];
    expect(countActiveBonuses(listings)).toBe(2);
  });

  it("returns 0 when every listing is ended", () => {
    const listings = [
      { status: "ended", bonuses: [{}] },
      { status: "ended", bonuses: [{}, {}] },
    ];
    expect(countActiveBonuses(listings)).toBe(0);
  });

  it("returns 0 for no listings", () => {
    expect(countActiveBonuses([])).toBe(0);
  });

  it("counts active listings that carry no bonuses as 0", () => {
    const listings = [{ status: "active", bonuses: [] }];
    expect(countActiveBonuses(listings)).toBe(0);
  });
});
