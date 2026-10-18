"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ANON_TOKEN_HEADER,
  getAnonId,
  readExistingAnonId,
} from "@/lib/anonId";
import { useMounted } from "@/hooks/useMounted";
import { trackEvent } from "@/lib/analytics";
import {
  readBoardPicks,
  writeBoardPicks,
  type StoredBoardPick,
} from "@/lib/board/pickStorage";
import { readWishes, writeWishes, type WishEntry } from "@/lib/wishStorage";
import type {
  BoardMineResponse,
  BoardMinePick,
  BoardPickCreated,
  BoardPickErrorCode,
} from "@/lib/board/types";

/**
 * The viewer's own ballot on one event's fan board: expected-song
 * picks (n15-03) and per-group wishes (n15-08). Local copy first,
 * `/board/mine` as the fallback, and the add/remove calls with their
 * outcome reported back as a typed result the block turns into a
 * toast.
 *
 * The two kinds differ only in where they are stored and which route
 * they hit:
 *   - picks: `board-{eventId}`, `/board/picks`
 *   - wishes: `wish-{eventId}` (shared with the event-wide wishlist, so
 *     the wishlist that renders during the show lists them),
 *     `/wishes` — the same route the legacy wishlist uses; the server
 *     switches contract on the board flag.
 *
 * Writes are not optimistic: an entry appears in "mine" only after the
 * server accepted it, so a counter can never show a slot the server
 * refused (cap races, lock at start time, kill switch).
 *
 * Legacy wishes — entries in `wish-{eventId}` without a group, made on
 * the event-wide wishlist before per-group wishes — are exposed apart
 * (`legacyWishes`) so the block can list them and offer removal. They
 * are never re-posted, never given a group, never counted toward a
 * per-group cap, and never merged with a `/board/mine` restore (the
 * server does not return them: they have no owner on record).
 */

export type BallotKind = "pick" | "wish";

export type PickFailure =
  | BoardPickErrorCode
  /** fetch threw / timed out / non-JSON body */
  | "network";

export type PickOutcome =
  | { ok: true; kind: "added" | "removed"; groupId: string }
  | { ok: false; reason: PickFailure };

/** One ballot entry, either kind — the pick storage shape, which the
 *  wish storage is mapped onto. */
export type BallotEntry = StoredBoardPick;

const WRITE_TIMEOUT_MS = 8000;
/** "Restore my ballot" tries: the first request plus two retries. */
const MINE_ATTEMPTS = 3;
const MINE_RETRY_DELAY_MS = 2000;

