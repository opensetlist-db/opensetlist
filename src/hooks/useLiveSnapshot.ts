"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { FanTop3Entry, ReactionCountsMap } from "@/lib/types/setlist";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import {
  INITIAL_FRESHNESS,
  armSnapshotDeadline,
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
  type SnapshotVersion,
} from "@/lib/snapshotAcceptance";
import type { LiveFetchOutcome, LiveFetchReason } from "@/lib/liveScheduler";

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
  /**
   * Non-null once a snapshot has been applied in this browser. Callers
   * use it as "client data is now authoritative" (LiveEventLayout's
   * sidebar gate, the R3 fallback hand-over). Value: the response's
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
}

/** Body of `/api/setlist` (n14 contract; older fields tolerated). */
interface SnapshotBody<T> {
  items: T[];
  reactionCounts?: ReactionCountsMap;
  top3Wishes?: FanTop3Entry[];
  status?: ResolvedEventStatus | null;
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
 * silently (cleanup, not failure).
 */
export interface SnapshotRunner {
  runFetch: (reason: LiveFetchReason) => Promise<LiveFetchOutcome>;
  abort: () => void;
}

const CANCELLED: LiveFetchOutcome = { kind: "cancelled" };
const OK: LiveFetchOutcome = { kind: "ok" };

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
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<Freshness>(INITIAL_FRESHNESS);
  const [rev, setRev] = useState<number | null>(() => seedRev(initialRev));
  const [capturedAt, setCapturedAt] = useState<string | null>(() =>
    seedCapturedAt(initialCapturedAt),
  );

  // Consecutive snapshot failures. Hook-scoped (not session-scoped) so
  // the count — and therefore the "delayed" indicator — survives the
  // realtime channel effect re-running on a visibility pause or a
  // fallback recovery attempt; reset on success and on event change.
  // Polling additionally resets it per polling session.
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

  // Re-sync from props only when eventId actually changes — the "track
  // previous prop" idiom (React docs: "Storing information from previous
  // renders"). Callers pass fresh array refs every render; syncing on
  // those would thrash state.
  const [prevEventId, setPrevEventId] = useState(eventId);
  if (prevEventId !== eventId) {
    setPrevEventId(eventId);
    setItems(initialItems);
    setReactionCounts(initialReactionCounts);
    setTop3Wishes(initialTop3Wishes);
    setStatus(null);
    setLastUpdated(null);
    setFreshness(INITIAL_FRESHNESS);
    setRev(seedRev(initialRev));
    setCapturedAt(seedCapturedAt(initialCapturedAt));
  }

  const resetFailures = useCallback(() => {
    failuresRef.current = 0;
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

      const runFetch = (reason: LiveFetchReason) =>
        new Promise<LiveFetchOutcome>((resolve) => {
          let settled = false;
          const finish = (outcome: LiveFetchOutcome) => {
            if (settled) return;
            settled = true;
            resolve(outcome);
          };
          // n13 failure bookkeeping for a request that is still
          // current: bump the consecutive count, surface it as
          // freshness, and hand the scheduler the next retry delay.
          const fail = (retryAfterMs: number | null) => {
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
            finish({ kind: "failed", retryInMs: delayMs });
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
              // `minRev`: a notification-triggered request asks for one
              // past the applied revision as a single-use hint (see
              // `notificationMinRev` — closes the push-beats-cache-purge
              // window); everything else asks for the highest revision
              // the server has shown us.
              const minRev =
                reason === "notification"
                  ? acceptance.notificationMinRev()
                  : acceptance.minRevToSend();
              const res = await fetch(
                setlistSnapshotUrl(fetchEventId, fetchLocale, minRev),
                { signal: controller.signal },
              );
              if (settled) return;
              if (!isLive()) {
                finish(CANCELLED);
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
              const verdict = acceptance.evaluate(generation, body);
              if (verdict.kind === "stale-generation") {
                finish(CANCELLED);
                return;
              }
              if (verdict.apply) apply(body, verdict.version);
              if (verdict.serverGap) {
                // Older than a revision the server already showed us:
                // a stale cache somewhere. Soft failure → n13 retry
                // path (and, if it persists, the "delayed" state —
                // legitimate here because the gap is server-proven).
                fail(null);
                return;
              }
              // `verdict.hintGap` (R2 only) is deliberately not a
              // failure: an unauthenticated hint is check-once — this
              // request carried it as `minRev`, which was the check.
              failuresRef.current = 0;
              setFreshness({ lastSyncAt: new Date(), state: "live" });
              finish(OK);
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
    lastUpdated,
    freshness,
    rev,
    capturedAt,
  };

  return { data, createRunner, resetFailures };
}
