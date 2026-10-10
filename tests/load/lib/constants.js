// Markers the n14 run #2 k6 model (`viewers.js`) leaves on the rows and
// reactions it creates, shared with the Node clean-up check
// (`viewers-check.mjs`) so the two can never drift apart: the check finds
// leftovers by exactly these strings, and a rename in one place only
// would silently turn the check into a no-op. Plain ESM with no runtime
// imports so both k6 and Node can load it.
export const NOTE = "n14-run2-load-test";
export const ANON_PREFIX = "n14run2-";

// Admin session cookie name — mirrors `COOKIE_NAME` in
// `src/lib/admin-session.ts`. k6 cannot import the app's TypeScript, so
// the test layer keeps one copy here instead of one per script.
export const ADMIN_COOKIE_NAME = "admin_session";

// Reaction types accepted by `POST /api/reactions` (`VALID_TYPES` in
// `src/app/api/reactions/route.ts`). Same reason: one copy in the test
// layer; if the route changes, change it here.
export const REACTION_TYPES = ["waiting", "best", "surprise", "moved"];
