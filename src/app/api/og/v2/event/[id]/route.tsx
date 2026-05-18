// Mirror of `/api/og/event/[id]` at a new path so X (Twitter) can re-
// crawl with a clean cache slate. Background: between 2026-05-02 and
// 2026-05-18 the site's `robots.txt` carried `Disallow: /api/`. X is
// documented to honor robots.txt, so every Twitterbot fetch attempt at
// the original `/api/og/event/[id]` URL was refused during that
// window. v0.13.11 + v0.13.12 dropped the disallow, but Card Validator
// reads clean while fresh-URL tweets still render the small placeholder
// — strongly suggesting X is holding a negative-cache entry keyed on
// the og:image URL pattern from the blocked era (its documented 7-day
// cache TTL would naturally expire ~2026-05-25, just past the Kobe
// 5/23 share window).
//
// Re-exporting GET from the canonical handler at `/api/og/event/[id]`
// keeps the rendered image byte-identical; only the URL path X sees
// changes. The event page's `generateMetadata` now points at this v2
// path so any tweet posted on or after this PR deploys forces X to
// treat the og:image URL as new (no negative-cache entry possible).
//
// Test outcomes:
//   - If fresh-URL tweets render the large card → the negative-cache
//     hypothesis is confirmed; consider migrating artist + song
//     surfaces to /v2 paths as well, then deprecate the originals
//     after the 7-day TTL.
//   - If still small-card → the hypothesis is dead; remaining cause
//     is domain-level reputation, account-level throttle, or X
//     platform-wide unreliability (none of which are addressable
//     from our codebase). Roll back this PR and pursue Option 3
//     (R2 static prerender) per `wiki/code-health.md` F15-X.
//
// `next.config.ts`'s `outputFileTracingIncludes` keys on `/api/og/**`
// so this v2 route inherits the same font + @vercel/og asset tracing
// as the canonical one; no config change needed.
export { GET } from "../../../event/[id]/route";
