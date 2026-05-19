"use client";

import { useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { colors, gradients, rgbaFromHex } from "@/styles/tokens";

/**
 * Single source-of-truth for the two button design tokens introduced
 * by the wishlist / predict polish redesign. `<PrimaryButton>` is the
 * gradient CTA (share / launch) — `<SecondaryButton>` is the
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
 *     degree (primary scales + deepens gradient; secondary flips
 *     foreground colour) — folding both into a single component
 *     forces branching on every interaction handler.
 *   - Call sites use distinct semantic intent — searching for
 *     "PrimaryButton" reads cleaner than "Button variant=primary"
 *     when auditing CTA prominence across the app.
 *
 * Both variants:
 *   - Default `type="button"` so nesting inside a `<form>` never
 *     submits.
 *   - Carry `whiteSpace: "nowrap"` so narrow-viewport labels
 *     truncate instead of wrapping — keeps the two-button row in
 *     Predict from re-flowing on iPhone SE.
 *   - Honour `disabled`: native attribute + `pointer-events: none`
 *     so pressed / hover state can never latch while disabled.
 *   - Style cascade: variant defaults → `className` utilities →
 *     `style` prop (last write wins).
 */

interface ButtonBaseProps {
  children: ReactNode;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  fullWidth?: boolean;
  disabled?: boolean;
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
  children,
  onClick,
  fullWidth = false,
  disabled = false,
  style,
  type = "button",
  ariaLabel,
  className,
}: ButtonBaseProps) {
  const [pressed, setPressed] = useState(false);
  const isPressed = !disabled && pressed;

  // Disabled primary: switch to a grayscale ramp rather than alpha-
  // on-brand. Lower opacity on the brand gradient ghosts the page
  // background through and reads as "broken" rather than "disabled";
  // a saturated → grayscale swap is the unambiguous signal.
  const background = disabled
    ? "linear-gradient(135deg, #94a3b8, #64748b)"
    : isPressed
      ? gradients.brandGradientPressed
      : colors.brandGradient;

  const boxShadow = disabled
    ? "none"
    : isPressed
      ? `0 1px 3px ${rgbaFromHex(colors.primary, 0.3)}`
      : `0 2px 8px ${rgbaFromHex(colors.primary, 0.25)}`;

  return (
    <button
      type={type}
      onClick={disabled ? undefined : onClick}
      onPointerDown={() => !disabled && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      disabled={disabled}
      aria-label={ariaLabel}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        width: fullWidth ? "100%" : "auto",
        padding: "9px 18px",
        borderRadius: 10,
        border: "none",
        background,
        color: "white",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: "0.01em",
        cursor: disabled ? "not-allowed" : "pointer",
        pointerEvents: disabled ? "none" : "auto",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        transition: "all 0.12s",
        transform: isPressed ? "scale(0.97)" : "scale(1)",
        boxShadow,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
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
