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
 */
export const PERFORMANCE_ROW_GRID =
  "60px 100px minmax(0, 1fr) 180px 16px";

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
