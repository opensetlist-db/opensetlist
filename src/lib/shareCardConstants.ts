/**
 * Shared layout primitives for the share-card capture pipeline.
 *
 * Lives in `src/lib/` (no `"use client"` directive) so server
 * components and other client modules can safely import the same
 * numeric constants. Exporting these directly from
 * `<ShareCardPreview>` would be a layering trap — that file is
 * `"use client"`, and a server component importing a plain value
 * from a client module sees `undefined` at SSR time (the project's
 * `feedback_rsc_boundary_constants` memory documents this exact
 * pitfall from a prior incident). Keeping the primitives in a
 * neutral module lets either side import them without an RSC
 * boundary hazard.
 *
 * Both numbers cooperate to define the off-screen capture surface
 * in `<ShareCardModal>`: the clone wrapper sits at
 * `left: OFF_SCREEN_LEFT_PX` with `width: CARD_CAPTURE_WIDTH_PX`,
 * matching the card element's own `width`. Treat them as a pair —
 * if the card width ever changes (e.g., bumping to 720px for better
 * long-title legibility), both consumers move together.
 */

/**
 * Fixed pixel width of the captured share card. Drives both the card
 * element's own `style.width` (in `<ShareCardPreview>`) and the
 * off-screen capture container in `<ShareCardModal>` (the container
 * must match this width so html2canvas reads a consistent layout box
 * across viewports).
 *
 * The number also encodes the column-geometry rationale documented
 * on `TWO_COLUMN_MIN_SONG_COUNT` in `<ShareCardPreview>` — column
 * widths are derived from this number, so a change here cascades
 * into the column-fit math too.
 */
export const CARD_CAPTURE_WIDTH_PX = 600;

/**
 * Horizontal `left` offset (in px) used by `<ShareCardModal>` to push
 * its off-screen capture clone safely outside any plausible viewport.
 * Negative — the value is applied as `style.left`, so it shifts the
 * wrapper that many pixels to the left of the viewport origin.
 *
 * 10000 is a comfortable safety margin past any realistic monitor
 * width (8K = 7680px, ultrawide multi-display rigs ~10000–12000px
 * for the rightmost edge from `x: 0`). Bumping to a larger absolute
 * value is fine if a wider display ever creeps in.
 */
export const OFF_SCREEN_LEFT_PX = -10000;
