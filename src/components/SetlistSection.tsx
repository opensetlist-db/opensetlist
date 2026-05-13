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
  /**
   * Share-card header trio (v0.11.5+) — forwarded through to
   * `<ShareCardPreview>`. See `<LiveSetlist>` for the per-field
   * meaning and the iOS-feedback rationale.
   */
  seriesName: string;
  eventTitle: string;
  dateLine: string;
  /**
   * D-7 open-window indicator (Wishlist + Predicted Setlist
   * visibility, from `raw/20260503-1b-1c-timeline.md` §"희망곡/예상곡
   * 표시 조건"). On upcoming events the Predict tab is gated on
   * this — pre-D-7 the tab is hidden even if localStorage has
   * stored predictions for the event. Post-show paths
   * (ongoing/completed) are unaffected; predictions surface from
   * `storedHasPredictions` regardless of this flag, so a fan who
   * predicted within the D-7 window still sees their card after
   * the show ends. See `src/lib/eventTiming.ts#isWishPredictOpen`.
   */
  isWishPredictOpen: boolean;
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
  eventTitle,
  dateLine,
  isWishPredictOpen,
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
  // Predict tab visibility, two-branch gate:
  //   - status === "upcoming": show only when the event is inside
  //     the D-7 open window. The first-time-visitor entry path
  //     (CR #281, Major) survives unchanged within the window;
  //     pre-D-7 the tab is hidden even if localStorage already has
  //     stored predictions for this event (per
  //     `task-week2-d7-open-gate.md` — "Keep the data, just don't
  //     surface the tab"; rare but possible if the event date moved
  //     backward after the user predicted).
  //   - status !== "upcoming" (ongoing/completed/cancelled):
  //     `storedHasPredictions` alone — the D-7 gate is a pre-show
  //     concept, post-show events should still surface a viewer's
  //     own predictions (live-score divider during, share card
  //     after). A viewer who never predicted sees no tab post-show
  //     either — predicting "what was already played" has no value.
  const hasPredictions =
    status === "upcoming" ? isWishPredictOpen : storedHasPredictions;
  // Default to actual when both tabs are visible (case 2) — the
  // viewer's mental model in a during/post-show event is "what's
  // actually playing", not "what I predicted earlier". When only
  // the Predicted tab exists (case 1, pre-show), force the active
  // tab to "predicted" so the body matches the visible tab.
  const [activeTab, setActiveTab] = useState<SetlistTab>("actual");
  // Compute the rendered active-tab key separately so a state mismatch
  // (e.g. activeTab="actual" but hasActual=false) renders the right
  // body without forcing the user-driven activeTab state to chase
  // the hasActual / hasPredictions props.
  //
  // Three-branch fallback (in order):
  //   1. !hasPredictions          → force "actual" (defensive against
  //                                  stale `activeTab="predicted"` on
  //                                  cross-event navigation; CR caught
  //                                  this. Without the guard, navigating
  //                                  from event A — where the user
  //                                  clicked the Predicted tab —
  //                                  to event B with no predictions
  //                                  would render <PredictedSetlist>
  //                                  body while <SetlistTabs hasPredictions=
  //                                  false> renders no tab strip,
  //                                  producing an orphan body.
  //                                  The `key={eventId}` on
  //                                  <PredictedSetlist> resets ITS
  //                                  internal state but doesn't reach
  //                                  <SetlistSection>'s own activeTab.)
  //   2. !hasActual && hasPredictions → force "predicted" (case 1
  //                                  pre-show — Predicted-only).
  //   3. otherwise                 → activeTab (user-driven).
  const renderedTab: SetlistTab = !hasPredictions
    ? "actual"
    : !hasActual
      ? "predicted"
      : activeTab;

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
      // `key={eventId}` forces a remount on event navigation so
      // `<PredictedSetlist>`'s `scheduledLocked` (initialized once
      // via `useState` lazy init from the previous event's
      // startTime) doesn't leak into the new event with a stale
      // lock decision. Also re-fires the localStorage
      // `predict-{eventId}` hydration for the new event. Same
      // rationale as the matching `key={eventId}` on
      // `<EventWishSection>` in `<LiveSetlist>`. CR #291 caught
      // both call sites.
      <PredictedSetlist
        key={eventId}
        eventId={eventId}
        locale={locale}
        startTime={startTime}
        status={status}
        actualSongs={actualSongs}
        seriesName={seriesName}
        eventTitle={eventTitle}
        dateLine={dateLine}
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
