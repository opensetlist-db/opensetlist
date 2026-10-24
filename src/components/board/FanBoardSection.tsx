"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { trackEvent } from "@/lib/analytics";
import { absoluteUrl, entityPath } from "@/lib/seo/entityUrl";
import { BOARD_TIMEOUT_MS } from "@/lib/board/config";
import { boardFragment, groupIdFromFragment } from "@/lib/board/fragment";
import { buildBoardCopyText } from "@/lib/board/copyText";
import {
  importBoardPicksToPredictions,
  type BoardToBuilderOutcome,
} from "@/lib/board/toPredictions";
import type {
  BoardBlockSeed,
  BoardGroupTally,
  BoardGroupView,
  BoardReadResponse,
  BoardShortlistEntry,
  BoardTally,
  BoardTopEntry,
} from "@/lib/board/types";
import {
  BOARD_PICKS_PER_GROUP,
  BOARD_WISHES_PER_GROUP,
} from "@/lib/board/config";
import type { AvailableSong } from "@/lib/types/predict";
import type { WishEntry } from "@/lib/wishStorage";
import { displayOriginalTitle } from "@/lib/display";
import { colors } from "@/styles/tokens";
import styles from "@/components/event/eventDetail.module.css";
import { BoardMyPicks } from "@/components/board/BoardMyPicks";
import { pickTitle } from "@/lib/board/pickTitle";
import {
  useBoardBallot,
  type BallotEntry,
  type BallotKind,
  type PickOutcome,
} from "@/components/board/useBoardBallot";
import { pickFailureKey } from "@/lib/board/ballotClient";

/**
 * Fan board block (n15).
 *
 * Isolation contract (why it is shaped like this):
 *   - The server render hands over only the seed (lock time + chips);
 *     the aggregate is fetched here, after mount, so the board can
 *     never slow or 500 the event page.
 *   - The fetch gives up after `BOARD_TIMEOUT_MS`; a timeout, network
 *     error or non-2xx collapses the block to ONE line and nothing else
 *     on the page changes.
 *   - A `{ enabled: false }` answer (the operator just turned the board
 *     off) or a locked stub (the show started) removes the block
 *     entirely — the page simply looks like a non-board event.
 *   - The parent never mounts this while the event is ongoing, so no
 *     board request is made during a show.
 *
 * Each group shows two columns side by side (n15): "want" (wishes)
 * and "expect" (picks), each with its crowd TOP3 and the fan's own
 * entries. On a board event this block replaces the event-wide
 * wishlist before and after the show; during the show the page
 * renders the wishlist instead (and never mounts this).
 *
 * After the show (completed) the same block is in result mode:
 * the expect column lists each group's shortlist — its TOP3 at the
 * lock — graded ✓/✕ against the final setlist with "N of K played",
 * an overall line sits at the top, and my own picks that were played
 * are highlighted. A group nobody picked is not graded (its starters,
 * operator copy, keep their usual ungraded rendering).
 */

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "hidden" }
  | {
      kind: "ready";
      locked: boolean;
      refreshFailed: boolean;
      groups: BoardGroupView[];
      /** The post-show tally; null before the show. */
      tally: BoardTally | null;
    };

/** Everything that differs between the two columns of a group, in one
 *  place (n15): which aggregate column, its heading, its analytics
 *  name and its feedback copy. */
const COLUMN = {
  wish: {
    field: "wishes",
    name: "want",
    heading: "colWant",
    mineBadge: "mineWishBadge",
    added: "addedWish",
    removed: "removedWish",
  },
  pick: {
    field: "expects",
    name: "expect",
    heading: "colExpect",
    mineBadge: "mineBadge",
    added: "added",
    removed: "removed",
  },
} as const;

const TOAST_MS = 3000;
const MAX_TIMEOUT_MS = 2147483647; // 2^31 − 1, setTimeout's ceiling
// Stable default so the per-group filter memo doesn't recompute on
// every render when the page passes no catalog.
const NO_CATALOG: readonly AvailableSong[] = [];

