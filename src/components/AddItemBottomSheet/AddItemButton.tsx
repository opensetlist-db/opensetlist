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
 * Visual treatment: left-aligned pill button (cyan → blue gradient)
 * matching the share-card CTA shape exactly. The earlier "ghost row"
 * was too quiet for a load-bearing crowdsourcing affordance — Phase
 * 1C's participation funnel starts here — and an intermediate
 * full-width gradient bar (PR #390) read as too heavy. The pill
 * shape lands at the same prominence as `결과 공유 🎯` so the two
 * primary CTAs feel like siblings. Sibling `+ 곡 추가` pills in the
 * Predict + Wishlist surfaces share the same shape and left-aligned
 * placement (operator preference — center alignment looked floaty
 * against the left-anchored setlist row content). Wrapper row keeps
 * a dashed top border so the section break between main and encore
 * rows reads visually even with the pill replacing the bar.
 * Anchored just below the last main row (above the encore divider)
 * so encore rows still sort beneath the add affordance — submitting
 * an encore song uses the per-row encore toggle inside the sheet,
 * not the position of the button.
 */
export function AddItemButton({ onClick }: Props) {
  const t = useTranslations("AddItem");
  return (
    <div className="py-3 px-5 border-t border-dashed border-gray-200">
      <button
        type="button"
        onClick={onClick}
        className="text-sm font-medium rounded-full px-5 py-2 hover:opacity-90 active:opacity-80 transition-opacity"
        style={{
          background: colors.brandGradient,
          color: "white",
          border: "none",
          whiteSpace: "nowrap",
          cursor: "pointer",
        }}
      >
        {t("addButtonLabel")}
      </button>
    </div>
  );
}
