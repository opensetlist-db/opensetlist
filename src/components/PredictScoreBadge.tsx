"use client";

import { useTranslations } from "next-intl";
import { colors } from "@/styles/tokens";

interface Props {
  matched: number;
  total: number;
  /**
   * "live" — small inline `{matched}/{total} 🎯` for the during-show
   * tab title (consumed by `<SetlistTabs predictedBadge>` slot).
   * "final" — pill-shaped `🎯 결과` chip for the post-show tab title.
   */
  variant: "live" | "final";
}

/**
 * Small badge surfaced in the Predicted tab title (and reused
 * elsewhere if needed). Matches the mockup's
 * `mockup-wish-predict.jsx` predictBadge logic — different visual
 * shape per phase: a plain blue text count during the show, a
 * solid pill chip after the show.
 *
 * Renders nothing when `total === 0` for the "live" variant — no
 * useful information to display before the actual setlist starts.
 */
export function PredictScoreBadge({ matched, total, variant }: Props) {
  const t = useTranslations("Predict");

  if (variant === "live") {
    if (total === 0) return null;
    return (
      <span
        className="text-xs font-medium"
        style={{ color: colors.primary }}
      >
        {t("tabBadgeLive", { matched, total })}
      </span>
    );
  }

  // "final" — solid pill chip. Shown post-show even when total === 0
  // (e.g. an event marked completed but with empty actual setlist —
  // rare but valid; the chip just reads "🎯 결과" without numbers).
  return (
    <span
      className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold align-middle"
      style={{
        background: colors.primary,
        color: "white",
      }}
    >
      {t("tabBadgeFinal")}
    </span>
  );
}
