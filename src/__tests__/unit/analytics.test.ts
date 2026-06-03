import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  trackAlbumView,
  trackStoreClick,
  trackBdSectionView,
} from "@/lib/analytics";
import { BD_STATE_GA_VALUE } from "@/lib/eventBdState";

// The wrappers funnel through trackEvent → window.gtag("event", …).
// Stub gtag and assert the exact name + params each wrapper emits.
let gtag: ReturnType<typeof vi.fn>;

beforeEach(() => {
  gtag = vi.fn();
  (window as unknown as { gtag: typeof gtag }).gtag = gtag;
});

afterEach(() => {
  delete (window as unknown as { gtag?: unknown }).gtag;
  vi.restoreAllMocks();
});

describe("trackAlbumView", () => {
  it("emits album_view with all params", () => {
    trackAlbumView({
      albumId: "42",
      albumType: "single",
      artistId: "7",
      locale: "ko",
      hasAmazonListing: true,
    });
    expect(gtag).toHaveBeenCalledOnce();
    expect(gtag).toHaveBeenCalledWith("event", "album_view", {
      album_id: "42",
      album_type: "single",
      artist_id: "7",
      locale: "ko",
      has_amazon_listing: true,
    });
  });
});

describe("trackStoreClick", () => {
  it("omits bonus_id when not provided", () => {
    trackStoreClick({
      albumId: "42",
      storeKey: "amazon_jp",
      storeStatus: "active",
      surface: "album_page",
      isAffiliate: false,
    });
    expect(gtag).toHaveBeenCalledOnce();
    const params = gtag.mock.calls[0][2];
    expect(params).toEqual({
      album_id: "42",
      store_key: "amazon_jp",
      store_status: "active",
      surface: "album_page",
      is_affiliate: false,
    });
    expect(params).not.toHaveProperty("bonus_id");
  });

  it("includes bonus_id when provided", () => {
    trackStoreClick({
      albumId: "42",
      storeKey: "animate",
      storeStatus: "sold_out",
      surface: "album_page",
      isAffiliate: false,
      bonusId: "bns-1",
    });
    expect(gtag.mock.calls[0][2]).toMatchObject({ bonus_id: "bns-1" });
  });
});

describe("trackBdSectionView", () => {
  it("emits bd_section_view with the hyphenated state + bonus count", () => {
    trackBdSectionView({
      eventId: "123",
      albumId: "42",
      bdState: "bd-preorder-open",
      topBonusCount: 3,
    });
    expect(gtag).toHaveBeenCalledOnce();
    expect(gtag).toHaveBeenCalledWith("event", "bd_section_view", {
      event_id: "123",
      album_id: "42",
      bd_state: "bd-preorder-open",
      top_bonus_count: 3,
    });
  });
});

describe("no gtag present", () => {
  it("is a no-op (never throws) when window.gtag is undefined", () => {
    delete (window as unknown as { gtag?: unknown }).gtag;
    expect(() =>
      trackStoreClick({
        albumId: "1",
        storeKey: "other",
        storeStatus: "unknown",
        surface: "album_page",
        isAffiliate: false,
      }),
    ).not.toThrow();
  });
});

describe("BD_STATE_GA_VALUE", () => {
  it("maps the three rendering states to hyphenated GA values", () => {
    expect(BD_STATE_GA_VALUE).toEqual({
      bd_announced: "bd-announce",
      bd_preorder: "bd-preorder-open",
      bd_released: "bd-released",
    });
  });
});
