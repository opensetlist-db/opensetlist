"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAnonId, readExistingAnonId } from "@/lib/anonId";
import { useMounted } from "@/hooks/useMounted";
import { trackEvent } from "@/lib/analytics";
import {
  readBoardPicks,
  writeBoardPicks,
  type StoredBoardPick,
} from "@/lib/board/pickStorage";
import type {
  BoardMineResponse,
  BoardPickCreated,
  BoardPickErrorCode,
} from "@/lib/board/types";

/**
 * The viewer's own ballot on one event's fan board (n15-03): local copy
 * first, `/board/mine` as the fallback, and the add/remove calls with
 * their outcome reported back as a typed result the block turns into a
 * toast.
 *
 * Writes are not optimistic: a pick appears in "my picks" only after
 * the server accepted it, so the counter can never show a slot the
 * server refused (cap races, lock at start time, kill switch).
 */

export type PickFailure =
  | BoardPickErrorCode
  /** fetch threw / timed out / non-JSON body */
  | "network";

export type PickOutcome =
  | { ok: true; kind: "added" | "removed"; groupId: string }
  | { ok: false; reason: PickFailure };

const WRITE_TIMEOUT_MS = 8000;

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

export function useBoardPicks({
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
  const [picks, setPicks] = useState<StoredBoardPick[]>([]);
  // Song ids with a request in flight — the row/picker disables them so
  // a double tap can't fire two creates (the server would answer the
  // second idempotently anyway; this just keeps the UI calm).
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
  }

  // Fallback: nothing local → ask the server once per mount.
  useEffect(() => {
    if (!active || restoredFor.current === eventId) return;
    restoredFor.current = eventId;
    if (readBoardPicks(eventId).length > 0) return;
    // A browser that never minted an id has never written a pick.
    const anonId = readExistingAnonId();
    if (!anonId) return;
    let cancelled = false;
    let settled = false;
    (async () => {
      const params = new URLSearchParams({ anonId, locale });
      const res = await callJson(
        `/api/events/${eventId}/board/mine?${params}`,
        { method: "GET" },
      );
      if (cancelled) return;
      settled = true;
      if (!res || res.status !== 200) return;
      const body = res.body as BoardMineResponse | null;
      if (!body || !Array.isArray(body.picks) || body.picks.length === 0) {
        return;
      }
      const next = body.picks.map((p) => ({
        id: p.id,
        groupId: p.groupId,
        songId: p.songId,
        title: p.title,
        available: p.available,
      }));
      // A pick made in this tab while the restore was in flight wins
      // over nothing; merge by row id so neither side is lost.
      setPicks((cur) => {
        const ids = new Set(cur.map((p) => p.id));
        const merged = [...cur, ...next.filter((p) => !ids.has(p.id))];
        writeBoardPicks(eventId, merged);
        return merged;
      });
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
  }, [active, eventId, locale]);

  const setPendingFor = (songId: string, on: boolean) =>
    setPending((cur) => {
      const next = new Set(cur);
      if (on) next.add(songId);
      else next.delete(songId);
      return next;
    });

  const add = useCallback(
    async (groupId: string, songId: string, title: string): Promise<PickOutcome> => {
      const anonId = getAnonId();
      // No storage → no stable id → the server would refuse anyway, and
      // a ballot nobody can come back to is not worth creating.
      if (!anonId) return { ok: false, reason: "invalid_anon_id" };
      setPendingFor(songId, true);
      try {
        const res = await callJson(`/api/events/${eventId}/board/picks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId, songId, anonId }),
        });
        if (!res) return { ok: false, reason: "network" };
        if (res.status === 200 || res.status === 201) {
          const created = res.body as BoardPickCreated;
          setPicks((cur) => {
            const next = [
              ...cur.filter((p) => p.id !== created.id),
              {
                id: created.id,
                groupId: created.groupId,
                songId: created.songId,
                title,
                available: true,
              },
            ];
            writeBoardPicks(eventId, next);
            return next;
          });
          trackEvent("board_pick_add", {
            event_id: eventId,
            group_id: groupId,
            song_id: songId,
          });
          return { ok: true, kind: "added", groupId };
        }
        return { ok: false, reason: errorCode(res.body) ?? "network" };
      } finally {
        setPendingFor(songId, false);
      }
    },
    [eventId],
  );

  const remove = useCallback(
    async (pick: StoredBoardPick): Promise<PickOutcome> => {
      const anonId = getAnonId();
      if (!anonId) return { ok: false, reason: "invalid_anon_id" };
      setPendingFor(pick.songId, true);
      try {
        const res = await callJson(
          `/api/events/${eventId}/board/picks/${encodeURIComponent(pick.id)}`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ anonId }),
          },
        );
        if (!res) return { ok: false, reason: "network" };
        // 404 = already gone on the server (a retry, another tab):
        // the goal state is reached, so drop the local row too.
        const gone =
          res.status === 200 ||
          (res.status === 404 && errorCode(res.body) === "pick_not_found");
        if (gone) {
          setPicks((cur) => {
            const next = cur.filter((p) => p.id !== pick.id);
            writeBoardPicks(eventId, next);
            return next;
          });
          if (res.status === 200) {
            trackEvent("board_pick_remove", {
              event_id: eventId,
              group_id: pick.groupId,
              song_id: pick.songId,
            });
          }
          return { ok: true, kind: "removed", groupId: pick.groupId };
        }
        return { ok: false, reason: errorCode(res.body) ?? "network" };
      } finally {
        setPendingFor(pick.songId, false);
      }
    },
    [eventId],
  );

  return { picks, pending, add, remove };
}
