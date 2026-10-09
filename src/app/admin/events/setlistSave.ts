/**
 * Save flow for one SetlistBuilder row, split out of the component so
 * the failure paths are unit-testable with a mocked fetch.
 *
 * Why this is more than `fetch` + `res.ok`: during a live show the
 * operator saves a row every ~20 s over venue Wi-Fi / tethering. Three
 * distinct things can go wrong and each needs a different response:
 *
 *   1. The server REJECTED the write (`!res.ok`) — nothing was saved;
 *      keep the form so the operator can fix the input and retry.
 *   2. The write's outcome is UNKNOWN (fetch threw: offline, DNS, our
 *      10 s abort). The POST may well have committed and only the
 *      response was lost; a blind retry would insert a duplicate row.
 *      So we reload the list and look for a NEW row matching what we
 *      sent. Found → treat as saved. Not found → let the operator
 *      retry (now safe: the write demonstrably didn't land).
 *   3. The write succeeded but the follow-up reload failed — the row is
 *      saved, only the list on screen is stale. Reset the form as usual
 *      and surface a refresh banner instead of an error.
 *
 * Reconciliation runs only for POST. A PUT re-applies the same field
 * values to the same row, so retrying it is idempotent and there is no
 * duplicate to guard against — "unknown" is enough there.
 */

export const SAVE_TIMEOUT_MS = 10_000;

export type SavePayload = {
  position: number;
  type: string;
  note: string | null;
  songIds: number[];
};

// Minimal row shape needed to recognize "the row we just POSTed".
export type ReconcilableRow = {
  id: number;
  position: number;
  type: string;
  note: string | null;
  songs: { song: { id: number } }[];
};

export type SaveOutcome<T> =
  // `items` null = write OK but the reload failed (case 3).
  | { kind: "saved"; items: T[] | null; reconciled: boolean }
  | { kind: "rejected"; message: string }
  // `aborted` = our own timeout fired. See the catch block for why a
  // "row absent" reconcile result then proves nothing.
  | { kind: "unknown"; items: T[] | null; aborted: boolean };

/**
 * A row in `items` that wasn't in `knownIds` before the save and
 * matches the payload on position + type + ordered songIds + note.
 * Excluding pre-existing ids matters: an identical row can legitimately
 * already exist (e.g. a reprise at the same slot after a reorder), and
 * mistaking it for our write would silently drop the operator's save.
 */
export function findReconciledRow<T extends ReconcilableRow>(
  items: readonly T[],
  payload: SavePayload,
  knownIds: ReadonlySet<number>,
): T | undefined {
  const wantSongs = payload.songIds.join(",");
  const wantNote = payload.note ?? null;
  return items.find(
    (it) =>
      !knownIds.has(it.id) &&
      it.position === payload.position &&
      it.type === payload.type &&
      (it.note ?? null) === wantNote &&
      it.songs.map((s) => s.song.id).join(",") === wantSongs,
  );
}

export async function saveSetlistRow<T extends ReconcilableRow>(opts: {
  url: string;
  method: "POST" | "PUT";
  payload: SavePayload & Record<string, unknown>;
  // Ids on screen before this save — see findReconciledRow.
  knownIds: ReadonlySet<number>;
  // Reloads the list and returns it, or null on any failure. Must not
  // throw (the component's reloadItems catches internally).
  reload: () => Promise<T[] | null>;
  // Fired when the outcome is unknown and we start reconciling, so the
  // UI can show 「저장 결과를 확인하는 중…」 while reload runs.
  onReconcileStart?: () => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<SaveOutcome<T>> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? SAVE_TIMEOUT_MS,
  );

  let res: Response;
  try {
    res = await doFetch(opts.url, {
      method: opts.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts.payload),
      signal: controller.signal,
    });
  } catch {
    // Aborting only cancels the CLIENT side of the request; a POST the
    // server already received keeps running and may commit after our
    // reload. So on a timeout, "row absent" doesn't mean "not saved" —
    // the caller must not promise a duplicate-safe retry. A plain
    // network failure ("Failed to fetch") is different: either the
    // request never reached the server, or it was answered and the
    // commit is already visible to the reload.
    // Read the signal rather than the error: DOMException isn't an
    // Error subclass in every runtime, and only OUR abort matters.
    const aborted = controller.signal.aborted;
    opts.onReconcileStart?.();
    const items = await opts.reload();
    if (opts.method === "POST" && items) {
      const hit = findReconciledRow(items, opts.payload, opts.knownIds);
      if (hit) return { kind: "saved", items, reconciled: true };
    }
    return { kind: "unknown", items, aborted };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Error bodies aren't guaranteed JSON (proxy HTML, empty 502).
    const body = (await res.json().catch(() => null)) as
      | { error?: unknown }
      | null;
    const message =
      typeof body?.error === "string" && body.error
        ? body.error
        : `저장에 실패했습니다. (HTTP ${res.status})`;
    return { kind: "rejected", message };
  }

  const items = await opts.reload();
  return { kind: "saved", items, reconciled: false };
}
