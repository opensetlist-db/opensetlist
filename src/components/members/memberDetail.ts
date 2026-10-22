import type { CSSProperties } from "react";
import { colors } from "@/styles/tokens";

/*
 * Small pure helpers for the member detail page's components (30-v1).
 * Kept out of any "use client" module: server components import these,
 * and a plain value exported from a client module can resolve to
 * undefined during SSR.
 */

/** Neutral rim/accent (#7C8BA3): the `no-color` fallback and the mix
 *  partner of every avatar rim. */
export const MEMBER_NEUTRAL_COLOR = colors.borderStrong;

/** Compact numeric date for event rows ("2026. 11. 29." / "2026/11/29"
 *  / "11/29/2026"), UTC like every stored event date. */
export const MEMBER_EVENT_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "UTC",
};

/**
 * Inline custom properties consumed by `memberDetail.module.css`:
 * `--member-color` (personal colour, neutral when unset) and
 * `--member-neutral` (the rim's mix partner), so the CSS carries no
 * colour literal of its own. Only the card's top rule, avatar wash and
 * avatar rim read them — no text — so any stored colour (including
 * #ffffff) is safe to pass through.
 */
export function memberColorStyle(color: string | null): CSSProperties {
  return {
    "--member-color": color ?? MEMBER_NEUTRAL_COLOR,
    "--member-neutral": MEMBER_NEUTRAL_COLOR,
  } as CSSProperties;
}
