"use client";

import { useTranslations } from "next-intl";
import { colors } from "@/styles/tokens";

interface Props {
  onClick: () => void;
}

/**
 * The `+ 곡 추가` button mounted at the bottom of the actual setlist
 * during an ongoing event. Tapped → opens `<AddItemBottomSheet>`.
 *
 * Visibility is gated by the parent (`<ActualSetlist>`) on:
 *   1. `LAUNCH_FLAGS.addItemEnabled` (false at Kobe 5/23, true at
 *      Kanagawa 5/30)
 *   2. `event.status === 'ongoing'`
 *
 * No conditional inside this component — the parent renders or
 * doesn't render it, so the button is always actionable when
 * mounted. Keeps the unit-test surface tight (visibility = mount,
 * not internal predicate).
 *
 * Visual treatment: full-width gradient bar (cyan → blue) matching
 * the share-card CTA tone. The earlier "ghost row" treatment was too
 * quiet for a load-bearing crowdsourcing affordance — Phase 1C's
 * participation funnel starts here, and a muted row buried under the
 * setlist was getting overlooked. Sibling `+ 곡 추가` CTAs in the
 * Predict + Wishlist surfaces share the same gradient tone for
 * consistency. Anchored just below the last main row (above the
 * encore divider) so encore rows still sort beneath the add
 * affordance — submitting an encore song uses the per-row encore
 * toggle inside the sheet, not the position of the button.
 */
export function AddItemButton({ onClick }: Props) {
  const t = useTranslations("AddItem");
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left text-sm font-semibold text-white py-3.5 px-5 hover:opacity-90 active:opacity-80 transition-opacity"
      style={{
        background: colors.brandGradient,
        border: "none",
        cursor: "pointer",
      }}
    >
      {t("addButtonLabel")}
    </button>
  );
}
