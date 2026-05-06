"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
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
   * prop convention). `tablistAriaLabel` describes the tablist as
   * a whole for screen readers (e.g. "Setlist views").
   */
  labels: {
    actual: string;
    predicted: string;
    tablistAriaLabel: string;
  };
  /**
   * DOM ids for tab buttons + their corresponding panels. Caller
   * (typically `<SetlistSection>`) computes them once via `useId()`
   * and uses the same panel-ids on the `<div role="tabpanel">`
   * wrapper around the body. WAI-ARIA tabs pattern requires
   * `aria-controls` on each tab pointing at the panel id and
   * `aria-labelledby` on each panel pointing back at the tab id.
   */
  tabIds: { actual: string; predicted: string };
  panelIds: { actual: string; predicted: string };
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
  tabIds,
  panelIds,
  predictedBadge,
}: Props) {
  // Per-tab button refs for the WAI-ARIA roving-focus contract.
  // After ArrowLeft/Right/Home/End advances `activeTab`, we MUST
  // programmatically focus the new tab button — `tabIndex` change
  // alone does NOT move browser focus (changing tabIndex=-1 → 0
  // makes the button reachable via Tab, but the previously-focused
  // button keeps focus). Without the explicit `.focus()`, the user
  // who just pressed ArrowRight stays focused on the now-inactive
  // tab (tabIndex=-1), which breaks Tab navigation entirely.
  // useRef runs UNCONDITIONALLY (Rules of Hooks — must run before
  // any early return).
  const tabButtonRefs = useRef<Partial<Record<SetlistTab, HTMLButtonElement>>>(
    {},
  );

  // Cases 3 + 4 — no predictions, no tabs. Phase 1A byte-equiv path.
  if (!hasPredictions) return null;

  const showActualTab = hasActual;
  // Ordered list of visible tabs — drives both render order AND
  // the keyboard-nav cycling order. Without `showActualTab` (case 1
  // pre-show), the array shrinks to just `["predicted"]` so arrow
  // keys are no-ops.
  const visibleTabs: SetlistTab[] = showActualTab
    ? ["actual", "predicted"]
    : ["predicted"];

  // WAI-ARIA tabs keyboard pattern: ArrowLeft/Right cycle (with
  // wrap-around), Home/End jump to first/last. Active tab gets
  // tabIndex=0 (in tab order); inactive tabs get tabIndex=-1
  // (skipped by Tab key but reachable via arrow keys when the
  // tablist itself is focused).
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (visibleTabs.length < 2) return;
    let nextTab: SetlistTab | null = null;
    if (e.key === "ArrowLeft") {
      const idx = visibleTabs.indexOf(activeTab);
      nextTab = visibleTabs[(idx - 1 + visibleTabs.length) % visibleTabs.length];
    } else if (e.key === "ArrowRight") {
      const idx = visibleTabs.indexOf(activeTab);
      nextTab = visibleTabs[(idx + 1) % visibleTabs.length];
    } else if (e.key === "Home") {
      nextTab = visibleTabs[0];
    } else if (e.key === "End") {
      nextTab = visibleTabs[visibleTabs.length - 1];
    }
    if (nextTab !== null && nextTab !== activeTab) {
      e.preventDefault();
      onTabChange(nextTab);
      // Move focus to the new active tab so subsequent Tab keys
      // exit the tablist (rather than staying on the now-inactive
      // tab with tabIndex=-1, which would trap the user). Use
      // requestAnimationFrame so the focus call lands AFTER React
      // has re-rendered with the new `activeTab` + roving tabindex
      // values; calling focus() on the same tick races the render
      // and can produce inconsistent behavior in test runners.
      const target = tabButtonRefs.current[nextTab];
      if (target) {
        requestAnimationFrame(() => target.focus());
      }
    }
  };

  return (
    <div
      role="tablist"
      aria-label={labels.tablistAriaLabel}
      className="flex"
      style={{ borderBottom: `1px solid ${colors.borderLight}` }}
      onKeyDown={handleKeyDown}
    >
      {showActualTab && (
        <TabButton
          id={tabIds.actual}
          panelId={panelIds.actual}
          active={activeTab === "actual"}
          onClick={() => onTabChange("actual")}
          label={labels.actual}
          buttonRef={(el) => {
            if (el) tabButtonRefs.current.actual = el;
            else delete tabButtonRefs.current.actual;
          }}
        />
      )}
      <TabButton
        id={tabIds.predicted}
        panelId={panelIds.predicted}
        active={activeTab === "predicted"}
        onClick={() => onTabChange("predicted")}
        label={labels.predicted}
        badge={predictedBadge}
        buttonRef={(el) => {
          if (el) tabButtonRefs.current.predicted = el;
          else delete tabButtonRefs.current.predicted;
        }}
      />
    </div>
  );
}

function TabButton({
  id,
  panelId,
  active,
  onClick,
  label,
  badge,
  buttonRef,
}: {
  id: string;
  panelId: string;
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: ReactNode;
  /**
   * Callback ref so the parent can collect each tab button's DOM
   * node and call `.focus()` after keyboard activation. Caller
   * typically populates a `useRef<Partial<Record<SetlistTab,
   * HTMLButtonElement>>>` keyed by tab.
   */
  buttonRef: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      type="button"
      id={id}
      ref={buttonRef}
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      // Roving tabindex per WAI-ARIA: only the active tab is in
      // the keyboard tab order; inactive tabs are reached via
      // ArrowLeft/Right while the tablist is focused.
      tabIndex={active ? 0 : -1}
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
