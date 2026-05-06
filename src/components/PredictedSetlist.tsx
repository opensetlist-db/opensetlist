"use client";

import { useTranslations } from "next-intl";
import { colors } from "@/styles/tokens";

/**
 * Stage B placeholder for the Phase 1B Predicted Setlist surface.
 *
 * Renders a centered "coming soon" panel inside the Predicted tab
 * body. Stage C's Predicted Setlist task replaces the body with
 * real prediction rendering — the placeholder lets `<SetlistTabs>`
 * + `<SetlistSection>` ship + verify their visibility logic
 * without depending on Stage C's deliverable.
 */
export function PredictedSetlist() {
  const t = useTranslations("Setlist");
  return (
    <div
      className="text-center"
      style={{
        padding: "32px 16px",
        fontSize: 13,
        color: colors.textMuted,
      }}
    >
      {t("predictedComingSoon")}
    </div>
  );
}
