import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  trackAlbumView,
  trackAlbumClick,
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

describe("trackAlbumClick", () => {
  it("emits the canonical slug and optional event ID, limiting the slug to 100 characters", () => {
    trackAlbumClick({ albumId: "42", albumSlug: "a".repeat(101), surface: "event_bd_title", eventId: "7" });
    expect(gtag).toHaveBeenCalledWith("event", "album_click", {
      album_id: "42", album_slug: "a".repeat(100), surface: "event_bd_title", event_id: "7",
      page_location: window.location.origin + window.location.pathname, page_referrer: "",
    });
    trackAlbumClick({ albumId: "42", albumSlug: "", surface: "album_list" });
    expect(gtag).toHaveBeenLastCalledWith("event", "album_click", { album_id: "42", surface: "album_list", page_location: window.location.origin + window.location.pathname, page_referrer: "" });
  });
});

describe("search album clicks", () => {
  it("removes search terms from automatic page fields", () => {
    window.history.replaceState(null, "", "/ko/search?q=private#term");
    document.title = "private search";
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://example.com/search?q=private#term");
    trackAlbumClick({ albumId: "42", albumSlug: "dream", surface: "search_results" });
    expect(gtag).toHaveBeenCalledWith("event", "album_click", {
      album_id: "42", album_slug: "dream", surface: "search_results",
      page_location: window.location.origin + "/ko/search", page_referrer: "https://example.com/search", page_title: "Search",
    });
    window.history.replaceState(null, "", "/");
    document.title = "";
  });
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
      purchaseOption: "with_bonus",
      albumSlug: "a".repeat(101),
    });
    expect(gtag.mock.calls[0][2]).toMatchObject({ bonus_id: "bns-1", album_slug: "a".repeat(100), purchase_option: "with_bonus" });
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
