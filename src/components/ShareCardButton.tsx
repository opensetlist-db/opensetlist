"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ShareCardModal } from "@/components/ShareCardModal";
import { calcShareCardScore } from "@/lib/predictScore";
import { BASE_URL } from "@/lib/config";
import type { PredictionEntry } from "@/lib/predictionsStorage";
import type { LiveSetlistItem } from "@/lib/types/setlist";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import { colors } from "@/styles/tokens";

interface Props {
  eventId: string;
  seriesName: string;
  locale: string;
  status: ResolvedEventStatus;
  /**
   * Polled actual setlist (filtered to song-type rows by
   * `<SetlistSection>`). Full `LiveSetlistItem[]` shape so
   * `<ShareCardPreview>` can call `displayOriginalTitle` on each
   * song without an unsafe re-cast.
   */
  actualSongs: LiveSetlistItem[];
  predictions: PredictionEntry[];
}

/**
 * Share button + modal trigger. The button now appears in two
 * states so users learn the affordance exists *before* the show
 * ends, instead of having it pop in only at completion:
 *
 *   - During show (`status === "ongoing"` + has predictions):
 *     visible but disabled, with a "공연 종료 후 활성화됩니다"
 *     hint to its left explaining the wait. No score yet, modal
 *     unreachable.
 *   - Post-show (`status === "completed"` + has actuals + has
 *     predictions): enabled, full gradient, opens the share modal.
 *
 * Pre-show (`status === "upcoming"`) and zero-prediction cases
 * still return null — there's nothing to share, so showing the
 * button would just be noise. Prediction-locked-but-empty users
 * also stay null since the share card has no payload to render.
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
  const [open, setOpen] = useState(false);

  // Visibility: any time the user *has* predictions for an event
  // that's mid-flight or finished. During the show the button is
  // disabled (no score yet); after, it opens the modal.
  const enabled =
    status === "completed" &&
    actualSongs.length > 0 &&
    predictions.length > 0;
  const visible =
    enabled || (status === "ongoing" && predictions.length > 0);

  // Compute share-card score (order-independent) only when enabled.
  // LiveSetlistItem has `id: number` so it satisfies
  // calcShareCardScore's `SongMatchInputItem & { id }` signature
  // structurally — no cast needed.
  const score = useMemo(() => {
    if (!enabled) return { matched: 0, total: 0, percentage: 0 };
    return calcShareCardScore(predictions, actualSongs);
  }, [enabled, predictions, actualSongs]);

  if (!visible) return null;

  const eventTitle = seriesName; // page resolves the full title; reuse
  const dateLine = ""; // TODO Stage C+: thread date+venue via props
  // Use the project's BASE_URL helper so preview / local / prod all
  // emit correct share URLs. BASE_URL pulls from
  // NEXT_PUBLIC_BASE_URL with a vercel.app fallback (see
  // src/lib/config.ts).
  const eventUrl = `${BASE_URL}/${locale}/events/${eventId}`;

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
          gap: "10px",
        }}
      >
        {!enabled && (
          <span
            className="text-[11px]"
            style={{ color: colors.textMuted }}
          >
            {t("shareDisabled")}
          </span>
        )}
        <button
          type="button"
          onClick={() => enabled && setOpen(true)}
          disabled={!enabled}
          aria-disabled={!enabled}
          className="text-sm font-medium rounded-full px-5 py-2"
          style={{
            // Disabled: muted slate from the shared `colors.textMuted`
            // token (same hex the modal's `busy` state uses inline).
            // Enabled: brand-blue gradient, same as before.
            background: enabled
              ? "linear-gradient(135deg, #4FC3F7, #0277BD)"
              : colors.textMuted,
            color: "white",
            border: "none",
            whiteSpace: "nowrap",
            cursor: enabled ? "pointer" : "not-allowed",
            opacity: enabled ? 1 : 0.85,
          }}
        >
          {t("shareButton")}
        </button>
      </div>

      {/* Modal only mounts in the enabled path — `open` can never
          flip true while disabled (the click handler short-circuits)
          but gating render here avoids carrying html2canvas + modal
          state for users who can't reach it. */}
      {enabled && (
        <ShareCardModal
          open={open}
          onClose={() => setOpen(false)}
          seriesName={seriesName}
          eventTitle={eventTitle}
          dateLine={dateLine}
          actualSongs={actualSongs}
          predictions={predictions}
          matched={score.matched}
          total={score.total}
          percentage={score.percentage}
          predictedCount={predictions.length}
          locale={locale}
          shareUrl={eventUrl}
        />
      )}
    </>
  );
}
