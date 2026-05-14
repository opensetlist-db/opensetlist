"use client";

import { useTranslations } from "next-intl";

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
 * Visual treatment: full-width "ghost" row matching the project's
 * Wishlist + Predict surface add-row CTAs (`AddItem.addButtonLabel`
 * sets the "+ 곡 추가" copy). Anchored just below the last main row
 * (above the encore divider) so encore rows still sort beneath the
 * add affordance — submitting an encore song uses the per-row
 * encore toggle inside the sheet, not the position of the button.
 */
export function AddItemButton({ onClick }: Props) {
  const t = useTranslations("AddItem");
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 active:bg-gray-100 transition-colors py-3 px-5 border-t border-dashed border-gray-200"
    >
      {t("addButtonLabel")}
    </button>
  );
}
