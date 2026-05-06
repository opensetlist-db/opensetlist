"use client";

import type { ReactNode } from "react";
import { colors } from "@/styles/tokens";

export type SetlistTab = "actual" | "predicted";

interface Props {
  hasPredictions: boolean;
  hasActual: boolean;
  activeTab: SetlistTab;
  onTabChange: (tab: SetlistTab) => void;
  /**
   * i18n-resolved tab labels passed by the parent so the tab strip
   * stays presentation-only (mirrors the `<SongSearch>` `texts`
   * prop convention).
   */
  labels: {
    actual: string;
    predicted: string;
  };
  /**
   * Optional badge slot rendered after the Predicted tab label —
   * Stage C will populate this with the prediction hit-rate
   * indicator (`3/10 🎯` per the mockup). Stage B leaves it
   * unused; the slot exists so Stage C doesn't have to touch this
   * file.
   */
  predictedBadge?: ReactNode;
}

/**
 * Tab strip for `<SetlistSection>` per the visibility matrix in
 * `wiki/output/task-week2-setlistsection-tab-refactor.md`:
 *
 *   - !hasPredictions                → null (cases 3+4)
 *   - hasPredictions && !hasActual   → Predicted-only (case 1)
 *   - hasPredictions &&  hasActual   → Both tabs, default Actual (case 2)
 *
 * The "no tabs" return is the load-bearing constraint: events
 * without predictions must render byte-equivalent to the
 * pre-refactor page, so the parent can render the actual setlist
 * directly without any tab chrome.
 */
export function SetlistTabs({
  hasPredictions,
  hasActual,
  activeTab,
  onTabChange,
  labels,
  predictedBadge,
}: Props) {
  // Cases 3 + 4 — no predictions, no tabs. Phase 1A byte-equiv path.
  if (!hasPredictions) return null;

  const showActualTab = hasActual;

  return (
    <div
      role="tablist"
      aria-label={labels.actual + " / " + labels.predicted}
      className="flex"
      style={{ borderBottom: `1px solid ${colors.borderLight}` }}
    >
      {showActualTab && (
        <TabButton
          active={activeTab === "actual"}
          onClick={() => onTabChange("actual")}
          label={labels.actual}
        />
      )}
      <TabButton
        active={activeTab === "predicted"}
        onClick={() => onTabChange("predicted")}
        label={labels.predicted}
        badge={predictedBadge}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      // flex-1 + center alignment matches the mockup's tab strip
      // shape — each tab fills the available width equally and the
      // active tab gets a 2px primary-color underline. Inactive
      // tabs render in `textMuted` for visual de-emphasis.
      className="flex-1 px-3 py-2.5 text-center text-xs font-medium transition-colors lg:py-3 lg:text-sm"
      style={{
        color: active ? colors.primary : colors.textMuted,
        // Negative margin so the active tab's underline overlaps
        // the tablist's bottom border, replacing it cleanly.
        borderBottom: active
          ? `2px solid ${colors.primary}`
          : "2px solid transparent",
        marginBottom: -1,
      }}
    >
      {label}
      {badge && <span className="ml-1.5">{badge}</span>}
    </button>
  );
}
