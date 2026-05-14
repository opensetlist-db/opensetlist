export const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ?? "https://opensetlist.vercel.app";

/**
 * Display brand name. Same string in every locale (per
 * `messages/*.json` `Header.brandName: "OpenSetlist"`) — kept as a
 * source constant rather than an i18n key so callers like the
 * Share Card footer (rendered into a captured PNG, where i18n
 * keys add no value) can reference it without a useTranslations
 * hook.
 */
export const BRAND_NAME = "OpenSetlist";

/**
 * Display URL (no scheme) — what the Share Card footer shows
 * alongside the brand. Intentionally a fixed literal (not derived
 * from BASE_URL) so preview/local screenshots still read as the
 * production brand instead of leaking a vercel.app URL into shared
 * images. The actual share-link URL still uses BASE_URL.
 */
export const BRAND_URL_DISPLAY = "opensetlist.com";

export const CONTACT_EMAIL = "help@opensetlist.com";

export const REPORT_HIDE_THRESHOLD = 3;
export const IMPRESSION_EDIT_COOLDOWN_MS = 60_000;
export const IMPRESSION_MAX_CHARS = 200;
export const IMPRESSION_LOCALES = ["ko", "ja", "en"] as const;
export type ImpressionLocale = (typeof IMPRESSION_LOCALES)[number];

// Page size for the event impressions list — used by both the SSR
// fetch in the event detail page and the `/api/impressions` GET
// route (latest page + cursor-paginated "see older" requests). Single
// source of truth so the SSR seed and polling responses can never
// drift out of sync; changing this value adjusts both surfaces in
// lockstep.
export const IMPRESSION_PAGE_SIZE = 50;

// Conflict-handling: number of distinct `SetlistItemConfirm` rows
// required to flip a rumoured row in a conflict group to `confirmed`
// and auto-hide its siblings.
//
// Default 3 matches `wiki/crowdsourcing.md` §"rumoured → confirmed
// transition" Rule A — "≥ N general-tier confirmations (default
// CONFIRMATION_THRESHOLD = 3, env-tunable)". For Phase 1C only Rule A
// applies; B/C/D depend on the tier system that ships in Phase 2.
//
// Env-tunability deferred — operationally we expect to ship N=3 and
// only revisit if real engagement data shows the threshold is too
// high (slow resolution) or too low (abuse-vulnerable). Tuning then
// is a one-line PR rather than env-var infra.
//
// Single-row 1-minute auto-promote (`src/lib/confirmStatus.ts`) is
// intentionally not gated by this threshold — that's a render-time
// concept for non-conflict rows and never mutates DB.
export const CONFLICT_CONFIRMATION_THRESHOLD = 3;
