"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { colors } from "@/styles/tokens";

export type SetlistTab = "actual" | "predicted";

interface Props {
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
 * Predicted / Actual tab strip for `<SetlistSection>`. The parent
 * mounts it only once the viewer has a prediction (or has started
 * one); without it the card shows the actual setlist with no tab
 * chrome. Both tabs are always present — before the show the Actual
 * tab holds the "filled in live from …" note — so switching never
 * makes a tab appear or vanish.
 */
export function SetlistTabs({
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
  const tabButtonRefs = useRef<Partial<Record<SetlistTab, HTMLButtonElement>>>(
    {},
  );

  // Render order AND keyboard-nav cycling order: the viewer's own
  // prediction first, then the actual setlist.
  const visibleTabs: SetlistTab[] = ["predicted", "actual"];
  const effectiveActiveTab = activeTab;

  // WAI-ARIA tabs keyboard pattern: ArrowLeft/Right cycle (with
  // wrap-around), Home/End jump to first/last. Active tab gets
  // tabIndex=0 (in tab order); inactive tabs get tabIndex=-1
  // (skipped by Tab key but reachable via arrow keys when the
  // tablist itself is focused).
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let nextTab: SetlistTab | null = null;
    if (e.key === "ArrowLeft") {
      const idx = visibleTabs.indexOf(effectiveActiveTab);
      nextTab = visibleTabs[(idx - 1 + visibleTabs.length) % visibleTabs.length];
    } else if (e.key === "ArrowRight") {
      const idx = visibleTabs.indexOf(effectiveActiveTab);
      nextTab = visibleTabs[(idx + 1) % visibleTabs.length];
    } else if (e.key === "Home") {
      nextTab = visibleTabs[0];
    } else if (e.key === "End") {
      nextTab = visibleTabs[visibleTabs.length - 1];
    }
    if (nextTab !== null && nextTab !== effectiveActiveTab) {
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
      // 18-v3 `.subnav`: wrapping chip row above the list, inside the
      // setlist card's padding (the card no longer has a header rule).
      className="mb-[18px] flex flex-wrap gap-2"
      onKeyDown={handleKeyDown}
    >
      <TabButton
        id={tabIds.predicted}
        panelId={panelIds.predicted}
        active={effectiveActiveTab === "predicted"}
        onClick={() => onTabChange("predicted")}
        label={labels.predicted}
        badge={predictedBadge}
        buttonRef={(el) => {
          if (el) tabButtonRefs.current.predicted = el;
          else delete tabButtonRefs.current.predicted;
        }}
      />
      <TabButton
        id={tabIds.actual}
        panelId={panelIds.actual}
        active={effectiveActiveTab === "actual"}
        onClick={() => onTabChange("actual")}
        label={labels.actual}
        buttonRef={(el) => {
          if (el) tabButtonRefs.current.actual = el;
          else delete tabButtonRefs.current.actual;
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
      // 18-v3 `.subnav button`: 44px chips; the selected one is solid
      // violet with white text (the setlist card's lavender family),
      // the other a pale chip with a 3:1 control border. Selection is
      // also carried by `aria-selected`, never by colour alone.
      className="min-h-[44px] rounded-lg border px-3.5 py-[9px] text-[13px] font-medium transition-colors"
      style={{
        color: active ? colors.bgCard : colors.textPrimary,
        background: active ? colors.setlistTabActive : colors.setlistTabIdleBg,
        borderColor: active ? colors.setlistTabActive : colors.setlistTabIdleBorder,
      }}
    >
      {label}
      {badge && <span className="ml-1.5">{badge}</span>}
    </button>
  );
}
