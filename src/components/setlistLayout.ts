/*
 * Single source of truth for the desktop setlist grid spec. Both
 * `<LiveSetlist>`'s `<SetlistColumnHeader>` (inline-style header
 * row) and `<SetlistRow>` (Tailwind arbitrary-value grid class)
 * need the same column template, otherwise headers drift from
 * data columns. Tailwind compiles `lg:grid-cols-[…]` from string
 * literals at build time, but it does support `lg:grid-cols-
 * [var(--…)]` arbitrary-value variants — so we hand the same
 * constant down to the row via a CSS variable and to the header
 * via inline style.
 *
 * `SETLIST_DESKTOP_GRID_GAP` mirrors `lg:gap-3` (= 12px). Update
 * both together.
 */

export const SETLIST_DESKTOP_GRID_COLS = "36px 1fr 180px 260px";
export const SETLIST_DESKTOP_GRID_GAP = 12;
