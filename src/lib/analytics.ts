type GtagParams = Record<string, string | number | boolean>;

declare global {
  interface Window {
    gtag?: (command: "event", eventName: string, params?: GtagParams) => void;
  }
}

const FIRST_VISIT_KEY = "opensetlist_first_visit";

export function trackEvent(eventName: string, params?: GtagParams): void {
  if (typeof window === "undefined") return;
  if (typeof window.gtag !== "function") return;
  try {
    window.gtag("event", eventName, params);
  } catch {
    // Analytics must never surface an error to the user.
  }
}

// ── Album / BD funnel events (b10c) ───────────────────────────────
//
// Typed wrappers over the generic `trackEvent` primitive — they
// centralize the GA4 event names + param keys across album click and
// view surfaces. Callers pass already-stringified ids: GA4 params
// are string/number/boolean only (`GtagParams`), and a raw BigInt would
// throw in `gtag()` / `JSON`, so ids are `String(...)`-ed at the fire
// site before they reach here.

// Where a store_click originated. Only `album_page` is wired at b10c
// (the album-page purchase-card buy button is the sole external store
// link in the album surfaces). `event_bd_section` / `song_page` are
// kept for forward use — b07's BD bonus cards are non-links and b08's
// song-page cards link internally today, but the discriminator is here
// so adding either later doesn't reshape the event.
export type StoreClickSurface = "album_page" | "event_bd_section" | "song_page";
export type StorePurchaseOption = "with_bonus" | "without_bonus";

export type AlbumClickSurface =
  | "album_list"
  | "artist_albums"
  | "song_albums"
  | "series_bd"
  | "event_bd_title"
  | "event_bd_purchase"
  | "home_bd_purchase"
  | "album_purchase_tab"
  | "search_results";

export function trackAlbumClick(params: {
  albumId: string;
  albumSlug: string;
  surface: AlbumClickSurface;
  eventId?: string;
}): void {
  if (typeof window === "undefined") return;
  trackEvent("album_click", {
    album_id: params.albumId,
    // GA4's standard event parameter value limit is 100 characters.
    ...(params.albumSlug && { album_slug: params.albumSlug.slice(0, 100) }),
    surface: params.surface,
    ...(params.eventId && { event_id: params.eventId }),
    // GA defaults to the document URL and title, both of which can contain the search query.
    page_location: window.location.origin + window.location.pathname,
    page_referrer: document.referrer.split(/[?#]/, 1)[0],
    ...(params.surface === "search_results" && { page_title: "Search" }),
  });
}

export function trackAlbumView(params: {
  albumId: string;
  albumType: string;
  artistId: string;
  locale: string;
  hasAmazonListing: boolean;
}): void {
  trackEvent("album_view", {
    album_id: params.albumId,
    album_type: params.albumType,
    artist_id: params.artistId,
    locale: params.locale,
    has_amazon_listing: params.hasAmazonListing,
  });
}

export function trackStoreClick(params: {
  albumId: string;
  albumSlug?: string;
  purchaseOption?: StorePurchaseOption;
  storeKey: string;
  storeStatus: string;
  surface: StoreClickSurface;
  isAffiliate: boolean;
  bonusId?: string;
}): void {
  // `GtagParams` forbids `undefined`, so the optional `bonus_id` key is
  // added only when present rather than passed as `undefined`.
  const gaParams: GtagParams = {
    album_id: params.albumId,
    ...(params.albumSlug && { album_slug: params.albumSlug.slice(0, 100) }),
    ...(params.purchaseOption && { purchase_option: params.purchaseOption }),
    store_key: params.storeKey,
    store_status: params.storeStatus,
    surface: params.surface,
    is_affiliate: params.isAffiliate,
  };
  if (params.bonusId) gaParams.bonus_id = params.bonusId;
  trackEvent("store_click", gaParams);
}

export function trackBdSectionView(params: {
  eventId: string;
  albumId: string;
  bdState: string;
  topBonusCount: number;
}): void {
  trackEvent("bd_section_view", {
    event_id: params.eventId,
    album_id: params.albumId,
    bd_state: params.bdState,
    top_bonus_count: params.topBonusCount,
  });
}

export function recordFirstVisit(): void {
  if (typeof window === "undefined") return;
  try {
    if (!localStorage.getItem(FIRST_VISIT_KEY)) {
      localStorage.setItem(FIRST_VISIT_KEY, new Date().toISOString());
    }
  } catch {
    // localStorage may be disabled (private mode, quota, etc.)
  }
}

export function getFirstVisitDate(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(FIRST_VISIT_KEY);
  } catch {
    return null;
  }
}

export { FIRST_VISIT_KEY };
