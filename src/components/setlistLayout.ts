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
 *
 * Reactions column width history:
 *  - 260px (original mockup) overflowed on Windows / Segoe UI
 *    Emoji where the emoji glyphs render wider than Apple Color
 *    Emoji on macOS. The per-button intrinsic width (border +
 *    padding + emoji + gap + count slot) ends up ~63–65px on
 *    Windows; 4 buttons × 65px + 3 × 6px gaps = 278px, which
 *    forces the last button to wrap onto a second line.
 *  - 280px adds an ~10px buffer over the worst-case Windows
 *    rendering with no visible drawback (the title `1fr`
 *    absorbs the loss; song titles rarely consume even half of
 *    the available track at desktop widths).
 */

export const SETLIST_DESKTOP_GRID_COLS = "36px 1fr 180px 280px";
export const SETLIST_DESKTOP_GRID_GAP = 12;
