"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ShareCardModal } from "@/components/ShareCardModal";
import { calcShareCardScore } from "@/lib/predictScore";
import type { PredictionEntry } from "@/lib/predictionsStorage";
import type { LiveSetlistItem } from "@/lib/types/setlist";
import type { SongMatchInputItem } from "@/lib/songMatch";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import { colors } from "@/styles/tokens";

interface Props {
  eventId: string;
  seriesName: string;
  locale: string;
  status: ResolvedEventStatus;
  /**
   * Polled actual setlist (filtered to song-type rows by
   * `<SetlistSection>`). For the share-card preview body we cast
   * back to `LiveSetlistItem` so the per-row `displayOriginalTitle`
   * call has access to translations + originalTitle.
   */
  actualSongs: SongMatchInputItem[];
  predictions: PredictionEntry[];
}

/**
 * Post-show share button + modal trigger. Display gates per task
 * spec:
 *
 *   showShareButton =
 *     event.status === 'completed' &&
 *     actualSetlist.length > 0 &&
 *     userPrediction.length > 0
 *
 * When the gate fails, returns null (no button rendered). The
 * Predicted tab's during-show "결과 공유 (공연 종료 후 활성화됩니다)"
 * placeholder is intentionally NOT in this component — that's a
 * separate visual concern; the during-show placeholder belongs to
 * the during-show legend area, which can be added later if the
 * spec calls for it. For Phase 1B Stage C we ship the post-show
 * button only.
 *
 * Score for the share card uses `calcShareCardScore` (order-
 * independent) — distinct from the live tab's position-rank rule
 * (`calcPredictScore`). See `src/lib/predictScore.ts` for the
 * "do not unify" rationale.
 */
export function ShareCardButton({
  eventId,
  seriesName,
  locale,
  status,
  actualSongs,
  predictions,
}: Props) {
  const t = useTranslations("Predict");
  const stT = useTranslations("ShareCard");
  const [open, setOpen] = useState(false);

  // Gate: post-show + has actuals + has predictions.
  const visible =
    status === "completed" &&
    actualSongs.length > 0 &&
    predictions.length > 0;

  // Compute share-card score (order-independent). Cast actualSongs
  // to the broader interface required by calcShareCardScore (needs
  // `id` for de-dupe). LiveSetlistItem has `id: number`; the cast is
  // safe.
  const score = useMemo(() => {
    if (!visible) return { matched: 0, total: 0, percentage: 0 };
    return calcShareCardScore(
      predictions,
      actualSongs as Array<SongMatchInputItem & { id: number }>,
    );
  }, [visible, predictions, actualSongs]);

  if (!visible) return null;

  // The full LiveSetlistItem shape is required by ShareCardPreview
  // for displayOriginalTitle. SetlistSection passes the polled items
  // (full shape) through PredictedSetlist → ShareCardButton with
  // the SongMatchInputItem narrowed type; widening back is safe at
  // runtime because the source IS LiveSetlistItem[].
  const fullItems = actualSongs as unknown as LiveSetlistItem[];

  const eventTitle = seriesName; // page resolves the full title; reuse
  const dateLine = ""; // TODO Stage C+: thread date+venue via props
  const eventUrl = `https://opensetlist.com/${locale}/events/${eventId}`;

  const shareText = stT("shareText", {
    seriesName,
    pct: score.percentage,
    matched: score.matched,
    total: score.total,
  });

  return (
    <>
      <div
        style={{
          padding: "14px 14px",
          borderTop: `0.5px solid ${colors.borderLight}`,
          background: colors.bgSubtle,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm font-medium rounded-full px-5 py-2 cursor-pointer"
          style={{
            background: "linear-gradient(135deg, #4FC3F7, #0277BD)",
            color: "white",
            border: "none",
            whiteSpace: "nowrap",
          }}
        >
          {t("shareButton")}
        </button>
      </div>

      <ShareCardModal
        open={open}
        onClose={() => setOpen(false)}
        seriesName={seriesName}
        eventTitle={eventTitle}
        dateLine={dateLine}
        actualSongs={fullItems}
        predictions={predictions}
        matched={score.matched}
        total={score.total}
        percentage={score.percentage}
        predictedCount={predictions.length}
        locale={locale}
        shareText={shareText}
        shareUrl={eventUrl}
      />
    </>
  );
}
