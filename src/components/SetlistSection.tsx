"use client";

import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ActualSetlist } from "@/components/ActualSetlist";
import { PredictedSetlist } from "@/components/PredictedSetlist";
import { SetlistTabs, type SetlistTab } from "@/components/SetlistTabs";
import { useMounted } from "@/hooks/useMounted";
import { hasPredictions as readHasPredictions } from "@/lib/predictionsStorage";
import type {
  LiveSetlistItem,
  ReactionCountsMap,
} from "@/lib/types/setlist";
import type { ResolvedEventStatus } from "@/lib/eventStatus";

interface Props {
  eventId: string;
  items: LiveSetlistItem[];
  reactionCounts: ReactionCountsMap;
  locale: string;
  /**
   * Stage C — props threaded through to `<PredictedSetlist>`.
   *   - `status`: drives pre-show / during-show / post-show modes
   *   - `startTime`: used for the lock check (now >= startTime)
   *   - `seriesName`: pre-resolved display string for the share-card
   *     text payload (parent already does the cascade for the page
   *     header so we don't redo it).
   */
  status: ResolvedEventStatus;
  startTime: Date | string | null;
  seriesName: string;
  /**
   * Rendered when neither actual rows nor predictions exist (e.g.
   * the historical "no setlist yet" `<p>` from `<LiveSetlist>`).
   * Delegated INTO this component (rather than gated outside) so
   * the predictions-but-no-actual case (matrix case 1) can still
   * surface the Predicted-only tab strip — see the task spec at
   * `wiki/output/task-week2-setlistsection-tab-refactor.md` for
   * the full visibility table.
   */
  emptyFallback: ReactNode;
}

/**
 * Tab-aware wrapper for the SETLIST surface body. Sits inside
 * `<LiveSetlist>`'s white card, BELOW the existing card header
 * (per task `wiki/output/task-week2-setlistsection-tab-refactor.md`
 * decision table — preserves the SETLIST h2 + LIVE pill + count
 * subtitle in all states; mockup shows tabs replacing the header,
 * but the user picked "tabs sit below" to keep the LIVE pill
 * visible).
 *
 * Visibility:
 *   - !hasPredictions, !hasActual              → predict-only (entry point for first-time visitors on upcoming events)
 *   - !hasPredictions,  hasActual              → only `<ActualSetlist>` (no tab strip — Phase 1A byte-equiv)
 *   - hasPredictions,  !hasActual              → only `<PredictedSetlist>` (Predicted tab only)
 *   - hasPredictions,   hasActual              → tab strip + body for active tab
 *
 * `hasPredictions` is a client-only signal (localStorage); SSR +
 * first client render see `false`. CodeRabbit caught a Major bug
 * on PR #281: pre-Stage-C, the no-predictions + no-actual path
 * dropped to `emptyFallback` ("no setlist yet") with no entry into
 * the Predicted UI — a first-time visitor on an upcoming event
 * could never start predicting. Stage C ships the predict writer,
 * so the gate now treats "no actuals (i.e. pre-show)" as a
 * standing invitation to predict; the Predict tab is always
 * available there. During/post-show events without predictions
 * still hide the Predict tab (no value: actuals are immutable
 * past startTime, so there's nothing left to predict).
 */
