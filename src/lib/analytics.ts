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
// centralize the GA4 event names + param keys so the Album-surface
// funnel (album_view → store_click → revenue) can't drift across the
// several fire sites. Callers pass already-stringified ids: GA4 params
// are string/number/boolean only (`GtagParams`), and a raw BigInt would
// throw in `gtag()` / `JSON`, so ids are `String(...)`-ed at the fire
// site before they reach here.

// Where a store_click originated. Only `album_page` is wired at b10c
// (the album-page ListingCard buy button is the sole external store
// link in the album surfaces). `event_bd_section` / `song_page` are
// kept for forward use — b07's BD bonus cards are non-links and b08's
// song-page cards link internally today, but the discriminator is here
// so adding either later doesn't reshape the event.
export type StoreClickSurface = "album_page" | "event_bd_section" | "song_page";

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
    store_key: params.storeKey,
    store_status: params.storeStatus,
    surface: params.surface,
    is_affiliate: params.isAffiliate,
  };
  if (params.bonusId) gaParams.bonus_id = params.bonusId;
  trackEvent("store_click", gaParams);
}

// b16 hook contract (no code here yet): when b16's affiliate-tag wrapper
// rewrites a store URL, the calling TrackedStoreLink should pass
// `isAffiliate: true` and b16 will extend this event with
// `affiliate_tag_present: true` + `attribution_window_days: number`
// (89 for Amazon JP; network-specific elsewhere). There is intentionally
// NO separate `affiliate_click` event — the funnel stays one stream so
// the ~10/15 gate can decompose it without joining across event names.

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
