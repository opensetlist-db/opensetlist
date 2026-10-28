"use client";

import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ActualSetlist } from "@/components/ActualSetlist";
import { PredictedSetlist } from "@/components/PredictedSetlist";
import { SetlistTabs, type SetlistTab } from "@/components/SetlistTabs";
import styles from "@/components/event/eventDetail.module.css";
import { useMounted } from "@/hooks/useMounted";
import { hasPredictions as readHasPredictions } from "@/lib/predictionsStorage";
import type {
  LiveSetlistItem,
  ReactionCountsMap,
} from "@/lib/types/setlist";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import type { AvailableSong, UnitFilter } from "@/lib/types/predict";
import type { BoardChip } from "@/lib/board/types";

interface Props {
  eventId: string;
  /**
   * Event primary artist id (stringified BigInt) or null. Forwarded to
   * `<SetlistRow>` for the multi-group-event badge rule — see
   * `pickRowArtistBadges`.
   */
  eventArtistId?: string | null;
  items: LiveSetlistItem[];
  reactionCounts: ReactionCountsMap;
  /**
   * `capturedAt` of the live snapshot `reactionCounts` came from —
   * forwarded to `<ReactionButtons>` for the reaction ack hold.
   * Optional; omitted → pre-n14 behaviour (no hold).
   */
  snapshotCapturedAt?: string | null;
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
  /**
   * Catalog for the song picker in the Predicted tab (forwarded
   * through to `<PredictedSetlist>`). Empty array hides the picker
   * — falls back to the copy-from-past trigger only. See
   * `src/lib/types/predict.ts` for the shape.
   */
  availableSongs: AvailableSong[];
  /** Filter chip set (server-derived). Empty array hides the picker. */
  unitFilters: UnitFilter[];
  /** The board's groups while predicting is open on a board event;
   *  enables the builder's "import my expected songs". Absent → no
   *  import (no board, or outside the window). */
  boardGroups?: readonly BoardChip[];
}

/**
 * Tab-aware body of the "Setlist" card. Sits inside `<LiveSetlist>`'s
 * card, below its header (title is always "Setlist"; the LIVE notice
 * and counts stay visible in every state).
 *
 * The actual setlist is the card's default content and needs no
 * heading of its own. The predicted setlist is something the viewer
 * opts into, so the tab strip (Predicted / Actual) appears only once
 * they have:
 *
 *   - upcoming, window open, not participated → the actual body (the
 *     "filled in live from …" note) plus a "Make a setlist prediction"
 *     button. Pressing it opens the tabs on Predicted.
 *   - upcoming, window open, participated (a stored list, or the button
 *     pressed this visit) → tabs, Predicted selected first: before the
 *     show the actual tab only holds the "filled in live" note.
 *   - ongoing / completed / cancelled, participated → tabs, Actual
 *     selected first (what is being played is the point now); the
 *     viewer can switch to their prediction and its score.
 *   - anything else → the actual body alone, no tabs.
 *
 * "Participated" for a stored list is a client-only signal
 * (localStorage); SSR and the first client render see `false`, so the
 * server markup is always the no-tab shape and the tabs appear after
 * hydration. Outside the window the Predict tab stays hidden even when
 * a list is stored ("keep the data, don't surface the tab": an event
 * whose date moved back after the viewer predicted).
 */
