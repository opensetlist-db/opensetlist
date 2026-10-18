/**
 * Fan board client knobs (n15). Plain values live here, not in the
 * `"use client"` block module: a server component importing a plain
 * value from a client module can resolve it to `undefined` at SSR.
 */

/** The board block gives up on its read after this long and collapses
 *  to one line — the rest of the page is never held up by the board. */
export const BOARD_TIMEOUT_MS = 6000;

/** Expected songs per (event, anon, group) — enforced by the pick
 *  write routes, mirrored by the block's "N/3" counter. Same number as
 *  the operator's starter picks and the wish cap: one mental model. */
export const BOARD_PICKS_PER_GROUP = 3;
