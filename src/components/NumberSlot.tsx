"use client";

import { colors } from "@/styles/tokens";

/**
 * Binary row state — collapsed from the v0.10.0 three-tuple
 * (`confirmed | rumoured | my-confirmed`) once the cell became a
 * pair of independent vote buttons. The viewer's vote is now a
 * separate axis (`myVote`), not a row-level state. `<SetlistRow>`
 * still uses `RowState` to drive the gray-bg / no-bg distinction —
 * "rumoured" rows get the gray bg regardless of how the viewer
 * voted on them.
 */
export type RowState = "confirmed" | "rumoured";

/**
 * Per-viewer vote on a single rumoured row. Mutual exclusivity
 * (a viewer can't simultaneously confirm AND disagree) is enforced
 * by the consumer (`<ActualSetlist>`'s tap handlers); the prop
 * itself just describes the current visual state.
 *
 * "none" means the viewer hasn't voted on this row yet — both
 * buttons render in their dotted-border resting state.
 */
export type RowVote = "confirm" | "disagree" | "none";

interface Props {
  state: RowState;
  position: number;
  /**
   * Per-viewer vote, only meaningful when `state === "rumoured"`.
   * Ignored on confirmed rows (which don't render buttons).
   * Optional with a "none" default so admin / preview consumers
   * (SetlistBuilder, etc.) don't need to pass it.
   */
  myVote?: RowVote;
  /** Tap handler for the 👍 button. Required when state is "rumoured". */
  onConfirmTap?: () => void;
  /** Tap handler for the 👎 button. Required when state is "rumoured". */
  onDisagreeTap?: () => void;
  /**
   * aria-label for the 👍 button. Caller passes the i18n
   * resolution since this component is rendered both inside admin
   * (Korean-only per CLAUDE.md exemption) and public surfaces.
   */
  confirmAriaLabel: string;
  /** aria-label for the 👎 button. Same i18n contract as confirmAriaLabel. */
  disagreeAriaLabel: string;
}

/**
 * Two-state position cell for `<SetlistRow>`.
 *
 *   - "confirmed": plain number, muted color, no border. Visual
 *     parity with the pre-Confirm-UI `<span>` it replaces.
 *   - "rumoured": side-by-side `[👍][👎]` 22×22 buttons. The viewer
 *     can vote either direction; mutual exclusivity (toggling 👍
 *     clears 👎 and vice versa) is enforced by the parent's tap
 *     handlers, not here. Visual state per `myVote`:
 *
 *       myVote="none"     both buttons dotted-border, muted
 *       myVote="confirm"  👍 solid sky-blue (active), 👎 muted
 *       myVote="disagree" 👍 muted, 👎 solid rose-red (active)
 *
 * Replaces the v0.10.0 `[?]/[✓]` single-button shape — see the
 * v0.10.1 plan ("Replace `<FlagButton>` with thumb-up/thumb-down
 * vote buttons"). The mailto-based FlagButton was too high-friction
 * for the operator-expected report volume; the 👎 button shape
 * also lays the groundwork for Week 3's user-entered conflict
 * resolution where viewers vote between competing rows.
 *
 * Mockup source: `raw/mockups/mockup-setlist.jsx` `ConfirmButton`
 * (the original two-button mockup, which v0.10.0 simplified to a
 * single button — this rewrite restores the original shape).
 */
export function NumberSlot({
  state,
  position,
  myVote = "none",
  onConfirmTap,
  onDisagreeTap,
  confirmAriaLabel,
  disagreeAriaLabel,
}: Props) {
  if (state === "confirmed") {
    // Plain right-aligned number. Width matches the wider
    // rumoured-cell footprint (52px) so confirmed rows stay
    // grid-aligned with the position cells of any rumoured rows
    // above/below them. The pre-Confirm-UI `lg:w-9` was 36px;
    // bumping to 52px adds ~16px blank space on confirmed rows but
    // avoids a per-row variable-width layout that would jiggle
    // alignment across the table. Visual cost accepted.
    return (
      <span
        className="mt-0.5 pt-px text-right text-sm font-mono lg:w-[52px]"
        style={{ color: colors.textMuted }}
      >
        {position}
      </span>
    );
  }
  // Two side-by-side 22×22 vote buttons with 8px gap (= 52px
  // total). Geometry locked across both buttons; only border + bg
  // + glyph differ per active state.
  const isConfirmed = myVote === "confirm";
  const isDisagreed = myVote === "disagree";
  // Without a tap handler the button has no behavior — render it
  // as `disabled` (also drops the `pointer` cursor) so it doesn't
  // advertise itself as interactive. In practice every fan-facing
  // call site (`<SetlistRow>` via `<ActualSetlist>`) supplies both
  // handlers, but the props are typed optional and an admin/preview
  // caller (SetlistBuilder) could legitimately render a row without
  // wiring the vote actions. Without this guard the buttons would
  // be focusable + clickable + visually identical to the active
  // state, which is a usability + a11y bug. CR #293.
  const canConfirmTap = typeof onConfirmTap === "function";
  const canDisagreeTap = typeof onDisagreeTap === "function";
  return (
    <div
      className="mt-0.5 inline-flex items-center"
      style={{ gap: 8 }}
    >
      <button
        type="button"
        onClick={onConfirmTap}
        disabled={!canConfirmTap}
        aria-disabled={!canConfirmTap}
        aria-label={confirmAriaLabel}
        aria-pressed={isConfirmed}
        className="inline-flex items-center justify-center rounded-full text-[11px] font-medium"
        style={{
          width: 22,
          height: 22,
          flexShrink: 0,
          cursor: canConfirmTap ? "pointer" : "default",
          ...(isConfirmed
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
        👍
      </button>
      <button
        type="button"
        onClick={onDisagreeTap}
        disabled={!canDisagreeTap}
        aria-disabled={!canDisagreeTap}
        aria-label={disagreeAriaLabel}
        aria-pressed={isDisagreed}
        className="inline-flex items-center justify-center rounded-full text-[11px] font-medium"
        style={{
          width: 22,
          height: 22,
          flexShrink: 0,
          cursor: canDisagreeTap ? "pointer" : "default",
          ...(isDisagreed
            ? {
                border: `1.5px solid ${colors.disagreeText}`,
                background: colors.disagreeBg,
                color: colors.disagreeText,
              }
            : {
                border: `1.5px dashed ${colors.textMuted}`,
                color: colors.textMuted,
                background: "transparent",
              }),
        }}
      >
        👎
      </button>
    </div>
  );
}
