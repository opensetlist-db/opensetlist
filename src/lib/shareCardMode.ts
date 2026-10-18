import type { ShareCardMode } from "@/components/ShareCardPreview";
import type { ResolvedEventStatus } from "@/lib/eventStatus";

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
