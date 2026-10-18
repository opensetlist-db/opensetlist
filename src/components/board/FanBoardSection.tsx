"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { trackEvent } from "@/lib/analytics";
import { formatDate } from "@/lib/utils";
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
  BoardGroupView,
  BoardReadResponse,
} from "@/lib/board/types";
import type { StoredBoardPick } from "@/lib/board/pickStorage";
import { BOARD_PICKS_PER_GROUP } from "@/lib/board/config";
import type { AvailableSong } from "@/lib/types/predict";
import { colors } from "@/styles/tokens";
import { BoardMyPicks } from "@/components/board/BoardMyPicks";
import { pickTitle } from "@/lib/board/pickTitle";
import { useBoardPicks, type PickFailure } from "@/components/board/useBoardPicks";

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
 */

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "hidden" }
  | {
      kind: "ready";
      locked: boolean;
      asOf: string;
      groups: BoardGroupView[];
    };

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  // The viewer's own zone, named — a bare "09:00" next to a JST show
  // time is ambiguous for a Korean or US reader.
  timeZoneName: "short",
};

/** Failure code → `Board` message key. Anything unexpected (a 400 the
 *  UI should never produce, a 404 for a just-deleted song) reads as
 *  the generic "couldn't save". */
function failureKey(reason: PickFailure) {
  switch (reason) {
    case "cap_reached":
      return "errorCap" as const;
    case "group_conflict":
      return "errorGroupConflict" as const;
    case "board_locked":
      return "errorLocked" as const;
    case "board_disabled":
      return "errorDisabled" as const;
    case "busy":
      return "errorBusy" as const;
    case "invalid_anon_id":
      return "errorNoStorage" as const;
    default:
      return "errorGeneric" as const;
  }
}

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
  /** "Go to full setlist mode" (n15-09a). Passed only while the Predict
   *  tab exists (upcoming, inside the D-7 window); without it the
   *  button is not rendered. Called after the import ran. */
  onOpenFullSetlist?: (outcome: BoardToBuilderOutcome) => void;
}) {
  const t = useTranslations("Board");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [activeId, setActiveId] = useState<string | null>(
    seed.chips[0]?.groupId ?? null,
  );
  const sectionRef = useRef<HTMLElement>(null);
  const viewed = useRef(new Set<string>());
  const scrolledForHash = useRef(false);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  // Set at the lock time (timer below) or by a write refused with
  // `board_locked`: flips the block to read-only without a reload.
  const [lockedByServer, setLockedByServer] = useState(false);
  const ballot = useBoardPicks({
    eventId,
    locale,
    active: state.kind === "ready",
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

  // Load the aggregate once per mount.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BOARD_TIMEOUT_MS);
    (async () => {
      try {
        const params = new URLSearchParams({ locale });
        const res = await fetch(`/api/events/${eventId}/board?${params}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as BoardReadResponse;
        if (!body.enabled || !("groups" in body)) {
          setState({ kind: "hidden" });
          return;
        }
        setState({
          kind: "ready",
          locked: body.locked,
          asOf: body.asOf,
          groups: body.groups,
        });
      } catch {
        // Unmount aborts too; setting state then is a harmless no-op.
        setState({ kind: "error" });
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [eventId, locale]);

  const groups: readonly { groupId: string; slug: string }[] =
    state.kind === "ready" ? state.groups : seed.chips;

  // `#board-<slug>` selects a group — on load and on later hash changes
  // (a fan following a second shared link in the same tab).
  useEffect(() => {
    const apply = () => {
      const id = groupIdFromFragment(window.location.hash, groups);
      if (id) setActiveId(id);
      return id;
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [groups]);

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

  if (state.kind === "hidden") return null;
  if (state.kind === "error") {
    return (
      <p
        role="status"
        className="mb-2.5 px-1 text-[12px]"
        style={{ color: colors.textMuted }}
      >
        {t("loadError")}
      </p>
    );
  }

  const chips = state.kind === "ready" ? state.groups.map((g) => ({
    groupId: g.groupId,
    label: g.name,
    color: g.color,
  })) : seed.chips;
  const activeChipId = active?.groupId ?? activeId;
  const locked = state.kind === "ready" && (state.locked || lockedByServer);

  const report = (outcome: Awaited<ReturnType<typeof ballot.add>>, group: string) => {
    if (outcome.ok) {
      setToast({
        text: outcome.kind === "added" ? t("added", { group }) : t("removed"),
        error: false,
      });
      return;
    }
    if (outcome.reason === "board_locked") setLockedByServer(true);
    setToast({
      text: t(failureKey(outcome.reason), { max: BOARD_PICKS_PER_GROUP }),
      error: true,
    });
  };

  const handleAdd = async (group: BoardGroupView, song: AvailableSong) => {
    const songId = String(song.songId);
    // Two refusals the client can see coming — answered locally with the
    // same message the server would send, without a request.
    if (ballot.picks.some((p) => p.songId === songId && p.groupId !== group.groupId)) {
      report({ ok: false, reason: "group_conflict" }, group.name);
      return;
    }
    if (
      !ballot.picks.some((p) => p.songId === songId) &&
      ballot.picks.filter((p) => p.groupId === group.groupId).length >=
        BOARD_PICKS_PER_GROUP
    ) {
      report({ ok: false, reason: "cap_reached" }, group.name);
      return;
    }
    report(await ballot.add(group.groupId, songId, pickTitle(song, locale)), group.name);
  };

  const handleRemove = async (group: BoardGroupView, pick: StoredBoardPick) => {
    report(await ballot.remove(pick), group.name);
  };

  // "Copy my picks" (n15-05). Titles are re-localized from the live
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

  // "Go to full setlist mode" (n15-09a). The import uses the same
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
    <section
      ref={sectionRef}
      id={anchorId}
      aria-labelledby={`board-title-${eventId}`}
      className="mb-2.5 overflow-hidden rounded-[14px]"
      style={{
        background: colors.bgCard,
        border: `0.5px solid ${colors.border}`,
      }}
    >
      <div
        className="px-3.5 pt-2.5 pb-2"
        style={{ borderBottom: `0.5px solid ${colors.border}` }}
      >
        <h2
          id={`board-title-${eventId}`}
          className="text-[13px] font-medium"
          style={{ color: colors.textPrimary }}
        >
          🎪 {t("title")}
        </h2>
        {state.kind === "ready" && (
          <p className="mt-0.5 text-[11px]" style={{ color: colors.textSubtle }}>
            {t("asOf", { time: formatDate(state.asOf, locale, TIME_FORMAT) })}
            {" · "}
            {locked
              ? t("closed")
              : t("openUntil", {
                  time: formatDate(seed.lockAt, locale, TIME_FORMAT),
                })}
          </p>
        )}
        <p className="mt-1 text-[11px]" style={{ color: colors.textMuted }}>
          {t("explainer")}
        </p>
      </div>

      <div
        role="tablist"
        aria-label={t("groupsAria")}
        className="flex gap-1.5 overflow-x-auto whitespace-nowrap px-3.5 py-2"
      >
        {chips.map((c) => {
          const selected = c.groupId === activeChipId;
          const tint = c.color ?? colors.primary;
          return (
            <button
              key={c.groupId}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveId(c.groupId)}
              className="flex-shrink-0 rounded-full px-3 py-1 text-[12px]"
              style={{
                border: `1px solid ${tint}`,
                background: selected ? tint : "transparent",
                color: selected ? "#fff" : colors.textPrimary,
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div className="px-3.5 pb-3" role="tabpanel">
        {state.kind === "loading" && (
          <p className="text-[12px]" style={{ color: colors.textMuted }}>
            {t("loading")}
          </p>
        )}
        {state.kind === "ready" && active && (
          <>
            <GroupPanel
              eventId={eventId}
              group={active}
              locale={locale}
              t={t}
              mySongIds={
                new Set(
                  ballot.picks
                    .filter((p) => p.groupId === active.groupId)
                    .map((p) => p.songId),
                )
              }
            />
            <BoardMyPicks
              key={active.groupId}
              groupId={active.groupId}
              groupName={active.name}
              locale={locale}
              picks={ballot.picks.filter((p) => p.groupId === active.groupId)}
              groupSongs={songsOf(active.groupId)}
              locked={locked}
              pending={ballot.pending}
              onAdd={(song) => void handleAdd(active, song)}
              onRemove={(pick) => void handleRemove(active, pick)}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {/* Disabled, not hidden, at zero picks: the button is how a
                  fan learns the post exists. */}
              <button
                type="button"
                onClick={() => void handleCopy()}
                disabled={!copy}
                className="rounded-full px-3 py-1 text-[12px] disabled:opacity-50"
                style={{
                  border: `1px solid ${colors.border}`,
                  color: colors.textPrimary,
                }}
              >
                {t("copy")}
              </button>
              {/* Enabled at zero picks too: it is also the plain mode
                  switch into the builder. Hidden once the board locks —
                  the builder locks at the same instant. */}
              {onOpenFullSetlist && !locked && (
                <button
                  type="button"
                  onClick={handleOpenFullSetlist}
                  className="rounded-full px-3 py-1 text-[12px]"
                  style={{
                    border: `1px solid ${colors.border}`,
                    color: colors.textPrimary,
                  }}
                >
                  {t("toFullSetlist")}
                </button>
              )}
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
          className="mt-2 min-h-[1em] text-[11px]"
          style={{ color: toast?.error ? colors.error : colors.textSecondary }}
        >
          {toast?.text ?? ""}
        </p>
      </div>
    </section>
  );
}

function GroupPanel({
  eventId,
  group,
  locale,
  t,
  mySongIds,
}: {
  eventId: string;
  group: BoardGroupView;
  locale: string;
  t: ReturnType<typeof useTranslations<"Board">>;
  /** My picks in this group — highlighted wherever they appear. */
  mySongIds: ReadonlySet<string>;
}) {
  const label = group.expects.label;
  const showStarters = label === "operator" && group.starters.length > 0;
  const mineStyle = (songId: string) =>
    mySongIds.has(songId)
      ? { background: colors.primaryBg, borderColor: colors.primaryBorder }
      : undefined;
  // Song links double as a listening guide for a group the fan doesn't
  // know; the click tells us whether anyone uses them that way.
  // `source` keeps crowd rows apart from operator starters.
  const trackSong = (songId: string, source: "crowd" | "operator") =>
    trackEvent("board_song_click", {
      event_id: eventId,
      group_id: group.groupId,
      song_id: songId,
      column: "expect",
      source,
    });
  return (
    <div>
      <h3
        className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium"
        style={{ color: colors.textSecondary }}
      >
        {t("colExpect")}
        {/* Few participants: a 2-vs-1 must not read like a landslide.
            Plain counts and this label — never shares or bars. */}
        {label === "early" && (
          <span
            data-testid="board-early"
            className="rounded px-1.5 text-[10px] font-normal"
            style={{ background: colors.bgSubtle, color: colors.textSubtle }}
          >
            {t("earlySample")}
          </span>
        )}
      </h3>
      {label !== "operator" && (
        <ol className="space-y-1">
          {group.expects.top.map((e) => (
            <li
              key={e.songId}
              data-testid="board-top-entry"
              data-mine={mySongIds.has(e.songId) || undefined}
              className="flex items-center gap-2 rounded-md border border-transparent px-2 py-1 text-[13px]"
              style={mineStyle(e.songId)}
            >
              {e.available ? (
                // Bare-id song URL: catalog rows carry no slug; the
                // canonical 308 adds it.
                <Link
                  href={`/${locale}/songs/${e.songId}`}
                  onClick={() => trackSong(e.songId, "crowd")}
                  className="min-w-0 flex-1 truncate"
                  style={{ color: colors.textPrimary }}
                >
                  {e.title}
                </Link>
              ) : (
                // Soft-deleted after it was picked: the vote and the rank
                // stay, the song page is gone. The aggregate takes titles
                // from the live catalog only, so the title may be empty.
                <span
                  className="min-w-0 flex-1 truncate"
                  style={{ color: colors.textMuted }}
                >
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
                <span
                  className="flex-shrink-0 rounded px-1.5 text-[10px]"
                  style={{ color: colors.primary }}
                >
                  {t("mineBadge")}
                </span>
              )}
              <span
                className="flex-shrink-0 text-[11px] tabular-nums"
                style={{ color: colors.textSubtle }}
              >
                {t("submissions", { count: e.count })}
              </span>
            </li>
          ))}
        </ol>
      )}
      {label === "operator" &&
        (showStarters ? (
          <>
            <ol className="space-y-1">
              {group.starters.map((s) => (
                <li
                  key={s.songId}
                  data-testid="board-starter"
                  data-mine={mySongIds.has(s.songId) || undefined}
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-[13px]"
                  style={{
                    border: `1px dashed ${colors.border}`,
                    ...(mySongIds.has(s.songId)
                      ? { background: colors.primaryBg }
                      : null),
                  }}
                >
                  <Link
                    href={`/${locale}/songs/${s.songId}`}
                    onClick={() => trackSong(s.songId, "operator")}
                    className="min-w-0 flex-1 truncate"
                    style={{ color: colors.textPrimary }}
                  >
                    {s.title}
                  </Link>
                  <span
                    className="flex-shrink-0 rounded px-1.5 text-[10px]"
                    style={{
                      background: colors.bgSubtle,
                      color: colors.textSubtle,
                    }}
                  >
                    {t("operatorPick")}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-1.5 text-[11px]" style={{ color: colors.textMuted }}>
              {t("operatorNote")}
            </p>
          </>
        ) : (
          <p className="text-[12px]" style={{ color: colors.textMuted }}>
            {t("empty")}
          </p>
        ))}
      {/* "Explore this group" — the private alternative to a public
          "skipped" stat: a fan who doesn't know the group gets a way in,
          and nobody else learns they skipped it. */}
      <Link
        href={entityPath("artists", locale, group.groupId, group.slug)}
        onClick={() =>
          trackEvent("board_explore_click", {
            event_id: eventId,
            group_id: group.groupId,
          })
        }
        className="mt-2 inline-block text-[11px] underline"
        style={{ color: colors.textSecondary }}
      >
        {t("explore", { group: group.name })}
      </Link>
    </div>
  );
}
