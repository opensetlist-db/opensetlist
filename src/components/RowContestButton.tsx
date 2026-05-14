"use client";

import { useTranslations } from "next-intl";

interface Props {
  /**
   * The position the AddItemBottomSheet should pre-target when this
   * button is tapped. Captured here (at render time) and passed up
   * via `onContest`; downstream the sheet freezes it so a Realtime
   * push during deliberation doesn't auto-update the target.
   */
  position: number;
  onContest: (position: number) => void;
}

/**
 * Per-row contest affordance — shown next to a rumoured row that is
 * in a conflict group (i.e. has rumoured siblings at the same
 * position). Tapping opens the `<AddItemBottomSheet>` pre-targeted
 * at this row's position so a third (or later) user can add their
 * own candidate to the conflict.
 *
 * Visibility is gated by the parent (`<SetlistRow>`): only rendered
 * when the row is rumoured AND has siblings. Single rumoured rows
 * don't show this — there's no conflict to add to, and the
 * footer "+ 곡 추가" button covers the "next position" intent.
 *
 * Follow-up "ContestReport" PR: a sibling "이슈 제기" affordance
 * for confirmed rows + non-song corrections (missing performer,
 * wrong variant) will slot in next to this one. The shared
 * affordance-slot pattern in `<SetlistRow>` is the integration
 * point.
 */
export function RowContestButton({ position, onContest }: Props) {
  const t = useTranslations("AddItem");
  return (
    <button
      type="button"
      onClick={() => onContest(position)}
      className="text-xs text-blue-600 hover:text-blue-800 underline underline-offset-2 px-1"
    >
      {t("contestRowLabel")}
    </button>
  );
}
