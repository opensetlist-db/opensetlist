"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { trackEvent } from "@/lib/analytics";
import { formatDate } from "@/lib/utils";
import { BOARD_TIMEOUT_MS } from "@/lib/board/config";
import { groupIdFromFragment } from "@/lib/board/fragment";
import type {
  BoardBlockSeed,
  BoardGroupView,
  BoardReadResponse,
} from "@/lib/board/types";
import type { StoredBoardPick } from "@/lib/board/pickStorage";
import { BOARD_PICKS_PER_GROUP } from "@/lib/board/config";
import type { AvailableSong } from "@/lib/types/predict";
import { colors } from "@/styles/tokens";
import { BoardMyPicks, pickTitle } from "@/components/board/BoardMyPicks";
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
// Stable default so the per-group filter memo doesn't recompute on
// every render when the page passes no catalog.
const NO_CATALOG: readonly AvailableSong[] = [];

export function FanBoardSection({
  eventId,
  locale,
  seed,
  catalog = NO_CATALOG,
}: {
  eventId: string;
  locale: string;
  seed: BoardBlockSeed;
  /** The page's picker catalog (base songs; on a festival each row
   *  carries its `festivalGroupIds`). Empty when the page has none —
   *  then the add control is hidden. */
  catalog?: readonly AvailableSong[];
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
  // time, not after its first refused write. setTimeout's 32-bit delay
  // caps how far ahead this can be armed; a lock further out than ~24
  // days is simply not armed (the server still refuses at the instant).
  useEffect(() => {
    const ms = new Date(seed.lockAt).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms > 2147483647) return;
    const timer = setTimeout(() => setLockedByServer(true), Math.max(0, ms));
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

  return (
    <section
      ref={sectionRef}
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
            {state.locked
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
  group,
  locale,
  t,
  mySongIds,
}: {
  group: BoardGroupView;
  locale: string;
  t: ReturnType<typeof useTranslations<"Board">>;
  /** My picks in this group — highlighted wherever they appear. */
  mySongIds: ReadonlySet<string>;
}) {
  const showStarters =
    group.expects.label === "operator" && group.starters.length > 0;
  const mineStyle = (songId: string) =>
    mySongIds.has(songId)
      ? { background: colors.primaryBg, borderColor: colors.primaryBorder }
      : undefined;
  return (
    <div>
      <h3
        className="mb-1.5 text-[12px] font-medium"
        style={{ color: colors.textSecondary }}
      >
        {t("colExpect")}
      </h3>
      {group.expects.label !== "operator" && (
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
                <Link
                  href={`/${locale}/songs/${e.songId}`}
                  className="min-w-0 flex-1 truncate"
                  style={{ color: colors.textPrimary }}
                >
                  {e.title}
                </Link>
              ) : (
                <span
                  className="min-w-0 flex-1 truncate"
                  style={{ color: colors.textMuted }}
                >
                  {e.title} <span className="text-[10px]">({t("unavailable")})</span>
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
      {group.expects.label === "operator" &&
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
                  {/* Bare-id song URL: catalog rows carry no slug; the
                      canonical 308 adds it. */}
                  <Link
                    href={`/${locale}/songs/${s.songId}`}
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
    </div>
  );
}
