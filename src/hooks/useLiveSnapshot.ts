"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { FanTop3Entry, ReactionCountsMap } from "@/lib/types/setlist";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import {
  INITIAL_FRESHNESS,
  armSnapshotDeadline,
  clampRetryAfterMs,
  freshnessStateFor,
  parseRetryAfterMs,
  snapshotRetryDelayMs,
  type Freshness,
} from "@/lib/snapshotFreshness";
import {
  SnapshotAcceptance,
  isValidRev,
  parseCapturedAt,
  setlistSnapshotUrl,
  type HintResolution,
  type SnapshotVersion,
} from "@/lib/snapshotAcceptance";
import {
  SNAPSHOT_VERIFY_HEADER,
  parseSnapshotVerify,
} from "@/lib/snapshotVerify";
import type {
  LiveFetchOutcome,
  LiveFetchReason,
  LiveFetchRequest,
  LiveHintOutcome,
} from "@/lib/liveScheduler";

// Shared state + request runner behind `useRealtimeEventChannel` and
// `useSetlistPolling`. Both hooks fetch the same `/api/setlist`
// snapshot and must treat it identically — the same acceptance rule
// (`src/lib/snapshotAcceptance.ts`), the same 8 s deadline and n13
// failure bookkeeping (`src/lib/snapshotFreshness.ts`), the same
// `?minRev=`. Before n14 each hook carried its own copy of ~100 lines of
// fetch/abort/freshness code; with the acceptance state added, two
// copies would have been two chances to diverge. The hooks keep what
// actually differs: WHEN to fetch (their scheduler configuration and
// triggers) and channel lifecycle.
//
// One instance = one data source = one acceptance watermark. The
// realtime hook therefore runs its "polling while disconnected" mode on
// its own instance (a different scheduler cadence, same runner) rather
// than on a second polling hook: everything the page renders passes the
// same `(rev, capturedAt)` gate, so a hand-over in either direction can
// never show a lower revision than one already shown.

interface UseLiveSnapshotOptions<T> {
  eventId: string;
  locale: string;
  initialItems: T[];
  initialReactionCounts: ReactionCountsMap;
  initialTop3Wishes: FanTop3Entry[];
  /** SSR snapshot revision (seeds the applied watermark). */
  initialRev?: number | null;
  /** SSR snapshot `capturedAt` ISO string (seeds the watermark). */
  initialCapturedAt?: string | null;
}

export interface LiveSnapshotData<T> {
  items: T[];
  reactionCounts: ReactionCountsMap;
  top3Wishes: FanTop3Entry[];
  status: ResolvedEventStatus | null;
  /** Start time from the latest accepted snapshot, including postponements. */
  startTime: string | null;
  /** Server start instant projected onto the client clock using servedAt. */
  startTimeLocalMs: number | null;
  /**
   * Non-null once a snapshot has been applied in this browser. Callers
   * use it as "client data is now authoritative" (LiveEventLayout's
   * sidebar gate). Value: the response's
   * `servedAt` (or legacy `updatedAt`), else the client receipt time —
   * never a freshness signal (see `freshness` for that).
   */
  lastUpdated: string | null;
  freshness: Freshness;
  /** Revision of the applied snapshot (SSR seed until the first fetch). */
  rev: number | null;
  /**
   * `capturedAt` (ISO) of the applied snapshot, SSR seed until the
   * first fetch. `<ReactionButtons>` compares it with a reaction's
   * `ackAt` to know when the snapshot has caught up with the tap.
   */
  capturedAt: string | null;
  /**
   * The server answered 404 for this event (missing or soft-deleted —
   * `/api/setlist` decides it from the snapshot's `found` /
   * `isDeleted`). Terminal for this event/locale: the request that saw
   * it settled as `gone`, which stops its scheduler for good, and the
   * owning hooks tear down their session (scheduler, timers, Realtime
   * channel) and refuse to start a new one while it is set. The last
   * applied content stays on screen untouched — no redirect, no
   * placeholder; callers only hide the sync indicator, which would
   * otherwise keep showing a "last synced" time that will never move.
   * Reset on event/locale change.
   */
  gone: boolean;
}

