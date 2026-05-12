"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ShareCardModal } from "@/components/ShareCardModal";
import type { ShareCardMode } from "@/components/ShareCardPreview";
import { calcShareCardScore } from "@/lib/predictScore";
import { trackEvent } from "@/lib/analytics";
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
 * Derive the share-card `mode` from event lifecycle + actual-setlist
 * presence. See `<ShareCardPreview>` for the per-mode rendering rules.
 *
 *   - `upcoming` (pre-show)                  → `prediction`
 *   - `ongoing` with no actuals yet          → `prediction`
 *     (operator hasn't entered any songs; treating as pre-show keeps
 *     the card useful instead of rendering an empty result body)
 *   - `ongoing` with at least one actual     → `live`
 *   - `completed`                            → `final`
 *   - `cancelled` (rare)                     → `final` if any actuals,
 *                                              else `prediction`
 *
 * Pure function so the test suite can pin every transition without
 * mounting the component.
 */
export function deriveShareCardMode(
  status: ResolvedEventStatus,
  hasActuals: boolean,
): ShareCardMode {
  if (status === "completed") return "final";
  if (status === "cancelled") return hasActuals ? "final" : "prediction";
  if (status === "ongoing" && hasActuals) return "live";
  return "prediction";
}

/**
 * Share button + modal trigger. Shows up whenever the viewer has at
 * least one prediction stored for the event, at every lifecycle
 * stage. Pre-show is the viral entry point — fans share their
 * predictions BEFORE the show, friends see the image, friends show
 * up. v0.11.1-and-earlier only enabled share post-show, missing the
 * pre-show share funnel entirely.
 *
 * Three modes, derived via `deriveShareCardMode` above:
 *
 *   - `prediction` (pre-show or ongoing-no-actuals): button reads
 *     `예상 공유 🎯`. Card has no score banner; renders the viewer's
 *     predictions in their rank order with a "예상 세트리스트" label.
 *   - `live` (ongoing + has actuals): button reads `결과 공유 🎯`.
 *     Card mirrors the post-show layout with a red `LIVE` pill in
 *     the top-right and a partial score.
 *   - `final` (completed): button reads `결과 공유 🎯`. Current
 *     post-show layout — final score, full actual setlist.
 *
 * Zero-prediction events still return null in every state — there's
 * nothing to share, so the button would just be noise.
 *
 * Score: `calcShareCardScore` is order-independent and only
 * meaningful when actualSongs is non-empty. Computed once for both
 * `live` + `final` modes; skipped for `prediction` (no score to
 * compute). See `src/lib/predictScore.ts` for the "do not unify
 * with `calcPredictScore`" rationale.
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

  const hasActuals = actualSongs.length > 0;
  const mode = deriveShareCardMode(status, hasActuals);

  // Hide the surface entirely if the viewer hasn't predicted anything.
  // No payload to render in `prediction` mode; no fan-vs-result
  // narrative to render in `live` / `final` mode either.
  const visible = predictions.length > 0;

  // Score only meaningful in modes that have an actual setlist to
  // compare predictions against. `prediction` mode skips this work
  // entirely. LiveSetlistItem has `id: number` so it satisfies
  // calcShareCardScore's `SongMatchInputItem & { id }` signature
  // structurally — no cast needed.
  const score = useMemo(() => {
    if (mode === "prediction") return { matched: 0, total: 0, percentage: 0 };
    return calcShareCardScore(predictions, actualSongs);
  }, [mode, predictions, actualSongs]);

  if (!visible) return null;

  const eventTitle = seriesName; // page resolves the full title; reuse
  const dateLine = ""; // TODO Stage C+: thread date+venue via props
  // Use the project's BASE_URL helper so preview / local / prod all
  // emit correct share URLs. BASE_URL pulls from
  // NEXT_PUBLIC_BASE_URL with a vercel.app fallback (see
  // src/lib/config.ts).
  const eventUrl = `${BASE_URL}/${locale}/events/${eventId}`;

  const buttonLabel =
    mode === "prediction" ? t("shareButtonPrediction") : t("shareButton");

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
        <button
          type="button"
          onClick={() => {
            // GA4 Phase 1B: include `mode` so post-analysis can
            // segment the share funnel by lifecycle stage —
            // pre-show shares are the new viral entry point and
            // worth measuring separately from post-show shares.
            trackEvent("share_card_open", {
              event_id: String(eventId),
              mode,
            });
            setOpen(true);
          }}
          className="text-sm font-medium rounded-full px-5 py-2"
          style={{
            background: "linear-gradient(135deg, #4FC3F7, #0277BD)",
            color: "white",
            border: "none",
            whiteSpace: "nowrap",
            cursor: "pointer",
          }}
        >
          {buttonLabel}
        </button>
      </div>

      <ShareCardModal
        open={open}
        onClose={() => setOpen(false)}
        eventId={eventId}
        mode={mode}
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
    </>
  );
}