export function SetlistSection({
  eventId,
  items,
  reactionCounts,
  snapshotCapturedAt,
  locale,
  status,
  startTime,
  seriesName,
  eventTitle,
  dateLine,
  isWishPredictOpen,
  emptyFallback,
  availableSongs,
  unitFilters,
  eventArtistId,
  boardGroups,
}: Props) {
  const t = useTranslations("Setlist");
  const mounted = useMounted();

  // Hydrate the stored-list flag AFTER mount so SSR + first client
  // render produce matching HTML (false). The project's canonical
  // render-time pattern (src/hooks/useMounted.ts), not an effect —
  // `react-hooks/set-state-in-effect` is what `useMounted` exists to
  // avoid. Reviewers sometimes flag this; it is intentional.
  const [storedHasPredictions, setStoredHasPredictions] = useState(false);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  // "Make a setlist prediction" pressed on this visit. Keyed by event
  // so a client-side navigation to another event starts closed again.
  const [startedFor, setStartedFor] = useState<string | null>(null);
  // The viewer's own tab choice; null = the status default below.
  const [chosenTab, setChosenTab] = useState<{
    eventId: string;
    tab: SetlistTab;
  } | null>(null);
  if (mounted && hydratedKey !== eventId) {
    setHydratedKey(eventId);
    setStoredHasPredictions(readHasPredictions(eventId));
  }

  const hasActual = items.length > 0;
  const canPredictNow = status === "upcoming" && isWishPredictOpen;
  const started = startedFor === eventId;
  const showTabs = canPredictNow
    ? storedHasPredictions || started
    : status !== "upcoming" &&
      (storedHasPredictions || (started && readHasPredictions(eventId)));
  const defaultTab: SetlistTab = canPredictNow ? "predicted" : "actual";
  const renderedTab: SetlistTab = !showTabs
    ? "actual"
    : chosenTab?.eventId === eventId
      ? chosenTab.tab
      : defaultTab;

  // WAI-ARIA tabs pattern needs paired tab/panel ids. `useId()` runs
  // unconditionally (Rules of Hooks).
  const baseId = useId();
  const tabIds = {
    actual: `${baseId}-tab-actual`,
    predicted: `${baseId}-tab-predicted`,
  };
  const panelIds = {
    actual: `${baseId}-panel-actual`,
    predicted: `${baseId}-panel-predicted`,
  };

  // Song-type rows that also have a song picked. MC / video / interval
  // items aren't songs a viewer could have predicted, and admin-created
  // placeholder rows (`type: "song"`, no song yet) would inflate `total`
  // in `calcPredictScore` and shift the during-show divider. The full
  // `items` list still feeds `<ActualSetlist>`.
  const actualSongs = items.filter(
    (it) => it.type === "song" && it.songs.length > 0,
  );

  const actualBody = hasActual ? (
    <ActualSetlist
      items={items}
      reactionCounts={reactionCounts}
      snapshotCapturedAt={snapshotCapturedAt}
      locale={locale}
      eventId={eventId}
      status={status}
      eventArtistId={eventArtistId}
    />
  ) : (
    emptyFallback
  );

  if (!showTabs) {
    return (
      <>
        {actualBody}
        {canPredictNow && (
          <button
            type="button"
            data-testid="predict-start"
            onClick={() => {
              setStartedFor(eventId);
              setChosenTab({ eventId, tab: "predicted" });
            }}
            className={styles.secondaryButton}
          >
            {t("startPredict")}
          </button>
        )}
      </>
    );
  }

  const body =
    renderedTab === "actual" ? (
      actualBody
    ) : (
      // `key={eventId}` remounts on event navigation so the builder's
      // lock decision and its localStorage read never leak from the
      // previous event.
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
        availableSongs={availableSongs}
        unitFilters={unitFilters}
        boardGroups={boardGroups}
      />
    );

  return (
    <>
      <SetlistTabs
        activeTab={renderedTab}
        onTabChange={(tab) => setChosenTab({ eventId, tab })}
        labels={{
          actual: t("tabActual"),
          predicted: t("tabPredicted"),
          tablistAriaLabel: t("tablistAriaLabel"),
        }}
        tabIds={tabIds}
        panelIds={panelIds}
      />
      <div
        role="tabpanel"
        id={renderedTab === "actual" ? panelIds.actual : panelIds.predicted}
        aria-labelledby={
          renderedTab === "actual" ? tabIds.actual : tabIds.predicted
        }
      >
        {body}
      </div>
    </>
  );
}