/** Body of `/api/setlist` (n14 contract; older fields tolerated). */
interface SnapshotBody<T> {
  items: T[];
  reactionCounts?: ReactionCountsMap;
  top3Wishes?: FanTop3Entry[];
  status?: ResolvedEventStatus | null;
  startTime?: unknown;
  rev?: unknown;
  capturedAt?: unknown;
  servedAt?: unknown;
  /** v0.18.x name of `servedAt`. */
  updatedAt?: unknown;
}

export interface SnapshotFailureInfo {
  failures: number;
  delayMs: number;
  reason: LiveFetchReason;
}

/**
 * One channel/polling session's request runner. `runFetch` is handed to
 * `createLiveScheduler`; `abort()` cancels every in-flight request
 * silently (cleanup, not failure). `noteHint` / `captureHint` expose the
 * acceptance state's hint batch (see snapshotAcceptance.ts): the channel
 * feeds broadcast payloads into `noteHint`, the scheduler drains the
 * batch with `captureHint` at dispatch.
 */
export interface SnapshotRunner {
  runFetch: (
    reason: LiveFetchReason,
    request?: LiveFetchRequest,
  ) => Promise<LiveFetchOutcome>;
  abort: () => void;
  /** Feed an untrusted broadcast `rev`; true = worth a notification fetch. */
  noteHint: (rev: unknown) => boolean;
  /** Drain the current hint batch for the request being dispatched. */
  captureHint: () => number | null;
}

/**
 * `HintResolution` (acceptance) → what the scheduler needs to know.
 * Satisfied, disproved and superseded all consume the ticket; only an
 * inconclusive answer asks for the recheck. `none` (no ticket) reports
 * nothing.
 */
function hintOutcomeFor(resolution: HintResolution): LiveHintOutcome | undefined {
  if (resolution === "none") return undefined;
  return resolution === "inconclusive" ? "inconclusive" : "resolved";
}

const CANCELLED: LiveFetchOutcome = { kind: "cancelled" };
const OK: LiveFetchOutcome = { kind: "ok" };
const GONE: LiveFetchOutcome = { kind: "gone" };

function seedRev(value: number | null | undefined): number | null {
  return isValidRev(value) ? value : null;
}

function seedCapturedAt(value: string | null | undefined): string | null {
  return parseCapturedAt(value) === null ? null : (value as string);
}

function pickLastUpdated(body: SnapshotBody<unknown>): string {
  if (typeof body.servedAt === "string" && body.servedAt) return body.servedAt;
  if (typeof body.updatedAt === "string" && body.updatedAt) return body.updatedAt;
  return new Date().toISOString();
}

