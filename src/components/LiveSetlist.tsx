"use client";

import { useTranslations } from "next-intl";
import { TrendingSongs, type TrendingSong } from "@/components/TrendingSongs";
import { SetlistSection } from "@/components/SetlistSection";
import { deriveTrendingSongs } from "@/lib/trending";
import { deriveSongsCount } from "@/lib/sidebarDerivations";
import styles from "@/components/event/eventDetail.module.css";
// Setlist-shape types live in `src/lib/types/setlist.ts` so pure
// helpers under `src/lib/` can describe them without importing from
// `src/components/`. Re-exported below for back-compat with existing
// import sites that pull `LiveSetlistItem` / `ArtistRef` /
// `StageIdentityRef` from this file.
import type {
  FanTop3Entry,
  LiveSetlistItem,
  ReactionCountsMap,
} from "@/lib/types/setlist";
import { EventWishSection } from "@/components/EventWishSection";
import { FanBoardSection } from "@/components/board/FanBoardSection";
import type { BoardBlockSeed } from "@/lib/board/types";
import { LiveSyncIndicator } from "@/components/LiveSyncIndicator";
import type { Freshness } from "@/lib/snapshotFreshness";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import type { AvailableSong, UnitFilter } from "@/lib/types/predict";

/** Venue-local start pieces from `formatVenueStart` (server-formatted). */
export interface VenueStartLabel {
  date: string;
  time: string;
  zone: string;
}

export type {
  ArtistRef,
  StageIdentityRef,
  LiveSetlistItem,
} from "@/lib/types/setlist";

interface Props {
  eventId: string;
  /**
   * Event primary artist id (stringified BigInt) or null. Forwarded to
   * `<SetlistRow>` for the multi-group-event badge rule — see
   * `pickRowArtistBadges`.
   */
  eventArtistId?: string | null;
  // Polled state — owned by the parent `LiveEventLayout` so a single
  // `useSetlistPolling` call drives both columns. Before the lift,
  // this component owned its own polling subscription via
  // `useSetlistPolling(initialItems, initialReactionCounts, ...)`; now
  // it's a pure render component for the right column and accepts the
  // already-polled values. See `src/components/LiveEventLayout.tsx`.
  items: LiveSetlistItem[];
  reactionCounts: ReactionCountsMap;
  /** Polled fan TOP-3 wishes (Phase 1B). Pre-show + ongoing both update. */
  top3Wishes: FanTop3Entry[];
  initialTrendingSongs: TrendingSong[];
  /**
   * Event start time (UTC). Threaded through to `<EventWishSection>`
   * so the wishlist surface can flip from pre-show → locked at the
   * UTC instant. Same shape as `LiveEventLayout` Props (Date | string).
   */
  startTime: Date | string | null;
  unknownSongLabel: string;
  isOngoing: boolean;
  locale: string;
  /**
   * Resolved event status (`"upcoming" | "ongoing" | "completed" |
   * "cancelled"`). Threaded into `<SetlistSection>` so
   * `<PredictedSetlist>` can switch its three modes (pre-show /
   * during-show / post-show share button).
   */
  status: ResolvedEventStatus;
  /**
   * D-7 open-window indicator. **Pre-show only** — gates the
   * Wishlist + Predicted Setlist surfaces against the 7-day
   * picker-UI window. For non-upcoming statuses
   * (ongoing/completed/cancelled) this flag does NOT govern
   * visibility; the locked TOP-3 display + post-show share card
   * always render once the show has started, regardless of
   * D-window distance (`task-week2-d7-open-gate.md`:
   * "Post-lock display [...] is NOT gated"). The render
   * conditions below mirror that split: upcoming branch defers to
   * this flag, non-upcoming branch falls through. See
   * `src/lib/eventTiming.ts#isWishPredictOpen`.
   */
  isWishPredictOpen: boolean;
  /**
   * Fan board seed (n15) — null/omitted when the board is off (or,
   * upcoming, before the wish/predict window opens). The block mounts
   * only while `status` is upcoming (window open) or completed: the
   * status here is the client's effective one, so a page that crosses
   * into the show unmounts the board (no board request while ongoing)
   * and brings the event-wide wishlist back in its place.
   */
  board?: BoardBlockSeed | null;
  /**
   * Share-card header trio (v0.11.5+). Forwarded through to
   * `<ShareCardPreview>` so the captured PNG identifies the event
   * correctly. The page already runs the i18n cascade for the
   * EventHeader card; reused here rather than re-doing it inside
   * the predict surface.
   *
   *   - `seriesName`: localized series name when the event belongs to
   *     a series; empty string otherwise (preview hides the row).
   *   - `eventTitle`: the event-specific identifier (e.g.
   *     "Day 2 · Marine Messe Fukuoka"). Always present.
   *   - `dateLine`: locale-formatted "date · venue · city" with empty
   *     segments dropped.
   *
   * Pre-v0.11.5 only `seriesName` was threaded; the share-card
   * synthesized a placeholder `eventTitle = seriesName` which made
   * the captured PNG show the series name twice and no actual event
   * identifier. Operator-spotted on iOS testing.
   */
  seriesName: string;
  eventTitle: string;
  dateLine: string;
  /**
   * Catalog + filter chips for the predicted-tab song picker.
   * Threaded through to `<SetlistSection>` → `<PredictedSetlist>`.
   * Empty arrays hide the picker (multi-artist festival, non-
   * upcoming status, or empty artist catalog).
   */
  availableSongs: AvailableSong[];
  unitFilters: UnitFilter[];
  /**
   * Venue-local start (「11月14日 16:30 JST」 pieces), formatted on the
   * server so SSR and hydration render identical text. Drives the
   * upcoming empty-state copy. Null → generic fallback.
   */
  setlistStartLabel?: VenueStartLabel | null;
  /** When the predict/wish window opens; null once open or n/a. */
  predictOpensLabel?: VenueStartLabel | null;
  /**
   * Sync health of this browser's live data (from
   * `useRealtimeEventChannel`). Rendered beside the LIVE pill on
   * ongoing events only. Optional so non-live callers/tests can omit.
   */
  freshness?: Freshness;
  /**
   * `capturedAt` of the live snapshot `reactionCounts` came from —
   * forwarded to `<ReactionButtons>` for the reaction ack hold.
   * Optional; omitted → pre-n14 behaviour (no hold).
   */
  snapshotCapturedAt?: string | null;
}

