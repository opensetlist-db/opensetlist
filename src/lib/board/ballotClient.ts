/**
 * Browser-side calls to the fan board ballot routes (n15):
 * the shared fetch wrapper and the error-code → message-key mapping.
 *
 * A plain module, not the `useBoardBallot` hook file, so code outside
 * the hook can share them without importing a component module.
 * Browser-only at call time (fetch), but importing it anywhere is safe.
 */

import type { BoardPickErrorCode } from "@/lib/board/types";

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