async function callJson(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WRITE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // A body that isn't JSON (a proxy's HTML 502) is a network-class
      // failure for the caller unless the status alone says enough.
    }
    return { status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function errorCode(body: unknown): BoardPickErrorCode | null {
  if (body && typeof body === "object" && "error" in body) {
    const code = (body as { error: unknown }).error;
    if (typeof code === "string") return code as BoardPickErrorCode;
  }
  return null;
}

// ── wish storage adapter ───────────────────────────────────────────
// Board wishes live in `wish-{eventId}` as `WishEntry` rows tagged with
// a group. The title stored at add time becomes the entry's
// `originalTitle` (`displayOriginalTitle` always renders
// `originalTitle` as the main line), so the event-wide wishlist shows
// the same title the board did.

function wishToEntry(w: WishEntry): BallotEntry | null {
  if (!w.groupId) return null;
  return {
    id: w.dbId,
    groupId: w.groupId,
    songId: String(w.songId),
    title: w.song.originalTitle,
    available: w.available ?? true,
  };
}

function entryToWish(e: BallotEntry, locale: string): WishEntry {
  return {
    songId: Number(e.songId),
    dbId: e.id,
    song: {
      originalTitle: e.title,
      originalLanguage: locale,
      variantLabel: null,
      baseVersionId: null,
      translations: [],
    },
    groupId: e.groupId,
    ...(e.available ? {} : { available: false }),
  };
}

function readBoardWishes(eventId: string): BallotEntry[] {
  return readWishes(eventId).flatMap((w) => {
    const e = wishToEntry(w);
    return e ? [e] : [];
  });
}

/** Rewrite the board wishes, keeping every legacy entry as it was. */
function writeBoardWishes(
  eventId: string,
  entries: readonly BallotEntry[],
  locale: string,
): void {
  const legacy = readWishes(eventId).filter((w) => !w.groupId);
  writeWishes(eventId, [...legacy, ...entries.map((e) => entryToWish(e, locale))]);
}

const KIND = {
  pick: {
    createUrl: (eventId: string) => `/api/events/${eventId}/board/picks`,
    deleteUrl: (eventId: string, id: string) =>
      `/api/events/${eventId}/board/picks/${encodeURIComponent(id)}`,
    notFound: "pick_not_found" as BoardPickErrorCode,
    addEvent: "board_pick_add",
    removeEvent: "board_pick_remove",
  },
  wish: {
    createUrl: (eventId: string) => `/api/events/${eventId}/wishes`,
    deleteUrl: (eventId: string, id: string) =>
      `/api/events/${eventId}/wishes/${encodeURIComponent(id)}`,
    notFound: "wish_not_found" as BoardPickErrorCode,
    addEvent: "board_wish_add",
    removeEvent: "board_wish_remove",
  },
} as const;

function mineToEntry(p: BoardMinePick): BallotEntry {
  return {
    id: p.id,
    groupId: p.groupId,
    songId: p.songId,
    title: p.title,
    available: p.available,
  };
}

/** Merge a restore into the local list by row id — an entry made in
 *  this tab while the restore was in flight wins over nothing. */
function mergeById(cur: BallotEntry[], incoming: BallotEntry[]): BallotEntry[] {
  const ids = new Set(cur.map((p) => p.id));
  return [...cur, ...incoming.filter((p) => !ids.has(p.id))];
}

export function useBoardBallot({
  eventId,
  locale,
  active,
}: {
  eventId: string;
  locale: string;
  /** False until the board read answered with groups — no "mine"
   *  request is made for a hidden / failed / ongoing board. */
  active: boolean;
}) {
  const [picks, setPicks] = useState<BallotEntry[]>([]);
  const [wishes, setWishes] = useState<BallotEntry[]>([]);
  const [legacyWishes, setLegacyWishes] = useState<WishEntry[]>([]);
  // `${kind}:${songId}` (or `legacy:${dbId}`) with a request in flight
  // — the row/picker disables them so a double tap can't fire two
  // writes (the server would answer a second create idempotently
  // anyway; this just keeps the UI calm).
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  // Event id the restore fallback already ran for (per event, so a
  // re-render for another event id restores that ballot too).
  const restoredFor = useRef<string | null>(null);

  // Local copy after mount (SSR has no storage, so the first client
  // render must match it). Render-time setState behind `useMounted`,
  // the repo's pattern for this (see `<EventWishSection>`), not an
  // effect — `react-hooks/set-state-in-effect`.
  const mounted = useMounted();
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  if (mounted && hydratedKey !== eventId) {
    setHydratedKey(eventId);
    setPicks(readBoardPicks(eventId));
    setWishes(readBoardWishes(eventId));
    setLegacyWishes(readWishes(eventId).filter((w) => !w.groupId));
  }

  const setList = useCallback(
    (kind: BallotKind, update: (cur: BallotEntry[]) => BallotEntry[]) => {
      if (kind === "pick") {
        setPicks((cur) => {
          const next = update(cur);
          writeBoardPicks(eventId, next);
          return next;
        });
      } else {
        setWishes((cur) => {
          const next = update(cur);
          writeBoardWishes(eventId, next, locale);
          return next;
        });
      }
    },
    [eventId, locale],
  );

  // Fallback: a kind with nothing local → ask the server once per
  // mount (one request answers both kinds).
  useEffect(() => {
    if (!active || restoredFor.current === eventId) return;
    restoredFor.current = eventId;
    const needPicks = readBoardPicks(eventId).length === 0;
    const needWishes = readBoardWishes(eventId).length === 0;
    if (!needPicks && !needWishes) return;
    // A browser that never minted an id has never written to a ballot.
    const anonId = readExistingAnonId();
    if (!anonId) return;
    let cancelled = false;
    let settled = false;
    (async () => {
      // The id goes in a header, never the URL (it is a write
      // credential; URLs reach logs and telemetry).
      const params = new URLSearchParams({ locale });
      // A transient failure (503 busy — the route's retry-safe answer —
      // a 5xx, or no response at all) is retried a few times, 2 s apart
      // to match the route's Retry-After. Giving up after ONE failure
      // would be sticky: the next local add makes storage non-empty, so
      // later mounts skip the restore and this browser never sees its
      // older server rows (nor can remove them before the lock).
      let res: Awaited<ReturnType<typeof callJson>> = null;
      for (let attempt = 1; attempt <= MINE_ATTEMPTS; attempt++) {
        res = await callJson(`/api/events/${eventId}/board/mine?${params}`, {
          method: "GET",
          headers: { [ANON_TOKEN_HEADER]: anonId },
        });
        if (cancelled) return;
        const transient = !res || res.status >= 500;
        if (!transient || attempt === MINE_ATTEMPTS) break;
        await new Promise((r) => setTimeout(r, MINE_RETRY_DELAY_MS));
        if (cancelled) return;
      }
      settled = true;
      if (!res || res.status !== 200) return;
      const body = res.body as Partial<BoardMineResponse> | null;
      if (!body) return;
      if (needPicks && Array.isArray(body.picks) && body.picks.length > 0) {
        const next = body.picks.map(mineToEntry);
        setList("pick", (cur) => mergeById(cur, next));
      }
      // `wishes` is absent from a response of the previous release.
      if (needWishes && Array.isArray(body.wishes) && body.wishes.length > 0) {
        const next = body.wishes.map(mineToEntry);
        setList("wish", (cur) => mergeById(cur, next));
      }
    })();
    return () => {
      cancelled = true;
      // Cleaned up before the answer arrived (StrictMode's dev-only
      // mount → cleanup → mount, or a locale switch mid-request): let
      // the next run ask again, or the restore would never happen.
      if (!settled && restoredFor.current === eventId) {
        restoredFor.current = null;
      }
    };
  }, [active, eventId, locale, setList]);

  const setPendingFor = (key: string, on: boolean) =>
    setPending((cur) => {
      const next = new Set(cur);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const add = useCallback(
    async (
      kind: BallotKind,
      groupId: string,
      songId: string,
      title: string,
    ): Promise<PickOutcome> => {
      const anonId = getAnonId();
      // No storage → no stable id → the server would refuse anyway, and
      // a ballot nobody can come back to is not worth creating.
      if (!anonId) return { ok: false, reason: "invalid_anon_id" };
      const cfg = KIND[kind];
      const key = `${kind}:${songId}`;
      setPendingFor(key, true);
      try {
        const res = await callJson(cfg.createUrl(eventId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId, songId, anonId }),
        });
        if (!res) return { ok: false, reason: "network" };
        if (res.status === 200 || res.status === 201) {
          const created = res.body as BoardPickCreated;
          setList(kind, (cur) => [
            ...cur.filter((p) => p.id !== created.id),
            {
              id: created.id,
              groupId: created.groupId,
              songId: created.songId,
              title,
              available: true,
            },
          ]);
          trackEvent(cfg.addEvent, {
            event_id: eventId,
            group_id: groupId,
            song_id: songId,
          });
          return { ok: true, kind: "added", groupId };
        }
        return { ok: false, reason: errorCode(res.body) ?? "network" };
      } finally {
        setPendingFor(key, false);
      }
    },
    [eventId, setList],
  );

  const remove = useCallback(
    async (kind: BallotKind, entry: BallotEntry): Promise<PickOutcome> => {
      const anonId = getAnonId();
      if (!anonId) return { ok: false, reason: "invalid_anon_id" };
      const cfg = KIND[kind];
      const key = `${kind}:${entry.songId}`;
      setPendingFor(key, true);
      try {
        const res = await callJson(cfg.deleteUrl(eventId, entry.id), {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ anonId }),
        });
        if (!res) return { ok: false, reason: "network" };
        // 404 = already gone on the server (a retry, another tab):
        // the goal state is reached, so drop the local row too.
        const gone =
          res.status === 200 ||
          (res.status === 404 && errorCode(res.body) === cfg.notFound);
        if (gone) {
          setList(kind, (cur) => cur.filter((p) => p.id !== entry.id));
          if (res.status === 200) {
            trackEvent(cfg.removeEvent, {
              event_id: eventId,
              group_id: entry.groupId,
              song_id: entry.songId,
            });
          }
          return { ok: true, kind: "removed", groupId: entry.groupId };
        }
        return { ok: false, reason: errorCode(res.body) ?? "network" };
      } finally {
        setPendingFor(key, false);
      }
    },
    [eventId, setList],
  );

  /**
   * Remove a legacy wish (made on the event-wide wishlist before
   * per-group wishes). The server deletes the row by its id without
   * attributing it to anyone; our anon id rides along only because the
   * board contract accepts one. Not tracked as `board_wish_remove`: it
   * has no group.
   */
  const removeLegacyWish = useCallback(
    async (entry: WishEntry): Promise<PickOutcome> => {
      const anonId = getAnonId();
      const key = `legacy:${entry.dbId}`;
      setPendingFor(key, true);
      try {
        const res = await callJson(KIND.wish.deleteUrl(eventId, entry.dbId), {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(anonId ? { anonId } : {}),
        });
        if (!res) return { ok: false, reason: "network" };
        const gone =
          res.status === 200 ||
          (res.status === 404 && errorCode(res.body) === "wish_not_found");
        if (!gone) return { ok: false, reason: errorCode(res.body) ?? "network" };
        setLegacyWishes((cur) => {
          const next = cur.filter((w) => w.dbId !== entry.dbId);
          // Re-read the board entries from storage rather than state:
          // this write must not clobber them with a stale copy.
          writeWishes(eventId, [
            ...next,
            ...readWishes(eventId).filter((w) => w.groupId),
          ]);
          return next;
        });
        return { ok: true, kind: "removed", groupId: "" };
      } finally {
        setPendingFor(key, false);
      }
    },
    [eventId],
  );

  return { picks, wishes, legacyWishes, pending, add, remove, removeLegacyWish };
}
