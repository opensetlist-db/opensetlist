import { describe, it, expect } from "vitest";
import { collectBdAlbumIds } from "@/lib/albumHighlights";
import { countActiveBonuses } from "@/lib/albumBonusDisplay";
import type { PurchaseBonus } from "@/lib/purchaseAvailability";

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
    // BigInt(...) calls rather than `10n` literals — the project's tsc
    // target predates ES2020 BigInt literal syntax.
    const events = [
      { bdAlbumId: BigInt(10) },
      { bdAlbumId: BigInt(10) },
      { bdAlbumId: BigInt(99) },
    ];
    expect(collectBdAlbumIds(events)).toEqual([BigInt(10), BigInt(99)]);
  });
});

describe("countActiveBonuses", () => {
  const bonus: PurchaseBonus = { startsAt: null, endsAt: null, endedAt: null };
  const listing = (status: string, bonuses: PurchaseBonus[] = [bonus]) => ({
    status,
    bonuses,
    productUrl: "https://example.com/product",
    originalStoreName: "Store",
    includesPerformanceVideo: true,
    isBonusOption: true,
    storeKey: "store",
    officialOrder: null,
    startsAt: null,
    endsAt: null,
  });

  it("counts only currently visible benefits", () => {
    expect(countActiveBonuses([
      listing("active", [bonus, bonus]),
      listing("sold_out"),
      listing("unknown"),
      listing("ended"),
      { ...listing("active"), productUrl: null },
      listing("active", [{ ...bonus, endsAt: new Date("2000-01-01T00:00:00Z") }]),
    ])).toBe(4);
  });

  it("returns 0 for no listings", () => {
    expect(countActiveBonuses([])).toBe(0);
  });

  it("counts active listings that carry no bonuses as 0", () => {
    const listings = [listing("active", [])];
    expect(countActiveBonuses(listings)).toBe(0);
  });
});