export function SetlistSection({
  eventId,
  items,
  reactionCounts,
  locale,
  status,
  startTime,
  seriesName,
  emptyFallback,
}: Props) {
  const t = useTranslations("Setlist");
  const mounted = useMounted();

  // Hydrate `hasPredictions` AFTER mount so SSR + first client
  // render produce matching HTML (false). INTENTIONAL — this is
  // the project's canonical pattern, see:
  //   - src/hooks/useMounted.ts:9-18 (docstring explicitly calls
  //     this the "canonical React 18+ replacement" for the
  //     useState+useEffect mount pattern)
  //   - src/components/ReactionButtons.tsx:184-191 (same mounted
  //     gate + render-time setState for localStorage hydration)
  //   - src/components/EventWishSection.tsx:65-72 (same pattern,
  //     also for a localStorage-backed init)
  // Switching to useEffect would trip `react-hooks/set-state-in-
  // effect`, the rule `useMounted` exists to avoid. `npm run lint`
  // is clean as-is. Code reviewers (CodeRabbit / commit-time hook /
  // prepush hook) sometimes flag this — it is the established
  // pattern, not a violation.
  const [storedHasPredictions, setStoredHasPredictions] = useState(false);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  if (mounted && hydratedKey !== eventId) {
    setHydratedKey(eventId);
    setStoredHasPredictions(readHasPredictions(eventId));
  }

  const hasActual = items.length > 0;
  // Predict tab visibility:
  //   - storedHasPredictions: user has typed predictions for this
  //     event before (localStorage). Always show their tab so they
  //     can see their list / score across the event lifecycle.
  //   - status === "upcoming": event hasn't started yet — show the
  //     tab as the entry point even for first-time visitors with
  //     no localStorage. CR #281 (Major) caught that without this
  //     half, first-timers had no path into the Predict UI.
  // During-show events without predictions still hide the tab; once
  // the show is over, predicting has no value to a viewer who didn't
  // play along live, so we don't surface the tab as clutter.
  const hasPredictions = storedHasPredictions || status === "upcoming";
  // Default to actual when both tabs are visible (case 2) — the
  // viewer's mental model in a during/post-show event is "what's
  // actually playing", not "what I predicted earlier". When only
  // the Predicted tab exists (case 1, pre-show), force the active
  // tab to "predicted" so the body matches the visible tab.
  const [activeTab, setActiveTab] = useState<SetlistTab>("actual");
  // Compute the rendered active-tab key separately so a state mismatch
  // (e.g. activeTab="actual" but hasActual=false) renders the right
  // body without forcing the user-driven activeTab state to chase
  // the hasActual prop.
  const renderedTab: SetlistTab =
    hasPredictions && !hasActual ? "predicted" : activeTab;

  // WAI-ARIA tabs pattern needs paired tab/panel ids so each tab's
  // `aria-controls` resolves to its panel and each panel's
  // `aria-labelledby` resolves back to its tab. Computed via
  // `useId()` UNCONDITIONALLY (Rules of Hooks — must run before
  // any early return) and threaded into both `<SetlistTabs>` and
  // the panel-wrapping `<div role="tabpanel">` below.
  const baseId = useId();
  const tabIds = {
    actual: `${baseId}-tab-actual`,
    predicted: `${baseId}-tab-predicted`,
  };
  const panelIds = {
    actual: `${baseId}-panel-actual`,
    predicted: `${baseId}-panel-predicted`,
  };
  const renderedPanelId =
    renderedTab === "actual" ? panelIds.actual : panelIds.predicted;
  const renderedTabId =
    renderedTab === "actual" ? tabIds.actual : tabIds.predicted;

  // Empty everywhere: no actual rows, no predictions. Show the
  // caller's fallback (historically the `<p>noSetlist</p>` from
  // `<LiveSetlist>`). No tab strip, no body wrapper — keeps the
  // pre-refactor render byte-equivalent for events without either.
  // Early return lives AFTER `useId` to satisfy Rules of Hooks.
  if (!hasPredictions && !hasActual) {
    return <>{emptyFallback}</>;
  }

  // Body for the rendered tab. Wrapper depends on whether tabs
  // are visible:
  //   - hasPredictions: wrap in <div role="tabpanel"> with
  //     aria-labelledby pointing at the matching tab id (WAI-ARIA
  //     tabs pattern requires the panel + tab pair).
  //   - !hasPredictions: NO wrapper at all. The Phase 1A path
  //     (no tabs in the DOM) must not advertise an orphaned
  //     `role="tabpanel"` whose `aria-labelledby` points at a
  //     non-existent tab id — that's both a screen-reader bug
  //     and a byte-equivalence regression. CodeRabbit caught this
  //     on PR #280's first fix-up round.
  // Filter to song-type rows that ALSO have a song picked. MC /
  // video / interval items are skipped per task spec — they aren't
  // songs a user could have predicted — and admin-created
  // placeholder rows (`type: "song"` but no song row in `it.songs`
  // yet because the operator hasn't filled it in) are ALSO excluded
  // here. Without the `songs.length > 0` half, those placeholders
  // would inflate `total` in `calcPredictScore` and shift the
  // during-show divider past the actual matched count. CR #281
  // caught this. The full `items` list still feeds `<ActualSetlist>`
  // (which renders placeholder + non-song rows).
  const actualSongs = items.filter(
    (it) => it.type === "song" && it.songs.length > 0,
  );

  const body =
    renderedTab === "actual" ? (
      <ActualSetlist
        items={items}
        reactionCounts={reactionCounts}
        locale={locale}
        eventId={eventId}
      />
    ) : (
      <PredictedSetlist
        eventId={eventId}
        locale={locale}
        startTime={startTime}
        status={status}
        actualSongs={actualSongs}
        seriesName={seriesName}
      />
    );

  return (
    <>
      <SetlistTabs
        hasPredictions={hasPredictions}
        hasActual={hasActual}
        activeTab={renderedTab}
        onTabChange={setActiveTab}
        labels={{
          actual: t("tabActual"),
          predicted: t("tabPredicted"),
          tablistAriaLabel: t("tablistAriaLabel"),
        }}
        tabIds={tabIds}
        panelIds={panelIds}
      />
      {hasPredictions ? (
        <div
          role="tabpanel"
          id={renderedPanelId}
          aria-labelledby={renderedTabId}
        >
          {body}
        </div>
      ) : (
        body
      )}
    </>
  );
}
