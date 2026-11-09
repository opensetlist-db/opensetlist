import { describe, expect, it } from "vitest";
import { projectPurchaseOptions } from "@/lib/purchaseAvailability";

const cutoff = new Date("2026-11-09T15:00:00Z"); // midnight in Japan
const benefit = (endsAt: Date | null = null) => ({ startsAt: null, endsAt, endedAt: null });
const option = (overrides = {}) => ({
  status: "active",
  productUrl: "https://example.com/product?choice=1",
  originalStoreName: "Store A",
  includesPerformanceVideo: true,
  storeKey: "store-a",
  officialOrder: 1,
  selectionGuide: null as string | null,
  startsAt: null,
  endsAt: null,
  isBonusOption: true,
  bonuses: [benefit()],
  ...overrides,
});

describe("purchase availability", () => {
  it("preserves separate choices at one URL, counts their store once, and excludes CD-only", () => {
    const a = option({ selectionGuide: "Choose A" });
    const b = option({ selectionGuide: "Choose B" });
    const cd = option({ storeKey: "cd-store", includesPerformanceVideo: false });
    const basic = option({ storeKey: "amazon_jp", productUrl: "https://www.amazon.co.jp/dp/example", isBonusOption: false, bonuses: [] });
    const result = projectPurchaseOptions([a, b, cd, basic], cutoff, { performanceOnly: true });
    expect(result.bonusStores).toHaveLength(1);
    expect(result.bonusStores[0].options.map((entry) => entry.listing.selectionGuide)).toEqual(["Choose A", "Choose B"]);
    expect(result.bonusCount).toBe(2);
    expect(result.basicOptions).toEqual([basic]);
  });

  it("removes only an expired benefit at the exact UTC cutoff and retains the basic option", () => {
    const listing = option({ bonuses: [benefit(cutoff), benefit()] });
    const basic = option({ productUrl: "https://www.amazon.co.jp/dp/example", isBonusOption: false, bonuses: [] });
    const before = projectPurchaseOptions([listing, basic], new Date(cutoff.getTime() - 1), { performanceOnly: true });
    const at = projectPurchaseOptions([listing, basic], cutoff, { performanceOnly: true });
    const after = projectPurchaseOptions([listing, basic], new Date(cutoff.getTime() + 1), { performanceOnly: true });
    expect(before.bonusCount).toBe(2);
    expect(at.bonusCount).toBe(1);
    expect(after.bonusStores[0].options[0].bonuses).toEqual([listing.bonuses[1]]);
    expect(after.basicOptions).toEqual([basic]);
  });

  it("does not convert an expired bonus option into a basic purchase", () => {
    const expired = option({ bonuses: [benefit(cutoff)] });
    const result = projectPurchaseOptions([expired], cutoff, { performanceOnly: true });
    expect(result.bonusStores).toEqual([]);
    expect(result.basicOptions).toEqual([]);
    expect(result.bonusCount).toBe(0);
  });

  it("requires a usable link and an open sale and benefit window", () => {
    const listings = [
      option({ productUrl: "javascript:alert(1)" }),
      option({ startsAt: new Date(cutoff.getTime() + 1) }),
      option({ bonuses: [{ ...benefit(), startsAt: new Date(cutoff.getTime() + 1) }] }),
      option({ status: "ended" }),
      option({ status: "unknown" }),
      option({ status: "sold_out" }),
    ];
    const result = projectPurchaseOptions(listings, cutoff, { performanceOnly: true });
    expect(result.bonusCount).toBe(2);
    expect(result.bonusStores[0].options.map(({ listing }) => listing.status)).toEqual(["unknown", "sold_out"]);
  });

  it("uses official store order and ignores individually ended benefits", () => {
    const later = option({ storeKey: "later", officialOrder: 2 });
    const earlier = option({
      storeKey: "earlier",
      officialOrder: 1,
      bonuses: [{ ...benefit(), endedAt: cutoff }, benefit()],
    });
    const result = projectPurchaseOptions([later, earlier], cutoff, { performanceOnly: true });
    expect(result.bonusStores.map((store) => store.key)).toEqual(["earlier", "later"]);
    expect(result.bonusCount).toBe(2);
  });
});
