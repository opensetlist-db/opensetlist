"use client";

import { colors } from "@/styles/tokens";

export type RowState = "confirmed" | "rumoured" | "my-confirmed";

interface Props {
  state: RowState;
  position: number;
  /**
   * Tap handler for the rumoured / my-confirmed states. Stage B
   * passes a no-op so the buttons render and are tappable but
   * don't do anything yet — Stage C wires localStorage write +
   * (later) DB write under `LAUNCH_FLAGS.confirmDbEnabled`.
   * Optional because the `confirmed` state never renders a button.
   */
  onTap?: () => void;
  /**
   * aria-label for the interactive states. Caller passes the i18n
   * resolution since this component is rendered both inside admin
   * (Korean-only per CLAUDE.md exemption) and public surfaces.
   */
  rumouredLabel?: string;
  myConfirmedLabel?: string;
}

/**
 * Three-state position cell for `<SetlistRow>` — Stage B foundation
 * for the Phase 1C Confirm UI.
 *
 *   - "confirmed": plain number, muted color, no border. Visual
 *     parity with the pre-refactor `<span>` it replaces — the
 *     load-bearing constraint of this refactor is that confirmed
 *     rows render byte-equivalent.
 *   - "rumoured": 22×22 dotted-border circle button, `?` glyph.
 *     Stage B taps no-op; Stage C wires confirm-write.
 *   - "my-confirmed": 22×22 solid sky-blue circle button, `✓`
 *     glyph. Reachable in Stage B only via DevTools-set
 *     localStorage; Stage C ships the read derivation that flips
 *     a rumoured row into this state.
 *
 * Mockup source: `raw/mockups/mockup-setlist.jsx` `ConfirmButton`.
 */
export function NumberSlot({
  state,
  position,
  onTap,
  rumouredLabel,
  myConfirmedLabel,
}: Props) {
  if (state === "confirmed") {
    // Match the SetlistRow.tsx pre-refactor span styling so callers
    // that don't pass `rowState` see byte-identical output. The
    // existing `mt-0.5 pt-px text-right text-sm font-mono lg:w-9`
    // classes live on this component now instead of the row.
    return (
      <span
        className="mt-0.5 pt-px text-right text-sm font-mono lg:w-9"
        style={{ color: colors.textMuted }}
      >
        {position}
      </span>
    );
  }
  // Both interactive states share the same 22×22 circle geometry —
  // only the border + bg + glyph differ. Single button definition
  // with state-driven style keeps the geometry locked across both.
  const isMyConfirmed = state === "my-confirmed";
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={isMyConfirmed ? myConfirmedLabel : rumouredLabel}
      className="mt-0.5 inline-flex items-center justify-center rounded-full text-[11px] font-medium"
      style={{
        // Fixed 22×22 per the mockup. The pre-refactor confirmed
        // span uses `text-right` to right-align the digit in the
        // wider grid cell; the button is fixed-width so it sits at
        // the cell's natural start instead. Acceptable because
        // rumoured rows are visually distinct anyway (gray bg +
        // dotted border) — the right-edge alignment is a
        // confirmed-only detail.
        width: 22,
        height: 22,
        flexShrink: 0,
        cursor: "pointer",
        ...(isMyConfirmed
          ? {
              border: `1.5px solid ${colors.primary}`,
              background: colors.primaryBg,
              color: colors.primary,
            }
          : {
              border: `1.5px dashed ${colors.textMuted}`,
              color: colors.textMuted,
              background: "transparent",
            }),
      }}
    >
      {isMyConfirmed ? "✓" : "?"}
    </button>
  );
}
