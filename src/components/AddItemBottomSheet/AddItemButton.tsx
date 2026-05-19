"use client";

import { useTranslations } from "next-intl";
import { SecondaryButton } from "@/components/ui/Button";

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
 * Visual treatment: full-width SecondaryButton — the unified
 * utility-row style shared with the wishlist `+ Add a song` and the
 * Predict two-button row. The earlier gradient pill (PR #390 → v0.13.9)
 * was the same prominence as the Share CTA, which read as a CTA-
 * level competition with the actual-setlist content. The wishlist-
 * button-polish mockup (`raw/mockups/wishlist-button-polish-mockup.jsx`)
 * splits the hierarchy: utility actions get secondary styling, only
 * Share keeps the gradient PrimaryButton. The wrapper keeps its
 * dashed top border so the section break between main rows and the
 * encore section stays visible — that border is load-bearing for the
 * section break, not the button's prominence.
 *
 * Anchored just below the last main row (above the encore divider)
 * so encore rows still sort beneath the add affordance — submitting
 * an encore song uses the per-row encore toggle inside the sheet,
 * not the position of the button.
 */
export function AddItemButton({ onClick }: Props) {
  const t = useTranslations("AddItem");
  return (
    <div className="py-3 px-5 border-t border-dashed border-gray-200">
      <SecondaryButton onClick={onClick} fullWidth>
        {t("addButtonLabel")}
      </SecondaryButton>
    </div>
  );
}
