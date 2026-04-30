/*
 * Layout constants for the row inside `<PerformanceGroup>` and the
 * column-header strips that consumer pages render above it.
 *
 * Lives in a server-safe module (no `"use client"`) so server
 * components like the song detail page can import these primitives
 * directly without crossing the RSC client-boundary. When constants
 * sit alongside a `"use client"` component, certain bundlers can
 * resolve the value to `undefined` at SSR time — producing CSS like
 * `padding: 8px 16px 8px undefinedpx` which the browser silently
 * rejects, dropping padding to 0 and breaking column alignment.
 *
 * Keep the values here, not in `PerformanceGroup.tsx`. The component
 * file re-exports for backward compatibility but the source of truth
 * is this module.
 */

/**
 * Desktop grid template for an event row inside `<PerformanceGroup>`.
 * All five tracks are fixed (or `minmax(0, 1fr)` for name) so a
 * consumer's column-header strip rendered above the groups —
 * a separate grid with the same template — has identically-sized
 * column tracks.
 *
 * The trailing 100px holds per-row chips (artist: `🎵 N`; member:
 * 전출연 / unit-name; song: encore + #position). Was 180px and gave
 * too much air on rows with short content while squeezing the name
 * column — operator feedback (2026-04-29: "songs column has too much
 * space and the event column needs more space"). 100px fits the
 * widest realistic chip ("Mira-Cra Park!" pill ~85px) plus padding.
 *
 * Mobile rows use `auto auto` for trailing+chevron via a Tailwind
 * responsive class on the row — content-sized chips, narrower
 * overall, which the operator already preferred ("mobile view column
 * size looks good").
 *
 * The trailing 28px is the chevron column. Matches the event list
 * row template (`EVENT_TABLE_COLUMNS` ends with `28px`) so the two
 * surfaces — both showing "list of events grouped by series" — read
 * the same density at the right edge.
 */
export const PERFORMANCE_ROW_GRID =
  "60px 100px minmax(0, 1fr) 100px 28px";

/**
 * Left padding of every event row, in pixels. The column-header strip
 * a consumer page renders above its `<PerformanceGroup>` list MUST
 * use the same indent so the header column tracks line up with the
 * row column tracks.
 */
export const PERFORMANCE_ROW_INDENT_PX = 36;

/**
 * Grid column-gap of every event row, in pixels. Same alignment
 * concern as `PERFORMANCE_ROW_INDENT_PX`: a consumer's column-header
 * strip MUST use this exact value or the labels drift relative to
 * row content.
 */
export const PERFORMANCE_ROW_GAP_PX = 10;

/**
 * Internal `padding-left` of the `<StatusBadge>` pill (matches the
 * `padding: 2px 8px` declaration on the badge component). The
 * column-header strip applies this as `paddingLeft` on the STATUS
 * label so the header TEXT aligns with the badge TEXT (rather than
 * with the badge's BG left edge, which is 8px earlier). Without
 * this, eyes read the 8px text-to-text gap as "badge not aligned
 * with column title" — operator feedback 2026-04-29.
 */
export const STATUS_BADGE_INDENT_PX = 8;

/**
 * Indices into the column-header label array consumers map over.
 * Track 0 = STATUS (badge), track 3 = trailing (chips, right-aligned).
 * Pulled out to constants so the alignment rules — `paddingLeft` on
 * STATUS to match badge indent, `textAlign: right` on trailing to
 * anchor with row chips — don't repeat magic indices across artist /
 * member / song history-tab implementations.
 */
export const STATUS_COL_IDX = 0;
export const TRAILING_COL_IDX = 3;
