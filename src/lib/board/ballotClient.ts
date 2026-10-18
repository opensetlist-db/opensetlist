/**
 * Browser-side calls to the fan board ballot routes (n15):
 * the shared fetch wrapper, the error-code → message-key mapping, the
 * `/board/mine` request and the whole-ballot publish.
 *
 * A plain module, not the `useBoardBallot` hook file: the board block's
 * hook and the Predict tab's publish proposal both call these, and
 * neither should have to import the other's component module for them.
 * Browser-only at call time (fetch, the anon id in storage), but
 * importing it anywhere is safe.
 */

import { ANON_TOKEN_HEADER, getAnonId } from "@/lib/anonId";
import type { StoredBoardPick } from "@/lib/board/pickStorage";
import type {
  BoardMineResponse,
  BoardPickCreated,
  BoardPickErrorCode,
  BoardPublishResponse,
} from "@/lib/board/types";

export type PickFailure =
  | BoardPickErrorCode
  /** fetch threw / timed out / non-JSON body */
  | "network";

/** The `Board` i18n key a failure is shown with. Anything unexpected (a
 *  400 the UI should never produce, a 404 for a just-deleted song) reads
 *  as the generic "couldn't save". */
export function pickFailureKey(reason: PickFailure) {
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

const REQUEST_TIMEOUT_MS = 8000;

export type JsonReply = { status: number; body: unknown } | null;

/** `fetch` with a timeout and no caching; `null` when there was no
 *  usable response at all (threw, timed out). */
export async function callJson(url: string, init: RequestInit): Promise<JsonReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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

export function errorCode(body: unknown): BoardPickErrorCode | null {
  if (body && typeof body === "object" && "error" in body) {
    const code = (body as { error: unknown }).error;
    if (typeof code === "string") return code as BoardPickErrorCode;
  }
  return null;
}

/** One `/board/mine` request. The id goes in a header, never the URL
 *  (it is a write credential; URLs reach logs and telemetry). */
export function requestMine(eventId: string, locale: string, anonId: string): Promise<JsonReply> {
  const params = new URLSearchParams({ locale });
  return callJson(`/api/events/${eventId}/board/mine?${params}`, {
    method: "GET",
    headers: { [ANON_TOKEN_HEADER]: anonId },
  });
}

/** A 200 `/board/mine` reply as local-copy rows; null for anything else. */
export function minePicksFrom(reply: JsonReply): StoredBoardPick[] | null {
  if (!reply || reply.status !== 200) return null;
  const body = reply.body as BoardMineResponse | null;
  if (!body || !Array.isArray(body.picks)) return null;
  return body.picks.map((p) => ({
    id: p.id,
    groupId: p.groupId,
    songId: p.songId,
    title: p.title,
    available: p.available,
  }));
}

export type PublishOutcome =
  | { ok: true; picks: BoardPickCreated[] }
  | { ok: false; reason: PickFailure };

/**
 * Publish a whole ballot (n15): `PUT /board/picks` with the given
 * picks, which replace the anon's expected songs atomically. The caller
 * owns local storage and the feedback — this is only the call and its
 * typed outcome.
 */
export async function publishBallot(
  eventId: string,
  picks: ReadonlyArray<{ groupId: string; songId: string }>,
): Promise<PublishOutcome> {
  const anonId = getAnonId();
  if (!anonId) return { ok: false, reason: "invalid_anon_id" };
  const res = await callJson(`/api/events/${eventId}/board/picks`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      anonId,
      picks: picks.map((p) => ({ groupId: p.groupId, songId: p.songId })),
    }),
  });
  if (!res) return { ok: false, reason: "network" };
  if (res.status === 200) {
    const body = res.body as BoardPublishResponse | null;
    if (body && Array.isArray(body.picks)) return { ok: true, picks: body.picks };
    return { ok: false, reason: "network" };
  }
  return { ok: false, reason: errorCode(res.body) ?? "network" };
}
