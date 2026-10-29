"use client";

import { useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { colors } from "@/styles/tokens";
import styles from "./Button.module.css";

/**
 * Single source-of-truth for the two button design tokens introduced
 * by the wishlist / predict polish redesign. `<PrimaryButton>` is the
 * primary CTA (share / picker completion) — `<SecondaryButton>` is the
 * utility-row partner (add-from-search / add-from-past). Five call
 * sites share these variants:
 *
 *   - Wishlist `+ Add a song` — `<EventWishSection>`
 *   - Predict `+ Add a song` + `📋 …` (flex:1 each) — `<PredictedSetlist>`
 *   - Actual setlist `+ Add` — `<AddItemBottomSheet/AddItemButton>`
 *   - Share prediction CTA — `<ShareCardButton>` (primary)
 *
 * Mockup of record:
 *   `F:\work\vaults\opensetlist\raw\mockups\wishlist-button-polish-mockup.jsx`
 *
 * Why two components instead of one variant prop:
 *   - The press / hover affordances are different in kind, not in
 *     degree (primary deepens its fill; secondary flips
 *     foreground colour) — folding both into a single component
 *     forces branching on every interaction handler.
 *   - Call sites use distinct semantic intent — searching for
 *     "PrimaryButton" reads cleaner than "Button variant=primary"
 *     when auditing CTA prominence across the app.
 *
 * Both variants:
 *   - Default `type="button"` so nesting inside a `<form>` never
 *     submits.
 *   - Honour native disabled semantics. Primary interaction states
 *     use CSS so keyboard presses and touch cancellation cannot latch.
 *   - Primary labels wrap at narrow widths; utility-row secondary
 *     labels retain their existing single-line layout.
 *   - Allow layout overrides through className and the style prop.
 */

interface ButtonBaseProps {
  children: ReactNode;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  fullWidth?: boolean;
  disabled?: boolean;
  busy?: boolean;
  /** Merged AFTER the variant's computed style, so callers can
   *  override flex / width / margin without touching colours. */
  style?: CSSProperties;
  /** Defaults to "button" — nesting in a `<form>` never submits. */
  type?: "button" | "submit";
  /** Forwarded as `aria-label` when set. Lets icon-only callers
   *  satisfy a11y without changing children. */
  ariaLabel?: string;
  /** Pass-through for callers that need utility classes alongside
   *  inline style. Style cascade: variant defaults → className →
   *  inline `style`. */
  className?: string;
  testId?: string;
}

/**
 * Pointer events (not mouse events) cover touch + mouse + pen
 * uniformly. iOS Safari + Android Chrome both ship PointerEvents;
 * mobile is a primary surface here so we'd lose the press / hover
 * affordance entirely on `onMouseDown`-only. `pointerleave` +
 * `pointercancel` clear the latched state if the user drags off
 * the button or the OS interrupts (e.g. iOS multitasking).
 */

export function PrimaryButton({
  testId,
  children,
  onClick,
  fullWidth = false,
  disabled = false,
  busy = false,
  style,
  type = "button",
  ariaLabel,
  className,
}: ButtonBaseProps) {
  return (
    <button
      data-testid={testId}
      type={type}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-label={ariaLabel}
      className={[styles.primary, className].filter(Boolean).join(" ")}
      style={{
        width: fullWidth ? "100%" : "auto",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  testId,
  children,
  onClick,
  fullWidth = false,
  disabled = false,
  style,
  type = "button",
  ariaLabel,
  className,
}: ButtonBaseProps) {
  const [hovered, setHovered] = useState(false);
  const isHovered = !disabled && hovered;

  return (
    <button
      type={type}
      onClick={disabled ? undefined : onClick}
      onPointerEnter={() => !disabled && setHovered(true)}
      data-testid={testId}
      onPointerLeave={() => setHovered(false)}
      onPointerCancel={() => setHovered(false)}
      disabled={disabled}
      aria-label={ariaLabel}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        width: fullWidth ? "100%" : "auto",
        padding: "8px 16px",
        borderRadius: 10,
        border: `1.5px solid ${colors.border}`,
        background: isHovered ? colors.primaryHoverBg : "white",
        color: isHovered ? colors.primary : colors.textSecondary,
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: "0.01em",
        cursor: disabled ? "not-allowed" : "pointer",
        pointerEvents: disabled ? "none" : "auto",
        opacity: disabled ? 0.5 : 1,
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        transition: "all 0.12s",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
