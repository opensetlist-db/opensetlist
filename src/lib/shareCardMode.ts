import type { ResolvedEventStatus } from "@/lib/eventStatus";

/**
 * Render mode for the share card. Drives both `<ShareCardPreview>`'s
 * layout and `<ShareCardButton>`'s label / `<ShareCardModal>`'s share
 * text. The mode is derived from `status + actualSongs` at the
 * button level (see `<ShareCardButton>`):
 *
 *   - `"prediction"` — pre-show (`upcoming`) OR ongoing with no actual
 *     songs entered yet. Shows the viewer's predicted setlist in their
 *     chosen rank order. No score banner (there's nothing to compare
 *     against). Pre-show share is the viral entry point: fans share
 *     their predictions BEFORE the show, friends see them, friends
 *     show up. v0.11.1-and-earlier only enabled share post-show, which
 *     missed this whole funnel.
 *   - `"live"` — ongoing AND actualSongs has at least one row.
 *     Identical layout to `"final"` (score banner + actual setlist
 *     with hit highlighting) but with a red `LIVE` pill in the top-
 *     right corner signaling the result is partial / mid-flight.
 *   - `"final"` — completed. Current post-show layout — final score,
 *     full actual setlist.
 */
export type ShareCardMode = "prediction" | "live" | "final";

/**
 * Derive the share-card `mode` from event lifecycle + actual-setlist
 * presence. See `<ShareCardPreview>` for the per-mode rendering rules.
 *
 *   - `upcoming` (pre-show)                  → `prediction`
 *   - `ongoing` with no actuals yet          → `prediction`
 *     (operator hasn't entered any songs; treating as pre-show keeps
 *     the card useful instead of rendering an empty result body)
 *   - `ongoing` with at least one actual     → `live`
 *   - `completed`                            → `final`
 *   - `cancelled` (rare)                     → `final` if any actuals,
 *                                              else `prediction`
 *
 * Pure function so the test suite can pin every transition without
 * mounting the component. A plain module: the "use client" component that uses it may export
 * only components and hooks (`local/use-client-exports`).
 */
export function deriveShareCardMode(
  status: ResolvedEventStatus,
  hasActuals: boolean,
): ShareCardMode {
  if (status === "completed") return "final";
  if (status === "cancelled") return hasActuals ? "final" : "prediction";
  if (status === "ongoing" && hasActuals) return "live";
  return "prediction";
}