export function LiveSetlist({
  eventId,
  items,
  reactionCounts,
  top3Wishes,
  initialTrendingSongs,
  startTime,
  unknownSongLabel,
  isOngoing,
  locale,
  status,
  isWishPredictOpen,
  board = null,
  seriesName,
  eventTitle,
  dateLine,
  availableSongs,
  unitFilters,
  eventArtistId,
  setlistStartLabel = null,
  predictOpensLabel = null,
  freshness,
  snapshotCapturedAt,
}: Props) {
  const t = useTranslations("Event");
  const detailT = useTranslations("EventDetail");

  // The board block and the setlist card sit one above the other with no
  // buttons between them (a "go to full setlist mode" button read as a
  // mode switch for what is just the next card, and "put on the board"
  // was more UI than it was worth). The one link left: the builder can
  // import the viewer's board expected songs, so it gets the board's
  // groups (their order groups the imported songs) while predicting is
  // open — upcoming and inside the D-7 window, the same gate
  // `<SetlistSection>` uses.
  const boardAnchorId = `fan-board-${eventId}`;
  const setlistAnchorId = `setlist-card-${eventId}`;
  const importableBoard =
    board !== null && status === "upcoming" && isWishPredictOpen ? board : null;

  // While polling, derive trending from the same reactionCounts that drives
  // per-item counts — single source of truth, no risk of the two views
  // drifting. When polling is off (upcoming/completed events) we keep the
  // SSR seed; no recompute, no behavior change.
  const trendingSongs = isOngoing
    ? deriveTrendingSongs(items, reactionCounts, locale, unknownSongLabel)
    : initialTrendingSongs;

  // Items + songs counters for the desktop subtitle. `deriveSongsCount`
  // is the single source of truth shared with the sidebar's "X songs"
  // pill (`EventHeader.songsCount`) — an admin-created placeholder
  // song-typed item with no song picked yet doesn't get counted, so
  // the two surfaces can't drift.
  const itemCount = items.length;
  const songCount = deriveSongsCount(items);

  // Status-aware empty state. The old single 「세트리스트가 등록되지
  // 않았습니다」 read like a missing resource — on a pre-show page that,
  // plus the zero counters, is the Soft 404 pattern Google flagged.
  // Upcoming says *when* the setlist will appear; completed keeps
  // "not yet"; ongoing/cancelled keep the original wording.
  const emptyMessages: string[] =
    status === "upcoming" && setlistStartLabel
      ? [
          t("setlistUpcoming", { ...setlistStartLabel }),
          ...(predictOpensLabel
            ? [t("predictOpensAt", { ...predictOpensLabel })]
            : []),
        ]
      : status === "completed"
        ? [t("setlistNotRecorded")]
        : [t("noSetlist")];

  // Fan board (n15) and the event-wide wishlist are mutually exclusive
  // and decided by ONE condition: on a board event the board's "want"
  // column replaces the wishlist while upcoming or completed (n15);
  // while ongoing the board is not mounted and today's wishlist renders
  // instead — its overall TOP3 is part of the live payload, unchanged.
  //
  // Upcoming also needs the wish/predict window open — the page already
  // withholds the seed before it (one open date for all three
  // surfaces); checking here too keeps this component honest on its
  // own, so a seed handed in early can't mount a board ahead of the
  // wishlist and Predict tab it shares a date with.
  const showBoard =
    board != null &&
    ((status === "upcoming" && isWishPredictOpen) || status === "completed");

  // Participation (wishlist or fan board) leads the page while the show
  // is upcoming — that is what a visitor can still act on. Once the show
  // has started the actual setlist leads and the locked wishes follow it
  // (18-v3: open → board first; LIVE / completed → setlist first).
  const participationFirst = status === "upcoming";

  const participation = (
    <>
      {/* Wishlist (Phase 1B) sits at the very top of the right column,
          above Trending — per `raw/mockups/mockup-wish-predict.jsx`.
          Self-hides when locked + no data; renders structurally on
          SSR so hydration matches before localStorage hydrates the
          my-list.

          D-7 gate is **pre-show only** (per
          `task-week2-d7-open-gate.md` + `engagement-features#D-7
          visibility gate`): "Post-lock display (results, match
          badges) is NOT gated — once the show happens, the result
          view stays visible regardless of D-window distance." The
          condition below mirrors `<SetlistSection>`'s split: when
          `status === "upcoming"`, defer to `isWishPredictOpen`
          (pre-show D-7 window); for any other status (ongoing /
          completed / cancelled), render unconditionally and let
          `<EventWishSection>` itself collapse to null on
          locked-with-no-data. The original v0.10.0 implementation
          gated on `isWishPredictOpen` alone, which hid the
          locked TOP-3 display entirely on every ongoing /
          completed event — broken because `isWishPredictOpen`
          returns false for any non-upcoming status by design.

          The explicit `startTime != null` guard looks redundant in
          the upcoming branch (the helper rejects null start) but
          is load-bearing for the non-upcoming branch — and it
          gives TS a narrowing it can use to drop the cast on the
          prop pass-through. */}
      {!showBoard &&
        startTime != null &&
        (status !== "upcoming" || isWishPredictOpen) && (
          // `key={eventId}` forces a remount when the user navigates
          // from event A to event B in the same browser session.
          // Without it, React's default reconciliation preserves
          // `<EventWishSection>`'s state across the prop change —
          // which means `scheduledLocked` (initialized once via
          // `useState` lazy init from event A's startTime) leaks
          // into event B with a stale lock decision, and the
          // localStorage `wish-{eventId}` hydration also wouldn't
          // re-fire for the new event id. CR #291 caught this.
          <EventWishSection
            key={eventId}
            eventId={eventId}
            locale={locale}
            startTime={startTime}
            status={status}
            setlistItems={items}
            top3Wishes={top3Wishes}
          />
        )}
      {/* Fan board (n15): in the wishlist's place (see `showBoard`).
          Upcoming: the operator's flag AND the same open window as the
          wishlist / Predict tab. Never mounted while ongoing/cancelled
          (see the `board` prop). */}
      {showBoard && board && (
          <FanBoardSection
            key={eventId}
            eventId={eventId}
            locale={locale}
            seed={board}
            catalog={availableSongs}
            anchorId={boardAnchorId}
          />
        )}
    </>
  );

  return (
    <>
      {/* Pre-window (18-v3 pre state): when participation opens, as its
          own notice above the setlist card. Same venue-local label the
          empty-card copy below uses (`predictOpensLabel`, set only while
          the window is still ahead). */}
      {status === "upcoming" && !isWishPredictOpen && predictOpensLabel && (
        <div className={styles.notice} data-testid="predict-opens-notice">
          <strong>{detailT("opensTitle")}</strong>
          {detailT("opensBody")}
          <p>
            {predictOpensLabel.date} {predictOpensLabel.time} ({predictOpensLabel.zone})
          </p>
        </div>
      )}
      {participationFirst && participation}
      {/* Trending sits ABOVE the setlist card as its own surface (amber
          tokens), per mockup. Not a child of the white setlist card.

          Visibility (operator preference, v0.10.0 smoke):
            - upcoming → always hide (no reactions can have been
              recorded yet; the empty-state nudge that the component
              renders for `songs.length === 0` is irrelevant pre-show
              and dilutes the page)
            - ongoing / completed / cancelled → show only when there
              is at least one ranked song; otherwise hide entirely
              rather than rendering the empty-state nudge.

          The visibility decision lives here, in this single consumer;
          `<TrendingSongs>` keeps its own empty-array nudge only as a
          defensive fallback for a caller that mounts it with no songs. */}
      {status !== "upcoming" && trendingSongs.length > 0 && (
        <TrendingSongs songs={trendingSongs} />
      )}
    <section
      id={setlistAnchorId}
      aria-labelledby={`${setlistAnchorId}-title`}
      className={`${styles.panel} ${styles.setlistPanel}`}
    >
      <div className={styles.panelHead}>
        <h2 id={`${setlistAnchorId}-title`} className={styles.panelTitle}>
          {/* Always "Setlist": the actual / predicted split lives in the
              tabs inside the card, not in its title. */}
          {t("setlist")}
        </h2>
        {/* Counts only once there are items: "0 items · 0 songs" is
            noise (and zero-stats feed the Soft 404 read). */}
        {itemCount > 0 && (
          <span className={styles.panelCount}>
            {t("itemsLabel", { count: itemCount })} ·{" "}
            {t("songsValue", { count: songCount })}
          </span>
        )}
      </div>
      {/* Live notice (18-v3 `.live-top`). The LIVE pill itself is in
          the page Hero; here the card says the list is being filled in
          and how fresh this browser's copy is. */}
      {isOngoing && (
        <div className={styles.liveNotice} data-testid="setlist-live-notice">
          <strong>{detailT("liveNotice")}</strong>
          {freshness && (
            <LiveSyncIndicator freshness={freshness} locale={locale} />
          )}
        </div>
      )}

      {/* Tab-aware body. When `predict-{eventId}` is in localStorage,
          a tab strip renders BELOW this section's header (the SETLIST
          h2 + LIVE pill stay visible — see SetlistSection's docstring
          for the rationale). When no predictions, renders only the
          ActualSetlist body — byte-equivalent to pre-refactor.

          `emptyFallback` is delegated INTO SetlistSection (not gated
          here) so the predictions-but-no-actual case (Stage C, case 1
          per the task matrix) can still render the Predicted-only
          tab. CodeRabbit caught this on PR #280 — the prior
          `items.length === 0 → noSetlist` short-circuit would have
          starved that path the day Stage C lands the prediction
          writer. */}
      <SetlistSection
        eventId={eventId}
        items={items}
        reactionCounts={reactionCounts}
        snapshotCapturedAt={snapshotCapturedAt}
        locale={locale}
        status={status}
        startTime={startTime}
        seriesName={seriesName}
        eventTitle={eventTitle}
        dateLine={dateLine}
        isWishPredictOpen={isWishPredictOpen}
        emptyFallback={
          <div>
            {emptyMessages.map((msg, i) => (
              <p key={i} className={styles.emptyCopy}>
                {msg}
              </p>
            ))}
          </div>
        }
        availableSongs={availableSongs}
        unitFilters={unitFilters}
        eventArtistId={eventArtistId}
        boardGroups={importableBoard?.chips}
      />
    </section>
      {!participationFirst && participation}
    </>
  );
}


// `SetlistColumnHeader` + `EncoreDivider` moved to `<ActualSetlist>`
// as part of the Stage B SetlistSection refactor — they only render
// alongside the actual-setlist body, so co-locating them with that
// body keeps `<LiveSetlist>` focused on the section-card chrome.