export function FanBoardSection({
  eventId,
  locale,
  seed,
  catalog = NO_CATALOG,
  anchorId,
  onOpenFullSetlist,
  picksRevision = 0,
}: {
  eventId: string;
  locale: string;
  seed: BoardBlockSeed;
  /** The page's picker catalog (base songs; on a festival each row
   *  carries its `festivalGroupIds`). Empty when the page has none —
   *  then the add control is hidden. */
  catalog?: readonly AvailableSong[];
  /** Element id for the block, so the Predict tab's "back to board"
   *  switch can scroll here. Must not start with `board-` (see
   *  `fragment.ts`: the group fragment matches no element on purpose). */
  anchorId?: string;
  /** "Go to full setlist mode" (n15). Passed only while the Predict
   *  tab exists (upcoming, inside the D-7 window); without it the
   *  button is not rendered. Called after the import ran. */
  onOpenFullSetlist?: (outcome: BoardToBuilderOutcome) => void;
  /** Bumped by `<LiveSetlist>` after the Predict tab published a ballot
   *  (n15), so "my picks" re-read the local copy it wrote. */
  picksRevision?: number;
}) {
  const t = useTranslations("Board");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [activeId, setActiveId] = useState<string | null>(
    seed.chips[0]?.groupId ?? null,
  );
  const sectionRef = useRef<HTMLElement>(null);
  const viewed = useRef(new Set<string>());
  const scrolledForHash = useRef(false);
  const appliedHash = useRef<string | null>(null);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  // Set at the lock time (timer below) or by a write refused with
  // `board_locked`: flips the block to read-only without a reload.
  const [lockedByServer, setLockedByServer] = useState(false);
  const ballot = useBoardBallot({
    eventId,
    locale,
    active: state.kind === "ready",
    revision: picksRevision,
  });

  // A tab left open across the start time goes read-only AT the start
  // time, not after its first refused write. setTimeout's delay is a
  // 32-bit int (~24.8 days; larger values fire immediately), so a lock
  // further out is reached in hops: each hop waits at most the cap and
  // re-arms with the time still remaining.
  useEffect(() => {
    const lockMs = new Date(seed.lockAt).getTime();
    if (!Number.isFinite(lockMs)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const ms = lockMs - Date.now();
      if (ms <= 0) {
        setLockedByServer(true);
        return;
      }
      timer = setTimeout(arm, Math.min(ms, MAX_TIMEOUT_MS));
    };
    arm();
    return () => clearTimeout(timer);
  }, [seed.lockAt]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  // On a festival every catalog row lists the groups it belongs to; on
  // a single-artist event `festivalGroupIds` is empty everywhere and
  // the whole catalog is the one group's.
  const isFestivalCatalog = useMemo(
    () => catalog.some((s) => s.festivalGroupIds.length > 0),
    [catalog],
  );
  const songsOf = useCallback(
    (groupId: string) =>
      isFestivalCatalog
        ? catalog.filter((s) => s.festivalGroupIds.includes(Number(groupId)))
        : catalog,
    [catalog, isFestivalCatalog],
  );

  // Reads are event-driven: mount, publish, and my accepted writes.
  // Invalidate an in-flight read as soon as a write starts. Concurrent
  // writes share one follow-up read after all settle; response order
  // can never restore a snapshot from before the latest action.
  const readSession = useRef<{
    refresh: () => void;
    beginWrite: () => (saved: boolean) => void;
  } | null>(null);
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let writes = 0;
    let dirty = false;
    let controller: AbortController | null = null;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const cancelRead = () => {
      generation++;
      clearTimeout(deadline);
      controller?.abort();
      controller = null;
    };
    const refresh = async () => {
      if (disposed) return;
      if (writes > 0) { dirty = true; return; }
      dirty = false;
      cancelRead();
      const ownGeneration = generation;
      const request = new AbortController();
      controller = request;
      deadline = setTimeout(() => request.abort(), BOARD_TIMEOUT_MS);
      try {
        const params = new URLSearchParams({ locale });
        const res = await fetch(`/api/events/${eventId}/board?${params}`, {
          signal: request.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as BoardReadResponse;
        if (disposed || ownGeneration !== generation || request.signal.aborted) return;
        if (!body.enabled || !("groups" in body)) {
          setState({ kind: "hidden" });
          return;
        }
        setState({
          kind: "ready",
          locked: body.locked,
          refreshFailed: false,
          groups: body.groups,
          tally: body.status === "completed" ? body.tally : null,
        });
      } catch {
        if (!disposed && ownGeneration === generation) {
          // A failed read does not undo a committed ballot. Retain the
          // current board and offer an explicit retry, without polling.
          setState((previous) => previous.kind === "ready"
            ? { ...previous, refreshFailed: true }
            : { kind: "error" });
        }
      } finally {
        if (ownGeneration === generation) {
          clearTimeout(deadline);
          controller = null;
        }
      }
    };
    const session = {
      refresh: () => { void refresh(); },
      beginWrite: () => {
        writes++;
        // If a previous successful action's read was still running,
        // it needs a replacement even if this new write is refused.
        dirty ||= controller !== null;
        cancelRead();
        return (saved: boolean) => {
          writes--;
          dirty ||= saved;
          if (!disposed && writes === 0 && dirty) void refresh();
        };
      },
    };
    readSession.current = session;
    session.refresh();
    return () => {
      disposed = true;
      cancelRead();
      if (readSession.current === session) readSession.current = null;
    };
  }, [eventId, locale]);

  // Publishing the Predict ballot can finish while a wish write is
  // still pending. Keep the same read session so both changes share
  // its pending-write barrier, rather than dropping that barrier.
  const previousPicksRevision = useRef(picksRevision);
  useEffect(() => {
    if (previousPicksRevision.current === picksRevision) return;
    previousPicksRevision.current = picksRevision;
    readSession.current?.refresh();
  }, [picksRevision]);

  const mutate = async (action: () => Promise<PickOutcome>) => {
    const complete = readSession.current?.beginWrite();
    let saved = false;
    try {
      const outcome = await action();
      saved = outcome.ok;
      return outcome;
    } finally {
      complete?.(saved);
    }
  };

  const groups: readonly { groupId: string; slug: string }[] =
    state.kind === "ready" ? state.groups : seed.chips;

  // `#board-<slug>` selects a group — on load and on later hash changes
  // (a fan following a second shared link in the same tab).
  useEffect(() => {
    const apply = () => {
      const hash = window.location.hash;
      const id = groupIdFromFragment(hash, groups);
      if (id) setActiveId(id);
      // A seed may lag the aggregate, so retry an unresolved initial
      // fragment once the groups arrive. Refreshing counts must never
      // reapply a resolved fragment over a fan's later chip selection.
      if (id || state.kind === "ready") appliedHash.current = hash;
      return id;
    };
    if (appliedHash.current !== window.location.hash) apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [groups, state.kind]);

  // A shared link should land ON the board: once the content is there
  // (so the layout won't shift under the scroll), bring it into view.
  useEffect(() => {
    if (state.kind !== "ready" || scrolledForHash.current) return;
    if (!groupIdFromFragment(window.location.hash, state.groups)) return;
    scrolledForHash.current = true;
    sectionRef.current?.scrollIntoView?.({ block: "start" });
  }, [state]);

  // The active id may point at a group the fresh response no longer
  // has (seed/aggregate drift across a deploy or TTL); fall back to the
  // first group rather than rendering nothing.
  const readyGroups = state.kind === "ready" ? state.groups : [];
  const active =
    readyGroups.find((g) => g.groupId === activeId) ?? readyGroups[0] ?? null;

  useEffect(() => {
    if (!active || viewed.current.has(active.groupId)) return;
    viewed.current.add(active.groupId);
    trackEvent("board_view", { event_id: eventId, group_id: active.groupId });
  }, [active, eventId]);

  // Hidden (the board answered "off" or "already started") removes the
  // block entirely. The error state below keeps `anchorId` so the page's
  // jump link still lands on the board's place.
  if (state.kind === "hidden") return null;
  if (state.kind === "error") {
    // 18-v3 board-failure: the board's own panel says it could not
    // load; the rest of the page (info, setlist, impressions) is
    // unaffected — the aggregate is a client fetch after mount.
    return (
      <section
        id={anchorId}
        aria-labelledby={`board-title-${eventId}`}
        className={`${styles.panel} ${styles.participatePanel}`}
      >
        <h2 id={`board-title-${eventId}`} className={styles.panelTitle}>
          {t("title")}
        </h2>
        <p role="status" className={styles.boardLead}>
          {t("loadError")}
        </p>
      </section>
    );
  }

  const chips = state.kind === "ready" ? state.groups.map((g) => ({
    groupId: g.groupId,
    label: g.name,
    color: g.color,
  })) : seed.chips;
  const activeChipId = active?.groupId ?? activeId;
  const locked = state.kind === "ready" && (state.locked || lockedByServer);
  const tally = state.kind === "ready" ? state.tally : null;
  // A group is graded only when it HAS a shortlist: zero picks at the
  // lock means nothing to grade, not "0 of 0".
  const gradedOf = (groupId: string) =>
    tally?.groups.find((g) => g.groupId === groupId && g.size > 0) ?? null;
  const playedIds = tally ? new Set(tally.playedSongIds) : null;

  const listOf = (kind: BallotKind) =>
    kind === "pick" ? ballot.picks : ballot.wishes;
  const capOf = (kind: BallotKind) =>
    kind === "pick" ? BOARD_PICKS_PER_GROUP : BOARD_WISHES_PER_GROUP;
  // Song ids with a write in flight, per column.
  const pendingOf = (kind: BallotKind) =>
    new Set(
      [...ballot.pending]
        .filter((k) => k.startsWith(kind + ":"))
        .map((k) => k.slice(kind.length + 1)),
    );

  const report = (outcome: PickOutcome, group: string, kind: BallotKind) => {
    if (outcome.ok) {
      const text =
        outcome.kind === "added"
          ? t(COLUMN[kind].added, { group })
          : t(COLUMN[kind].removed);
      setToast({ text, error: false });
      return;
    }
    if (outcome.reason === "board_locked") setLockedByServer(true);
    setToast({
      text: t(pickFailureKey(outcome.reason), { max: capOf(kind) }),
      error: true,
    });
  };

  const handleAdd = async (
    kind: BallotKind,
    group: BoardGroupView,
    song: AvailableSong,
  ) => {
    const songId = String(song.songId);
    const list = listOf(kind);
    // Two refusals the client can see coming — answered locally with the
    // same message the server would send, without a request.
    if (list.some((p) => p.songId === songId && p.groupId !== group.groupId)) {
      report({ ok: false, reason: "group_conflict" }, group.name, kind);
      return;
    }
    if (
      !list.some((p) => p.songId === songId) &&
      list.filter((p) => p.groupId === group.groupId).length >= capOf(kind)
    ) {
      report({ ok: false, reason: "cap_reached" }, group.name, kind);
      return;
    }
    report(
      await mutate(() => ballot.add(kind, group.groupId, songId, pickTitle(song, locale))),
      group.name,
      kind,
    );
  };

  const handleRemove = async (
    kind: BallotKind,
    group: BoardGroupView,
    entry: BallotEntry,
  ) => {
    report(await mutate(() => ballot.remove(kind, entry)), group.name, kind);
  };

  const handleRemoveLegacy = async (entry: WishEntry) => {
    const outcome = await mutate(() => ballot.removeLegacyWish(entry));
    if (outcome.ok) {
      setToast({ text: t("removedWish"), error: false });
      return;
    }
    report(outcome, "", "wish");
  };

  // "Copy my picks" (n15). Titles are re-localized from the live
  // catalog where the page has one, so the post matches what the board
  // shows even when the pick was added in another locale; a song that
  // dropped out of the catalog (moderated) is left out, mirroring how
  // "my picks" renders it unavailable (the builder drops unavailable
  // picks; this only folds the live catalog into the flag). The check
  // is per group, exactly as `<BoardMyPicks>` gets `songsOf(groupId)`:
  // on a festival a song can leave one group's catalog while staying
  // in another's. An empty group catalog (completed events, a festival
  // with no roster) is "no catalog", so the stored flag stands — `[]`
  // can't tell "nothing in scope" from "everything deleted". The text
  // is computed every render so the disabled state and the copied text
  // can't disagree.
  const catalogById = new Map(catalog.map((s) => [String(s.songId), s]));
  const copyablePicks = ballot.picks.map((p) => {
    const groupSongs = songsOf(p.groupId);
    return groupSongs.length === 0 ||
      groupSongs.some((s) => String(s.songId) === p.songId)
      ? p
      : { ...p, available: false };
  });
  const copyResult =
    state.kind === "ready" && active
      ? buildBoardCopyText({
          t,
          eventName: seed.share.eventName,
          // The open group's fragment, so a reader of the post lands on
          // the group the fan was looking at.
          url: absoluteUrl(seed.share.path) + boardFragment(active.slug),
          groups: state.groups,
          picks: copyablePicks,
          // null only without a catalog → the stored (add-time) title.
          titleOf: (p) => {
            const song = catalogById.get(p.songId);
            return song ? pickTitle(song, locale) : null;
          },
        })
      : null;
  const copy =
    copyResult && active ? { ...copyResult, groupId: active.groupId } : null;

  const handleCopy = async () => {
    if (!copy) return;
    // `writeText` is missing outside secure contexts and in some
    // embedded WebViews, and rejects when the permission is refused —
    // both read as one "copy it by hand" message; no text is lost
    // because "my picks" stays on screen.
    try {
      if (typeof navigator.clipboard?.writeText !== "function") {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(copy.text);
    } catch {
      setToast({ text: t("copyUnavailable"), error: true });
      return;
    }
    setToast({ text: t("copied"), error: false });
    trackEvent("board_copy", {
      event_id: eventId,
      // The open group = the group the link's fragment opens.
      group_id: copy.groupId,
      count: copy.count,
    });
  };

  // "Go to full setlist mode" (n15). The import uses the same
  // availability-folded picks as the copy text, so a song the fan sees
  // as unavailable here never lands in the builder. Synchronous
  // localStorage work, then the parent switches to the Predict tab.
  const handleOpenFullSetlist = () => {
    if (state.kind !== "ready" || !onOpenFullSetlist) return;
    const outcome = importBoardPicksToPredictions({
      eventId,
      picks: copyablePicks,
      groupOrder: state.groups.map((g) => g.groupId),
      catalog,
    });
    trackEvent("board_to_builder", {
      event_id: eventId,
      imported_count: outcome.kind === "imported" ? outcome.count : 0,
    });
    onOpenFullSetlist(outcome);
  };

  return (
    // 18-v3 `#participate`: the page's lead panel pre-show. Pink lead
    // bar on the heading, then one wrapping row of group chips (tinted
    // with each group's colour, the open one outlined in ink and
    // underlined so selection never rests on colour alone), then the
    // pink want / blue expect ballots side by side (stacked < 700px).
    <section
      ref={sectionRef}
      id={anchorId}
      aria-labelledby={`board-title-${eventId}`}
      className={`${styles.panel} ${styles.participatePanel}`}
    >
      <div>
        <h2 id={`board-title-${eventId}`} className={styles.panelTitle}>
          {t("title")}
        </h2>
        {state.kind === "ready" && (
          // One short status line: open until the show starts, or
          // closed. No aggregation timestamp and no clock time — the
          // board is a light pre-show game, and a "{time} as of" stamp
          // next to a zoned show time read as noise on a phone header.
          // The response still carries `asOf` (cache evidence); the
          // UI just doesn't print it.
          <p className={styles.boardStatus}>
            {locked ? t("closed") : t("openUntil")}
          </p>
        )}
        {tally && tally.size > 0 && (
          <p data-testid="board-tally-overall" className={styles.boardTally}>
            {t("tallyOverall", { played: tally.played, size: tally.size })}
          </p>
        )}
        <p className={styles.boardLead}>{t("explainer")}</p>
        {state.kind === "ready" && state.refreshFailed && !locked && (
          <p role="status" className={styles.ballotNote}>
            {t("refreshError")}{" "}
            <button type="button" onClick={() => readSession.current?.refresh()} className="underline">
              {t("retryRefresh")}
            </button>
          </p>
        )}
      </div>

      <div
        role="tablist"
        aria-label={t("groupsAria")}
        className={styles.groupTabs}
      >
        {chips.map((c) => {
          const selected = c.groupId === activeChipId;
          return (
            <button
              key={c.groupId}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveId(c.groupId)}
              className={styles.groupTab}
              // No group colour → the neutral border tone, mixed toward
              // white like every other chip; never an arbitrary hue.
              style={
                { "--artist": c.color ?? colors.borderStrong } as React.CSSProperties
              }
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {state.kind === "loading" && (
          <p className={styles.ballotNote}>{t("loading")}</p>
        )}
        {state.kind === "ready" && active && (
          <>
            {/* Two ballots side by side; stacked (want above expect)
                under 700px, where two pickers would not fit. */}
            <div className={styles.boardColumns}>
              {(["wish", "pick"] as const).map((kind) => {
                const mine = listOf(kind).filter(
                  (p) => p.groupId === active.groupId,
                );
                return (
                  <div
                    key={kind}
                    data-testid={`board-col-${COLUMN[kind].name}`}
                    className={`${styles.ballot} ${kind === "pick" ? styles.ballotExpect : ""}`}
                  >
                    <ColumnPanel
                      eventId={eventId}
                      group={active}
                      kind={kind}
                      locale={locale}
                      t={t}
                      mySongIds={new Set(mine.map((p) => p.songId))}
                      // Only expected songs are graded; wishes are not
                      // predictions.
                      graded={kind === "pick" ? gradedOf(active.groupId) : null}
                    />
                    <BoardMyPicks
                      key={kind + "-" + active.groupId}
                      kind={kind}
                      groupId={active.groupId}
                      groupName={active.name}
                      locale={locale}
                      picks={mine}
                      groupSongs={songsOf(active.groupId)}
                      locked={locked}
                      playedSongIds={kind === "pick" ? playedIds : null}
                      pending={pendingOf(kind)}
                      onAdd={(song) => void handleAdd(kind, active, song)}
                      onRemove={(entry) => void handleRemove(kind, active, entry)}
                    />
                  </div>
                );
              })}
            </div>
            {ballot.legacyWishes.length > 0 && (
              <LegacyWishes
                entries={ballot.legacyWishes}
                locale={locale}
                locked={locked}
                pending={ballot.pending}
                t={t}
                onRemove={(entry) => void handleRemoveLegacy(entry)}
              />
            )}
            {/* 18-v3 `.bridge-strip`: the way on from the board. */}
            <div className={styles.bridgeStrip}>
              {/* "Explore this group" — the private alternative to a
                  public "skipped" stat: a fan who doesn't know the group
                  gets a way in, and nobody else learns they skipped it. */}
              <Link
                href={entityPath("artists", locale, active.groupId, active.slug)}
                onClick={() =>
                  trackEvent("board_explore_click", {
                    event_id: eventId,
                    group_id: active.groupId,
                  })
                }
                className={styles.bridgeLink}
              >
                {t("explore", { group: active.name })}
              </Link>
              <div className={styles.bridgeActions}>
                {/* Disabled, not hidden, at zero picks: the button is how
                    a fan learns the post exists. */}
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  disabled={!copy}
                  className={styles.secondaryButton}
                >
                  {t("copy")}
                </button>
                {/* Enabled at zero picks too: it is also the plain mode
                    switch into the builder. Hidden once the board locks —
                    the builder locks at the same instant. Expected songs
                    only: wishes (the other column) never enter the
                    draft. */}
                {onOpenFullSetlist && !locked && (
                  <button
                    type="button"
                    onClick={handleOpenFullSetlist}
                    className={styles.secondaryButton}
                  >
                    {t("toFullSetlist")}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
        {/* Feedback for adds/removes. Always mounted so screen readers
            announce the change (a live region added together with its
            text is often skipped). */}
        <p
          role="status"
          aria-live="polite"
          data-testid="board-toast"
          className="mt-2 min-h-[1em] text-[12px]"
          style={{ color: toast?.error ? colors.error : colors.textSecondary }}
        >
          {toast?.text ?? ""}
        </p>
      </div>
    </section>
  );
}

function ColumnPanel({
  eventId,
  group,
  kind,
  locale,
  t,
  mySongIds,
  graded = null,
}: {
  eventId: string;
  group: BoardGroupView;
  /** "wish" → the want column; "pick" → the expect column. */
  kind: BallotKind;
  locale: string;
  t: ReturnType<typeof useTranslations<"Board">>;
  /** My entries in this column — highlighted wherever they appear. */
  mySongIds: ReadonlySet<string>;
  /** Result mode (n15): this group's graded shortlist, which then
   *  replaces the crowd TOP3. Null = not graded. */
  graded?: BoardGroupTally | null;
}) {
  const meta = COLUMN[kind];
  const column = group[meta.field];
  const label = column.label;
  // A graded shortlist exists only when picks existed at the lock, so
  // the column is never "operator" then; the guard keeps starters from
  // ever rendering next to a grade.
  const showStarters =
    !graded && label === "operator" && group.starters.length > 0;
  const entries: readonly (BoardTopEntry & Partial<BoardShortlistEntry>)[] =
    graded ? graded.shortlist : column.top;
  // My own entries stand out wherever they appear in the crowd list.
  const mineStyle = (songId: string) =>
    mySongIds.has(songId)
      ? { background: colors.primaryBg, borderColor: colors.primaryBorder }
      : undefined;
  const mineBadge = t(meta.mineBadge);
  // Song links double as a listening guide for a group the fan doesn't
  // know; the click tells us whether anyone uses them that way.
  // `source` keeps crowd rows apart from operator starters.
  const trackSong = (songId: string, source: "crowd" | "operator") =>
    trackEvent("board_song_click", {
      event_id: eventId,
      group_id: group.groupId,
      song_id: songId,
      column: meta.name,
      source,
    });
  return (
    <div>
      <h3 className={styles.ballotTitle}>
        {/* ♡ want / ✦ expect glyphs (18-v3), decorative: the heading
            text carries the meaning. */}
        <span aria-hidden="true">{kind === "wish" ? "♡" : "✦"}</span>
        {t(meta.heading)}
        {/* Few participants: a 2-vs-1 must not read like a landslide.
            Plain counts and this label — never shares or bars. */}
        {label === "early" && (
          <span data-testid="board-early" className={styles.earlyTag}>
            {t("earlySample")}
          </span>
        )}
      </h3>
      {graded && (
        <p data-testid="board-tally-group" className={styles.ballotNote}>
          {t("tallyGroup", { played: graded.played, size: graded.size })}
        </p>
      )}
      {(graded || label !== "operator") && (
        <ol className={styles.crowdList}>
          {entries.map((e, i) => (
            <li
              key={e.songId}
              data-testid="board-top-entry"
              data-mine={mySongIds.has(e.songId) || undefined}
              data-played={e.played === undefined ? undefined : String(e.played)}
              className={styles.crowdItem}
              style={mineStyle(e.songId)}
            >
              {/* Rank badge (gold / silver / bronze by position). The
                  list order is the rank; the badge makes it visible. */}
              <span className={styles.rank}>{i + 1}</span>
              {/* Factual result, so neutral marks (not 👍/👎); the
                  label carries the meaning for screen readers. */}
              {e.played !== undefined && (
                <span
                  role="img"
                  aria-label={t(e.played ? "tallyPlayed" : "tallyNotPlayed")}
                  className="w-3 flex-shrink-0 text-center text-[13px] font-bold"
                  style={{ color: e.played ? colors.primary : colors.textMuted }}
                >
                  {e.played ? "✓" : "✕"}
                </span>
              )}
              {e.available ? (
                // Bare-id song URL: catalog rows carry no slug; the
                // canonical 308 adds it.
                <Link
                  href={entityPath("songs", locale, e.songId, "")}
                  onClick={() => trackSong(e.songId, "crowd")}
                  className={styles.crowdTitle}
                >
                  {e.title}
                </Link>
              ) : (
                // Soft-deleted after it was picked: the vote and the rank
                // stay, the song page is gone. The aggregate takes titles
                // from the live catalog only, so the title may be empty.
                <span className={styles.crowdMuted}>
                  {e.title ? (
                    <>
                      {e.title} <span className="text-[10px]">({t("unavailable")})</span>
                    </>
                  ) : (
                    t("unavailable")
                  )}
                </span>
              )}
              {mySongIds.has(e.songId) && (
                <span className={styles.crowdMine}>{mineBadge}</span>
              )}
              <span className={styles.crowdCount}>
                {t("submissions", { count: e.count })}
              </span>
            </li>
          ))}
        </ol>
      )}
      {!graded &&
        label === "operator" &&
        (showStarters ? (
          <>
            {/* Operator starters: dashed rows with no rank or count —
                they are a suggestion, not crowd votes. */}
            <ol className={styles.crowdList}>
              {group.starters.map((s) => (
                <li
                  key={s.songId}
                  data-testid="board-starter"
                  data-mine={mySongIds.has(s.songId) || undefined}
                  className={`${styles.crowdItem} ${styles.crowdItemStarter}`}
                  style={
                    mySongIds.has(s.songId)
                      ? { background: colors.primaryBg }
                      : undefined
                  }
                >
                  <Link
                    href={entityPath("songs", locale, s.songId, "")}
                    onClick={() => trackSong(s.songId, "operator")}
                    className={styles.crowdTitle}
                  >
                    {s.title}
                  </Link>
                  <span className={styles.crowdTag}>{t("operatorPick")}</span>
                </li>
              ))}
            </ol>
            <p className={styles.ballotNote}>{t("operatorNote")}</p>
          </>
        ) : (
          <p className={styles.ballotNote}>{t("empty")}</p>
        ))}
    </div>
  );
}

/**
 * Wishes the fan made on the event-wide wishlist before wishes became
 * per group (n15). They still count — under the group their song
 * resolves to — but belong to no group's "my wishes" and use no slot,
 * so they are listed once, apart, and stay removable until the lock.
 */
function LegacyWishes({
  entries,
  locale,
  locked,
  pending,
  t,
  onRemove,
}: {
  entries: readonly WishEntry[];
  locale: string;
  locked: boolean;
  pending: ReadonlySet<string>;
  t: ReturnType<typeof useTranslations<"Board">>;
  onRemove: (entry: WishEntry) => void;
}) {
  return (
    <div className={styles.legacyBlock} data-testid="board-legacy-wishes">
      <h4 className={styles.legacyTitle}>{t("legacyWishesTitle")}</h4>
      <p className={styles.ballotNote}>{t("legacyWishesNote")}</p>
      <ul className="space-y-1">
        {entries.map((w) => {
          const title = displayOriginalTitle(w.song, w.song.translations, locale).main;
          return (
            <li
              key={w.dbId}
              data-testid="board-legacy-wish"
              className="flex items-center gap-2 rounded-md px-2 py-1 text-[13px]"
              style={{ background: colors.bgSubtle }}
            >
              <span className="min-w-0 flex-1 truncate" style={{ color: colors.textPrimary }}>
                {title}
              </span>
              {!locked && (
                <button
                  type="button"
                  onClick={() => onRemove(w)}
                  disabled={pending.has("legacy:" + w.dbId)}
                  aria-label={t("removeAria", { title })}
                  className="flex-shrink-0 px-1 text-[14px] leading-none disabled:opacity-40"
                  style={{ color: colors.textMuted }}
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