export function useLiveSnapshot<T>({
  eventId,
  locale,
  initialItems,
  initialReactionCounts,
  initialTop3Wishes,
  initialRev,
  initialCapturedAt,
}: UseLiveSnapshotOptions<T>) {
  const [items, setItems] = useState<T[]>(initialItems);
  const [reactionCounts, setReactionCounts] =
    useState<ReactionCountsMap>(initialReactionCounts);
  const [top3Wishes, setTop3Wishes] =
    useState<FanTop3Entry[]>(initialTop3Wishes);
  const [status, setStatus] = useState<ResolvedEventStatus | null>(null);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [startTimeLocalMs, setStartTimeLocalMs] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<Freshness>(INITIAL_FRESHNESS);
  const [rev, setRev] = useState<number | null>(() => seedRev(initialRev));
  const [capturedAt, setCapturedAt] = useState<string | null>(() =>
    seedCapturedAt(initialCapturedAt),
  );
  const [gone, setGone] = useState(false);

  // Consecutive snapshot failures. Hook-scoped (not session-scoped) so
  // the count — and therefore the "delayed" indicator — survives the
  // realtime channel effect re-running on a visibility pause; reset on
  // success and on event change. Polling additionally resets it per
  // polling session.
  const failuresRef = useRef(0);

  // Acceptance state, created + re-seeded in the layout effect below.
  const acceptanceRef = useRef<SnapshotAcceptance | null>(null);

  // Latest-value refs for the post-await "still current" check, synced
  // in a layout effect so a resolution racing the commit of a new
  // eventId/locale already sees the new values (no microtask gap).
  const eventIdRef = useRef(eventId);
  const localeRef = useRef(locale);

  // SSR seeds for the acceptance reset. Read through refs so the reset
  // keys on [eventId, locale] only — a parent re-render that passes the
  // same seed values must not start a new generation (that would drop
  // every in-flight response).
  const seedRevRef = useRef(initialRev);
  const seedCapturedAtRef = useRef(initialCapturedAt);
  useLayoutEffect(() => {
    seedRevRef.current = initialRev;
    seedCapturedAtRef.current = initialCapturedAt;
  }, [initialRev, initialCapturedAt]);

  useLayoutEffect(() => {
    eventIdRef.current = eventId;
    localeRef.current = locale;
    failuresRef.current = 0;
    const seed = {
      rev: seedRevRef.current,
      capturedAt: seedCapturedAtRef.current,
    };
    if (acceptanceRef.current === null) {
      acceptanceRef.current = new SnapshotAcceptance(seed);
    } else {
      // New generation: late responses for the previous event/locale
      // are discarded by `evaluate` without touching state.
      acceptanceRef.current.reset(seed);
    }
  }, [eventId, locale]);

  // Re-sync from props only when the event or the locale actually
  // changes — the "track previous prop" idiom (React docs: "Storing
  // information from previous renders"). Callers pass fresh array refs
  // every render; syncing on those would thrash state. Locale is part
  // of the key because the displayed items/wishes carry translations:
  // keeping the old locale's data on screen until the next fetch would
  // show mixed-language content if the same mounted hook ever switched
  // locale (the acceptance generation already resets on both).
  const snapshotKey = `${eventId}\u0000${locale}`;
  const [prevSnapshotKey, setPrevSnapshotKey] = useState(snapshotKey);
  if (prevSnapshotKey !== snapshotKey) {
    setPrevSnapshotKey(snapshotKey);
    setItems(initialItems);
    setReactionCounts(initialReactionCounts);
    setTop3Wishes(initialTop3Wishes);
    setStatus(null);
    setStartTime(null);
    setStartTimeLocalMs(null);
    setLastUpdated(null);
    setFreshness(INITIAL_FRESHNESS);
    setRev(seedRev(initialRev));
    setCapturedAt(seedCapturedAt(initialCapturedAt));
    setGone(false);
  }

  const resetFailures = useCallback(() => {
    failuresRef.current = 0;
  }, []);

  /**
   * Raise the acceptance watermark to the CURRENT `initialRev` /
   * `initialCapturedAt` props (never lowers it, no new generation).
   * `useSetlistPolling` calls this when it is switched on, so a caller
   * that passes the newest version it has already shown as those props
   * can't be rolled back by the first polled response.
   */
  const adoptSeed = useCallback(() => {
    acceptanceRef.current?.adopt({
      rev: seedRevRef.current,
      capturedAt: seedCapturedAtRef.current,
    });
  }, []);

  /**
   * Builds the runner for one session (one channel-effect run, one
   * polling-effect run). Captures eventId/locale/generation at call
   * time; responses that resolve after any of them changed — or after
   * `abort()` — are dropped as `cancelled`.
   */
  const createRunner = useCallback(
    (onFailure?: (info: SnapshotFailureInfo) => void): SnapshotRunner => {
      const fetchEventId = eventId;
      const fetchLocale = locale;
      // Created in the layout effect, which runs before any effect that
      // calls createRunner; the fallback keeps this total anyway.
      if (acceptanceRef.current === null) {
        acceptanceRef.current = new SnapshotAcceptance({
          rev: seedRevRef.current,
          capturedAt: seedCapturedAtRef.current,
        });
      }
      const acceptance = acceptanceRef.current;
      const generation = acceptance.generation;
      let cancelled = false;
      const controllers = new Set<AbortController>();

      const isLive = () =>
        !cancelled &&
        acceptance.generation === generation &&
        eventIdRef.current === fetchEventId &&
        localeRef.current === fetchLocale;

      const apply = (body: SnapshotBody<T>, version: SnapshotVersion | null) => {
        setItems(body.items);
        setReactionCounts(body.reactionCounts ?? {});
        // `?? []`: a response that omits the slice resets to empty rather
        // than leaving the SSR seed on screen indefinitely.
        setTop3Wishes(body.top3Wishes ?? []);
        // Only update `status` when the field is present. A transient
        // missing/null field would otherwise re-unlock the wishlist +
        // predicted-setlist editors mid-show (CR #297). Stale-but-
        // correct beats an unintended unlock.
        if ("status" in body) {
          setStatus(body.status ?? null);
        }
        // Apply timing under the same revision/generation gate as status.
        // Old servers or malformed fields must not erase a known schedule.
        if (typeof body.startTime === "string" && Number.isFinite(Date.parse(body.startTime))) {
          setStartTime(body.startTime);
          const serverNow = typeof body.servedAt === "string" ? Date.parse(body.servedAt) : NaN;
          // A fast client clock must not spend its only boundary read before
          // the server's start. Network transit can delay this wake-up, never
          // make it early. A still-upcoming reply recalculates the remaining wait.
          setStartTimeLocalMs(Number.isFinite(serverNow)
            ? Date.now() + Date.parse(body.startTime) - serverNow
            : Date.parse(body.startTime));
        }
        setLastUpdated(pickLastUpdated(body));
        // Compat (no `rev`) responses leave the exposed watermark as is.
        if (version !== null) {
          setRev(version.rev);
          const appliedAt = acceptance.applied.capturedAt;
          setCapturedAt(
            appliedAt === null ? null : new Date(appliedAt).toISOString(),
          );
        }
      };

      const runFetch = (reason: LiveFetchReason, request?: LiveFetchRequest) =>
        new Promise<LiveFetchOutcome>((resolve) => {
          // A caller without a descriptor (none today — every scheduler
          // passes one) gets the plain maintenance request.
          const hint = request?.hint ?? null;
          const notify = request?.notify === true;
          let settled = false;
          const finish = (outcome: LiveFetchOutcome) => {
            if (settled) return;
            settled = true;
            resolve(outcome);
          };
          // n13 failure bookkeeping for a request that is still
          // current: bump the consecutive count, surface it as
          // freshness, and hand the scheduler the next retry delay.
          //
          // A `Retry-After` (the route's 503 under overload) is ALSO
          // handed over as `notBeforeMs` — the scheduler's floor that
          // holds back every trigger, not just this retry (see
          // liveScheduler.ts). One parse, one clamp: the retry delay
          // and the floor are the same number. The failure still
          // counts toward SNAPSHOT_DELAYED_AFTER_FAILURES like any
          // other non-OK response.
          //
          // `hintOutcome` is set only when the response DID evaluate the
          // request's hint ticket and still failed (a server-proven
          // gap): the scheduler then settles the ticket from it. Without
          // it (HTTP / network / deadline) the ticket rides on the retry.
          const fail = (
            retryAfterMs: number | null,
            hintOutcome?: LiveHintOutcome,
          ) => {
            if (settled) return;
            if (!isLive()) {
              finish(CANCELLED);
              return;
            }
            failuresRef.current += 1;
            const failures = failuresRef.current;
            setFreshness((prev) => ({
              lastSyncAt: prev.lastSyncAt,
              state: freshnessStateFor(failures),
            }));
            const delayMs = snapshotRetryDelayMs(failures, retryAfterMs);
            onFailure?.({ failures, delayMs, reason });
            finish({
              kind: "failed",
              retryInMs: delayMs,
              notBeforeMs:
                retryAfterMs === null ? null : clampRetryAfterMs(retryAfterMs),
              ...(hintOutcome ? { hint: hintOutcome } : {}),
            });
          };

          const controller = new AbortController();
          controllers.add(controller);
          // The deadline settles the request as a failure synchronously
          // (before the abort propagates), so the scheduler's single-
          // flight guard is released even if a runtime's fetch never
          // settles after abort.
          const deadline = armSnapshotDeadline(controller, () => fail(null));

          void (async () => {
            try {
              // Default fetch cache mode: the n14 snapshot response is
              // `public, max-age=0, must-revalidate`, so the browser
              // revalidates every time anyway. `no-store` would only
              // forbid conditional requests the server may answer
              // cheaply later.
              //
              // URL per the scheduler's descriptor (liveScheduler.ts,
              // `LiveFetchRequest`): `minRev = serverRev` for a request
              // without a ticket, `max(serverRev, H)` with one, and
              // `&hint=1` only on a notification fetch (first check of
              // H, non-generic). Hints never enter the durable `minRev`.
              const minRev = acceptance.minRevFor(hint);
              const res = await fetch(
                setlistSnapshotUrl(fetchEventId, fetchLocale, minRev, notify),
                { signal: controller.signal },
              );
              if (settled) return;
              if (!isLive()) {
                finish(CANCELLED);
                return;
              }
              if (res.status === 404) {
                // The event is missing or soft-deleted (the route's
                // `{ error: "not_found" }`). NOT a failure: no failure
                // count, no freshness change, no retry — a retry can
                // only ever get the same answer, and with the backoff
                // capped at 30 s it would poll a dead event for as long
                // as the tab stays open. `gone` makes the scheduler
                // stop itself; the state flip lets the owning hook
                // release the channel. Checked before `!res.ok` so it
                // can never fall into the transport-failure path below.
                // Only a 404 from `/api/setlist` itself reaches here:
                // the request was live (`isLive()` above), so it is this
                // event/locale's answer, not a stale one.
                setGone(true);
                finish(GONE);
                return;
              }
              if (!res.ok) {
                fail(parseRetryAfterMs(res.headers?.get("Retry-After")));
                return;
              }
              const body = (await res.json()) as SnapshotBody<T> | null;
              if (settled) return;
              if (!isLive()) {
                finish(CANCELLED);
                return;
              }
              if (!body || !Array.isArray(body.items)) {
                fail(null);
                return;
              }
              // Per-request verification metadata. Absent or malformed
              // (an R1 server after a rollback, a proxy) parses as
              // `missing`, which can only ever be inconclusive.
              const verify = parseSnapshotVerify(
                res.headers?.get?.(SNAPSHOT_VERIFY_HEADER) ?? null,
              );
              const verdict = acceptance.evaluate(generation, body, verify, hint);
              if (verdict.kind === "stale-generation") {
                finish(CANCELLED);
                return;
              }
              if (verdict.apply) apply(body, verdict.version);
              const hintOutcome = hintOutcomeFor(verdict.hint);
              if (verdict.serverGap) {
                // Older than a revision the server itself showed us —
                // including a `fresh` dbRev reported with this very
                // response: a stale cache somewhere. Soft failure → n13
                // retry path (and, if it persists, the "delayed" state —
                // legitimate here because the gap is server-proven).
                fail(null, hintOutcome);
                return;
              }
              // Healthy sync. A ticket that was satisfied or disproved is
              // done; an inconclusive one (memo / deferred / missing
              // header) asks the scheduler for its one quiet recheck and
              // counts ZERO failures: an unauthenticated hint must never
              // drive the "delayed" indicator.
              failuresRef.current = 0;
              setFreshness({ lastSyncAt: new Date(), state: "live" });
              finish(hintOutcome ? { kind: "ok", hint: hintOutcome } : OK);
            } catch {
              // Cleanup aborts resolve as cancelled inside `fail`
              // (isLive() is false); network/JSON errors are failures.
              fail(null);
            } finally {
              deadline.clear();
              controllers.delete(controller);
            }
          })();
        });

      return {
        runFetch,
        // Scoped to this runner's generation: a payload for a previous
        // event/locale session must not seed the new one's batch.
        noteHint: (rev: unknown) =>
          acceptance.generation === generation && acceptance.noteHint(rev),
        captureHint: () =>
          acceptance.generation === generation ? acceptance.captureHint() : null,
        abort: () => {
          cancelled = true;
          for (const controller of controllers) controller.abort();
          controllers.clear();
        },
      };
    },
    [eventId, locale],
  );

  const data: LiveSnapshotData<T> = {
    items,
    reactionCounts,
    top3Wishes,
    status,
    startTime,
    startTimeLocalMs,
    lastUpdated,
    freshness,
    rev,
    capturedAt,
    gone,
  };

  return { data, createRunner, resetFailures, adoptSeed };
}
