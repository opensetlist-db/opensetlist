"use client";

import { useTranslations } from "next-intl";

interface Props {
  setlistItemId: number;
  onReport: (setlistItemId: number) => void;
}

/**
 * Per-row "이슈 제기" affordance — visible on EVERY rumoured AND
 * confirmed row when `LAUNCH_FLAGS.contestReportEnabled` is on.
 * Tapping opens `<ContestReportSheet>` pre-targeted at this row.
 *
 * Distinct from `<RowContestButton>` (which only shows on
 * rumoured-in-conflict rows and opens AddItemBottomSheet to create
 * a real-time sibling). Two distinct intents:
 *
 *   - RowContestButton: "I want to propose a different song here
 *     right now and let votes decide" — fast-path, only available
 *     when a conflict group already exists at this position
 *   - IssueReportButton: "I want to file a queued report for the
 *     operator to triage" — slow-path, available on any row, can
 *     express missing-performer / wrong-variant / other corrections
 *     that the sibling model can't carry
 *
 * Visibility is gated by the parent (`<ActualSetlist>`): only
 * mounted when the flag is on. No conditional inside this
 * component.
 */
export function IssueReportButton({ setlistItemId, onReport }: Props) {
  const t = useTranslations("IssueReport");
  return (
    <button
      type="button"
      onClick={() => onReport(setlistItemId)}
      className="text-xs text-gray-500 hover:text-gray-800 underline underline-offset-2 px-1"
    >
      {t("buttonLabel")}
    </button>
  );
}
