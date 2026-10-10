// Markers the n14 run #2 k6 model (`viewers.js`) leaves on the rows and
// reactions it creates, shared with the Node clean-up check
// (`viewers-check.mjs`) so the two can never drift apart: the check finds
// leftovers by exactly these strings, and a rename in one place only
// would silently turn the check into a no-op. Plain ESM with no runtime
// imports so both k6 and Node can load it.
export const NOTE = "n14-run2-load-test";
export const ANON_PREFIX = "n14run2-";
