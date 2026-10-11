import { after } from "next/server";
import {
  BUILD_KEY,
  decodeCacheValue,
  encodeCacheValue,
  warmEntryCache,
  warmEventTag,
  WARM_PUBLIC_DATA_TAG,
} from "@/lib/dataCache";
import { describeError } from "@/lib/dbErrors";
import { INSTANCE_ID } from "@/lib/instanceId";
import { revToNumber } from "@/lib/liveBroadcast";
import { locales, type Locale } from "@/i18n/routing";
// Type-only: erased at compile time, so it adds no runtime import edge.
// The builder itself is loaded lazily inside the job (see `runWarmJob`).
import type { EventSnapshot } from "@/lib/liveSnapshot";

/**
 * n14 writer warming — a FLAGGED optimisation of the live path.
 *
 * Problem it addresses: every live save purges the event's data-cache
 * tag and broadcasts the new revision; hundreds of viewers then fetch
 * `/api/setlist` within the jitter window, Vercel spreads them over
 * 40–100 function instances, and every instance misses and rebuilds the
 * same snapshot (the "storm") — in every client's critical path, on the
 * pooler's 15 backends.
 *
 * Mechanism:
 *   - Writer (`scheduleWarm`, called by `liveWriterTransaction` only
 *     after the transaction resolved with a new revision R): registers a
 *     Next `after()` job that builds the snapshot for every locale and
 *     stores each in Vercel's Runtime Cache (regional, shared by the
 *     instances of the deployment) under `<eventId>:<locale>:<R>`.
 *   - Reader (`warmLookup`, called by `getLiveSnapshot` only for a
 *     notification fetch — `?hint=1` with `?minRev=R`): one bounded GET
 *     of exactly that key. A valid entry is served as is; anything else
 *     falls through to the unchanged verified path.
 *
 * Why an entry is "at least R", never "exactly R": the job builds AFTER
 * the commit, so a later save may already have committed by the time
 * its REPEATABLE READ snapshot is taken. The entry keeps the snapshot's
 * ACTUAL `rev` (≥ R) and `capturedAt` — never relabelled to R — so a
 * client that receives it orders it correctly by `(rev, capturedAt)`,
 * and the R key is only an address ("a snapshot that already contains
 * save R"), not a claim about what it contains. Relabelling would let
 * a newer state masquerade as an older revision and break the client's
 * monotonic acceptance.
 *
 * Why lookup-only on the read side: a reader never builds into this
 * cache and never writes it. Keys can only be minted by a server that
 * just committed revision R, so a forged `minRev` (the broadcast
 * channel is public) is merely a miss — it cannot make the server build
 * or store anything — and the verified path still answers it. A
 * reader-side fill would reopen exactly the "a client hint decides what
 * gets built" hole the R2 hint contract closed.
 *
 * Why `set` is best-effort: the SDK's HTTP client swallows every `set`
 * error (and times out at 500 ms) and only logs it, and the Runtime
 * Cache may evict before the TTL. An awaited `set` therefore does not
 * prove publication; `ok=true` in the log line only means "no
 * exception reached us". Nothing depends on the entry existing — a
 * missing entry is a miss on the reader side, which takes the normal
 * path.
 *
 * Why the flag needs a redeploy: `LIVE_WARM_ENTRIES` is a server env
 * var, and Vercel binds env vars to a deployment at build/deploy time.
 * Flipping it in the dashboard changes nothing until the next
 * deployment. The rollback target is therefore a qualified deployment
 * with the flag unset (warming off), promoted instantly — not an env
 * edit. Off (the default) means: no `after()` job, no Runtime Cache
 * traffic on the read path, byte-for-byte the R2 behaviour.
 *
 * The in-memory fallback: off Vercel (local dev, unit and integration
 * tests) `getCache` finds neither the Vercel request context's cache
 * nor `RUNTIME_CACHE_ENDPOINT`, warns once, and uses a per-process
 * in-memory map. Tests therefore exercise the codec, the envelope and
 * the validation end to end within ONE process, but nothing here can
 * prove cross-instance visibility, regional sharing, eviction or the
 * real `set` latency — those are only observable on a Vercel
 * deployment (preview or production).
 */

/**
 * Whether warming is on for this deployment. Read per call (tests flip
 * it); on Vercel the value is fixed for the deployment's lifetime.
 */
export function liveWarmEnabled(): boolean {
  return process.env.LIVE_WARM_ENTRIES === "1";
}

// Builds per job in parallel. Each build is one REPEATABLE READ
// transaction holding one of this instance's 2 pool connections
// (`src/lib/prisma.ts`), so 2 is the most that can run at once anyway;
// a third would only queue on the pool. Running 2 shortens the job
// (3 locales ≈ 2 build times instead of 3) at the cost of leaving no
// free slot for readers that land on the writer's instance during the
// job — they queue behind it (bounded by the build's own `maxWait`).
// `LIVE_WARM_CONCURRENCY=1` makes the job sequential so the two can be
// measured against each other; any other value means 2.
function warmConcurrency(): number {
  return process.env.LIVE_WARM_CONCURRENCY === "1" ? 1 : 2;
}

/** Seconds a warm entry lives. Covers the notification window (jitter +
 *  cooldown + one recheck) with margin; the key is per revision, so a
 *  long TTL never serves a superseded revision to a newer `minRev`. */
export const WARM_TTL_SECONDS = 90;

/** Largest encoded snapshot stored (UTF-8 bytes of the codec output).
 *  Typical live snapshots are tens of KB; anything near 1 MB is a
 *  symptom, and the Runtime Cache is not the place to find out its
 *  item limit. */
export const WARM_MAX_BYTES = 1_000_000;

/** Hard bound of the reader's lookup. */
export const WARM_LOOKUP_TIMEOUT_MS = 300;

const ENVELOPE_SCHEMA = 1;

/**
 * What is stored. Identity fields are repeated outside the payload so
 * the reader can reject a mismatched entry before decoding it.
 *
 *   atLeastRev  R — the revision whose commit triggered the job (= the
 *               key's revision)
 *   rev         the snapshot's actual revision (≥ R, JSON number)
 *   capturedAt  the snapshot's actual `capturedAt` (ISO); the client's
 *               same-revision ordering needs it, so an entry without a
 *               parseable one is a miss
 *   builtAt     when the build finished (ISO, diagnostics)
 *   bytes       UTF-8 length of `payload`
 *   payload     the snapshot, encoded with the data-cache codec
 *               (bigint / Date survive the JSON round trip)
 */
export type WarmEnvelope = {
  schema: typeof ENVELOPE_SCHEMA;
  eventId: string;
  locale: Locale;
  atLeastRev: number;
  rev: number;
  capturedAt: string;
  builtAt: string;
  bytes: number;
  payload: string;
};

/**
 * Cache key before hashing. The deployment discriminator (`BUILD_KEY`,
 * as in the data cache) keeps a reader from decoding an entry written by
 * another deployment's code, whose snapshot shape may differ — the
 * Runtime Cache can outlive a deploy by up to the TTL.
 */
export function warmKey(eventId: bigint, locale: Locale, atLeastRev: bigint | number): string {
  return `${eventId}:${locale}:${atLeastRev}:${BUILD_KEY}`;
}

export function encodeWarmEnvelope(
  eventId: bigint,
  locale: Locale,
  atLeastRev: bigint,
  snapshot: EventSnapshot,
  builtAt: Date,
): WarmEnvelope {
  const payload = encodeCacheValue(snapshot);
  return {
    schema: ENVELOPE_SCHEMA,
    eventId: eventId.toString(),
    locale,
    atLeastRev: revToNumber(atLeastRev),
    rev: revToNumber(snapshot.rev),
    capturedAt: snapshot.capturedAt.toISOString(),
    builtAt: builtAt.toISOString(),
    bytes: Buffer.byteLength(payload, "utf8"),
    payload,
  };
}

export type WarmDecode =
  | { ok: true; snapshot: EventSnapshot }
  | { ok: false; reason: "stale" | "invalid" };

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Validate a stored value against the request and decode it. Every
 * check failing is a miss for the caller (it takes the verified path);
 * `stale` (an entry whose actual revision is below the requested one —
 * impossible for an honest key, since the key's R ≤ rev) is reported
 * apart from `invalid` only for the log.
 */
export function decodeWarmEnvelope(
  value: unknown,
  eventId: bigint,
  locale: Locale,
  minRev: number,
): WarmDecode {
  const invalid = { ok: false, reason: "invalid" } as const;
  if (!isObject(value)) return invalid;
  const e = value;
  if (e.schema !== ENVELOPE_SCHEMA) return invalid;
  if (e.eventId !== eventId.toString() || e.locale !== locale) return invalid;
  if (e.atLeastRev !== minRev) return invalid;
  if (typeof e.rev !== "number" || !Number.isSafeInteger(e.rev) || e.rev < 0) {
    return invalid;
  }
  if (typeof e.capturedAt !== "string" || !Number.isFinite(Date.parse(e.capturedAt))) {
    return invalid;
  }
  if (
    typeof e.payload !== "string" ||
    typeof e.bytes !== "number" ||
    e.bytes > WARM_MAX_BYTES ||
    Buffer.byteLength(e.payload, "utf8") !== e.bytes
  ) {
    return invalid;
  }
  if (e.rev < minRev) return { ok: false, reason: "stale" };

  let snapshot: EventSnapshot;
  try {
    snapshot = decodeCacheValue<EventSnapshot>(e.payload);
  } catch {
    return invalid;
  }
  // The payload must be the snapshot the envelope describes, and carry
  // the fields `resolveSnapshotForResponse` and the route read.
  if (
    !isObject(snapshot) ||
    typeof snapshot.rev !== "bigint" ||
    snapshot.rev !== BigInt(e.rev) ||
    !(snapshot.capturedAt instanceof Date) ||
    Number.isNaN(snapshot.capturedAt.getTime()) ||
    snapshot.capturedAt.toISOString() !== e.capturedAt ||
    typeof snapshot.found !== "boolean" ||
    typeof snapshot.isDeleted !== "boolean" ||
    !Array.isArray(snapshot.items) ||
    !isObject(snapshot.reactionCounts) ||
    !Array.isArray(snapshot.top3Wishes) ||
    typeof snapshot.buildId !== "string"
  ) {
    return invalid;
  }
  return { ok: true, snapshot };
}

// ---------------------------------------------------------------------
// Fault injection at the warm-cache boundary (drills only)
//
// Why it exists: "a warm miss takes the old path" proves a fallback,
// not capacity under widespread misses. Qualifying warming therefore
// needs drills at full load in which the Runtime Cache is absent, slow,
// failing, or only partly published — and the obvious platform knobs do
// not produce those faults: `RUNTIME_CACHE_TIMEOUT` only configures the
// SDK's fallback HTTP client (a deployed function prefers the request
// context's cache, so it may never apply), a different namespace merely
// moves the key prefix, the SDK turns HTTP errors into `null` (= a
// plain `miss`, never `error`), and a very short SDK timeout still does
// not exercise OUR 300 ms deadline (`WARM_LOOKUP_TIMEOUT_MS`). So the
// fault is injected here, in our code, around the cache handle's
// `get` / `set` and the warm job's per-locale step, and every affected
// log line names it (`fault=<spec>`) so a drill can prove that the
// intended fault was actually active before its numbers are trusted.
//
// Arming: `LIVE_WARM_FAULT_ARMED=1` AND `LIVE_WARM_FAULT=<spec>` AND
// `VERCEL_ENV` is not `production`. Two variables, so a stray
// `LIVE_WARM_FAULT` copied between environments injects nothing on its
// own; the production check is a hard stop even when both are set (one
// `fault-blocked` line per process says someone tried). Like the
// warming flag, Vercel binds env vars at deploy time, so on a deployment
// the fault is fixed for its lifetime — the drills use a disposable
// preview deployment (tests/load/README.md, "warming fault drills").
// All three are read per call, which keeps tests able to flip them;
// unarmed, the cost is one env lookup and a string compare per call,
// before any parsing or allocation.
//
// Spec: comma-separated modes, combinable (e.g. `slow=400,locale=ja`):
//   absent        lookups skip the `get` entirely → `miss` ("no entry")
//   slow=<ms>     each `get` waits <ms> before running normally; ≥ 300
//                 trips the reader deadline (`timeout`), below it is a
//                 slow hit. The wait sits inside the shared in-flight
//                 `get`, so it holds the key's slot exactly as a slow
//                 cache would
//   getnull       the `get` runs, then its value is dropped → `miss`
//                 with real cache latency
//   geterror      the `get` runs, then rejects → `error`
//   seterror      the warm job's `set` rejects without storing →
//                 `set … ok=false`, nothing published
//   setskip       the `set` silently does nothing → `ok=true` but the
//                 entry is absent (what the SDK's swallowed `set` errors
//                 look like from here)
//   locale=<l>    the warm job skips that locale's build + set
//                 (`skip reason=fault-locale`) → partial publication;
//                 repeatable for several locales
//   slowjob=<ms>  each locale's build starts <ms> later → warm-complete
//                 − commit grows; hinted fetches arrive before publication
// An unparseable spec injects NOTHING (one `fault-invalid` line): a
// drill must not run on a half-understood fault, and the missing
// `fault=` on the log lines makes the mistake visible.
// ---------------------------------------------------------------------

export type WarmFault = {
  /** Normalised spec in its log encoding (`slow:400+locale:ja`, see
   *  `oneToken`), as logged in `fault=` / `mode=`. */
  label: string;
  absent: boolean;
  slowMs: number;
  getNull: boolean;
  getError: boolean;
  setError: boolean;
  setSkip: boolean;
  skipLocales: ReadonlySet<Locale>;
  slowJobMs: number;
};

// Upper bound for the delay modes: well past every deadline they are
// meant to cross (300 ms lookup; a warm job's whole budget is seconds),
// low enough that a typo like `slow=40000` cannot pin a function.
const FAULT_MAX_DELAY_MS = 10_000;

/** Parse a fault spec. `null` = unparseable (nothing is injected). */
export function parseWarmFault(spec: string): WarmFault | null {
  // An empty token (`slow=400,,locale=ja`, a trailing comma) is a
  // malformed spec, not something to tolerate: the rule is that anything
  // off-grammar injects nothing, so a typo shows up as `fault-invalid`
  // instead of silently arming a partial fault.
  const tokens = spec.split(",").map((t) => t.trim());
  if (tokens.length === 0 || tokens.some((t) => t === "")) return null;
  const f = {
    absent: false,
    slowMs: 0,
    getNull: false,
    getError: false,
    setError: false,
    setSkip: false,
    skipLocales: new Set<Locale>(),
    slowJobMs: 0,
  };
  const delay = (v: string): number | null => {
    if (!/^\d+$/.test(v)) return null;
    const ms = Number(v);
    return ms > 0 && ms <= FAULT_MAX_DELAY_MS ? ms : null;
  };
  for (const t of tokens) {
    const eq = t.indexOf("=");
    const name = eq < 0 ? t : t.slice(0, eq);
    const value = eq < 0 ? null : t.slice(eq + 1);
    if (value === null) {
      if (name === "absent") f.absent = true;
      else if (name === "getnull") f.getNull = true;
      else if (name === "geterror") f.getError = true;
      else if (name === "seterror") f.setError = true;
      else if (name === "setskip") f.setSkip = true;
      else return null;
    } else if (name === "slow" || name === "slowjob") {
      const ms = delay(value);
      if (ms === null) return null;
      if (name === "slow") f.slowMs = ms;
      else f.slowJobMs = ms;
    } else if (name === "locale") {
      if (!(locales as readonly string[]).includes(value)) return null;
      f.skipLocales.add(value as Locale);
    } else {
      return null;
    }
  }
  return { ...f, label: oneToken(tokens.join(",")) };
}

// What was last announced (`armed:` / `invalid:` / `blocked:` + spec),
// so each distinct state logs exactly one line per process, and the
// parse of the last spec seen (the spec is fixed per deployment, so
// this parses once).
let faultAnnounced: string | null = null;
let faultParsed: { spec: string; fault: WarmFault | null } | null = null;

// The spec as ONE log value: no whitespace, `=` → `:`, `,` → `+`
// (`slow=400,locale=ja` → `slow:400+locale:ja`). Log consumers parse
// lines as space-separated `key=value` pairs; a raw spec inside a value
// would carry an inner `locale=ja` that a non-greedy or comma-splitting
// tokenizer reads as the line's own `locale` field, misattributing a
// lookup in exactly the combined drills that rely on the logs.
const oneToken = (s: string) => s.replace(/\s+/g, "").replace(/=/g, ":").replace(/,/g, "+");

/** The active fault, or `null` (unarmed, production, or unparseable). */
export function activeWarmFault(): WarmFault | null {
  // Unarmed fast path: the only work on every normal call.
  if (process.env.LIVE_WARM_FAULT_ARMED !== "1") return null;
  const spec = process.env.LIVE_WARM_FAULT ?? "";
  if (spec === "") return null;
  if (process.env.VERCEL_ENV === "production") {
    if (faultAnnounced !== `blocked:${spec}`) {
      faultAnnounced = `blocked:${spec}`;
      console.log(
        `[liveWarm] fault-blocked mode=${oneToken(spec)} reason=production ` +
          `instance=${INSTANCE_ID}`,
      );
    }
    return null;
  }
  if (faultParsed?.spec !== spec) faultParsed = { spec, fault: parseWarmFault(spec) };
  const { fault } = faultParsed;
  const state = fault ? `armed:${fault.label}` : `invalid:${spec}`;
  if (faultAnnounced !== state) {
    faultAnnounced = state;
    console.log(
      fault
        ? `[liveWarm] fault armed mode=${fault.label} instance=${INSTANCE_ID}`
        : `[liveWarm] fault-invalid mode=${oneToken(spec)} injected=none ` +
            `instance=${INSTANCE_ID}`,
    );
  }
  return fault;
}

/** ` fault=<label>` for a log line while a fault is active, else "". */
function faultTag(fault: WarmFault | null): string {
  return fault ? ` fault=${fault.label}` : "";
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The reader's `get`, with the active fault (if any) applied. */
async function faultyGet(key: string, fault: WarmFault | null): Promise<unknown> {
  if (!fault) return warmEntryCache().get(key);
  if (fault.slowMs > 0) await sleep(fault.slowMs);
  if (fault.absent) return null;
  const value = await warmEntryCache().get(key);
  // Applied after the real round trip, so the drill keeps the cache's
  // actual latency instead of an instant answer no real outage gives.
  if (fault.getError) throw new Error("injected fault: geterror");
  if (fault.getNull) return null;
  return value;
}

/** The warm job's `set`, with the active fault (if any) applied. */
async function faultySet(
  key: string,
  value: WarmEnvelope,
  options: { ttl: number; tags: string[] },
  fault: WarmFault | null,
): Promise<void> {
  if (fault?.setError) throw new Error("injected fault: seterror");
  if (fault?.setSkip) return;
  await warmEntryCache().set(key, value, options);
}

// ---------------------------------------------------------------------
// Writer side
// ---------------------------------------------------------------------

/**
 * Register the warm job for revision `rev` of `eventId`. Call only after
 * the writer transaction RESOLVED (committed) with that revision — a
 * failed or rolled-back save must never warm. No-op unless the flag is
 * on. Never throws: the save has already committed, and a warming
 * problem must not turn it into an error response.
 *
 * `after()` runs the job once the writer's response has been sent, under
 * the route's own duration limit; outside a Next request scope it
 * throws, which is caught and logged here.
 */
export function scheduleWarm(eventId: bigint, rev: bigint): void {
  if (!liveWarmEnabled()) return;
  try {
    after(() => runWarmJob(eventId, rev));
  } catch (err) {
    console.log(
      `[liveWarm] schedule-failed event=${eventId} rev=${rev} ` +
        `err=${describeError(err)} instance=${INSTANCE_ID}`,
    );
  }
}

/**
 * The warm job: build + store every locale, at most `warmConcurrency()`
 * builds at a time. Exported so tests can run it without `after()`.
 * Never rejects; every outcome is a log line:
 *
 *   [liveWarm] start event=<id> rev=<R> instance=<id>[ fault=<spec>]
 *   [liveWarm] set event=<id> locale=<l> atLeastRev=<R> rev=<n> bytes=<n> buildMs=<n> setMs=<n> ok=<true|false> instance=<id>
 *   [liveWarm] skip event=<id> locale=<l> atLeastRev=<R> reason=<build-error|oversize|fault-locale> rev=<n|-> bytes=<n|-> buildMs=<n> instance=<id>
 *   [liveWarm] done event=<id> rev=<R> ms=<n> instance=<id>
 *
 * `set` is logged only when a `set` was attempted (ok=false = it
 * threw); `skip` when the locale was not stored at all. A build failure
 * additionally produces the builder's own `[liveSnapshot] build-failed`
 * line.
 */
export async function runWarmJob(eventId: bigint, rev: bigint): Promise<void> {
  const started = Date.now();
  // Read once per job: on a deployment it cannot change mid-job anyway,
  // and one value keeps the start line and the per-locale steps agreeing.
  const fault = activeWarmFault();
  console.log(
    `[liveWarm] start event=${eventId} rev=${rev} instance=${INSTANCE_ID}${faultTag(fault)}`,
  );
  try {
    // Loaded here rather than imported at the top: `liveSnapshot.ts`
    // imports this module (the reader's `warmLookup`), and a static
    // import back would make the two modules a cycle. By the time a job
    // runs, the module is normally loaded already.
    const { buildEventSnapshot } = await import("@/lib/liveSnapshot");
    const queue = [...locales];
    const worker = async () => {
      for (let locale = queue.shift(); locale; locale = queue.shift()) {
        if (fault) {
          // Injected partial publication: the locale is neither built
          // nor stored, exactly as if its build had been lost — but
          // logged with its own reason so the summariser's build
          // matching (which only claims `set` / `oversize` locales)
          // and the drill report can tell it from a real failure.
          if (fault.skipLocales.has(locale)) {
            console.log(
              `[liveWarm] skip event=${eventId} locale=${locale} atLeastRev=${rev} ` +
                `reason=fault-locale rev=- bytes=- buildMs=0 instance=${INSTANCE_ID}`,
            );
            continue;
          }
          if (fault.slowJobMs > 0) await sleep(fault.slowJobMs);
        }
        await warmOneLocale(eventId, locale, rev, buildEventSnapshot, fault);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(warmConcurrency(), queue.length) }, worker),
    );
  } catch (err) {
    // Only the lazy import can land here; per-locale failures are
    // handled (and logged) inside `warmOneLocale`.
    console.log(
      `[liveWarm] job-failed event=${eventId} rev=${rev} ` +
        `err=${describeError(err)} instance=${INSTANCE_ID}`,
    );
  }
  console.log(
    `[liveWarm] done event=${eventId} rev=${rev} ms=${Date.now() - started} ` +
      `instance=${INSTANCE_ID}`,
  );
}

async function warmOneLocale(
  eventId: bigint,
  locale: Locale,
  atLeastRev: bigint,
  build: (eventId: bigint, locale: Locale) => Promise<EventSnapshot>,
  fault: WarmFault | null,
): Promise<void> {
  const head = `event=${eventId} locale=${locale} atLeastRev=${atLeastRev}`;
  const buildStarted = Date.now();
  let envelope: WarmEnvelope;
  try {
    const snapshot = await build(eventId, locale);
    envelope = encodeWarmEnvelope(eventId, locale, atLeastRev, snapshot, new Date());
  } catch {
    // The builder already logged `[liveSnapshot] build-failed` with the
    // cause; an encode failure (non-safe-integer rev) is equally a
    // "nothing stored".
    console.log(
      `[liveWarm] skip ${head} reason=build-error rev=- bytes=- ` +
        `buildMs=${Date.now() - buildStarted} instance=${INSTANCE_ID}`,
    );
    return;
  }
  const buildMs = Date.now() - buildStarted;
  if (envelope.bytes > WARM_MAX_BYTES) {
    console.log(
      `[liveWarm] skip ${head} reason=oversize rev=${envelope.rev} ` +
        `bytes=${envelope.bytes} buildMs=${buildMs} instance=${INSTANCE_ID}`,
    );
    return;
  }
  const setStarted = Date.now();
  let ok = true;
  try {
    await faultySet(
      warmKey(eventId, locale, atLeastRev),
      envelope,
      { ttl: WARM_TTL_SECONDS, tags: [WARM_PUBLIC_DATA_TAG, warmEventTag(eventId)] },
      fault,
    );
  } catch (err) {
    ok = false;
    console.error(`[liveWarm] set-error ${head} err=${describeError(err)}`);
  }
  // A reader on this instance may have memoised a miss for this key
  // while the job was building; the entry exists now (or at least was
  // just offered to the cache), so let the next lookup ask again.
  clearMissMemo(lookupKey(eventId, locale, atLeastRev));
  console.log(
    `[liveWarm] set ${head} rev=${envelope.rev} bytes=${envelope.bytes} ` +
      `buildMs=${buildMs} setMs=${Date.now() - setStarted} ok=${ok} ` +
      `instance=${INSTANCE_ID}`,
  );
}

// ---------------------------------------------------------------------
// Reader side
// ---------------------------------------------------------------------

export type WarmLookupResult =
  | { result: "hit"; snapshot: EventSnapshot }
  | {
      result: "miss" | "stale" | "invalid" | "error" | "timeout" | "memo-miss" | "capped";
    };

// ---------------------------------------------------------------------
// Per-instance bound on lookup VOLUME
//
// `/api/setlist` is public and the broadcast channel is public, so a
// `?hint=1&minRev=<n>` is untrusted: anyone can send any number of
// hinted requests with any revision. The 300 ms race bounds a lookup's
// LATENCY, not how many Runtime Cache reads a flood of hinted requests
// causes. Two per-instance measures, per key (event, locale, minRev):
//   - concurrent lookups for the same key share one in-flight `get` (a
//     notification burst lands many requests for the same key on one
//     instance at once);
//   - a non-hit outcome is remembered briefly; lookups for that key
//     inside the window answer `memo-miss` without a `get`.
//
// What the memo is for — and what it is not. It collapses same-key
// duplicates and stops an instance from re-asking a cache that just
// failed. It does NOT bound a flood of DISTINCT forged revisions: each
// is a new key and costs one `get`. That flood is bounded elsewhere —
// by the client's notification cooldown (≤ 1 hinted request per client
// per second, so honest traffic never produces it) and by the
// coalescing above — and a forged key costs one cache read, never a
// build or a database read on this path.
//
// Two windows, because the honest case dominates:
//   - `miss` (key absent) — `WARM_MISS_MEMO_MS` = 250 ms. The writer's
//     entry typically appears 0.3–0.7 s after the commit, i.e. after the
//     first notification fetches of the burst have already arrived. A
//     long plain-miss memo would turn every later fetch on that instance
//     into a fallback build for the whole window; 250 ms (about one
//     cache round trip) still collapses an honest burst's duplicates and
//     lets the instance ask again soon enough to catch the entry.
//   - `invalid` / `stale` / `error` / `timeout` — `WARM_FAULT_MEMO_MS` =
//     1 s. The entry exists but is unusable, or the cache is failing or
//     slow; asking again within a second would mostly repeat the fault
//     and put load on a struggling cache.
// A warm job running on THIS instance clears the memo for the keys it
// stores, so its own readers pick the entry up at once.
//
// A hit is NOT remembered: it is read from the Runtime Cache each time.
// An honest burst already costs one `get` per key per instance thanks to
// the coalescing, and not keeping decoded snapshots avoids per-instance
// memory and a second invalidation path next to the tag expiry.
//
// The memo map is capped (oldest dropped first) so a flood of distinct
// forged revisions cannot grow memory without bound.
//
// Concurrent DISTINCT keys are capped too (`WARM_LOOKUP_MAX_INFLIGHT`).
// An honest notification burst needs at most 3 keys per event on an
// instance (one per locale, all for the same revision), so 16 covers
// several live events at once with room to spare. Beyond that, the
// extra keys can only be forged or pathological revisions; a NEW key
// arriving while 16 are already in flight does not `get` at all — it
// answers `capped` and the request takes the verified path (whose own
// revision read is memoised per event, so this cannot turn into
// database load either). Joining a key that is already in flight still
// coalesces and takes no slot.
// ---------------------------------------------------------------------

export const WARM_MISS_MEMO_MS = 250;
export const WARM_FAULT_MEMO_MS = 1_000;
export const WARM_MISS_MEMO_MAX_KEYS = 256;
export const WARM_LOOKUP_MAX_INFLIGHT = 16;

// One entry per key whose cache `get` has not settled yet. `generation`
// is the key's clear stamp when the `get` started (see below).
type InFlightLookup = { generation: number; result: Promise<WarmLookupResult> };
const inFlightLookups = new Map<string, InFlightLookup>();
// key → memo expiry (epoch ms). Insertion-ordered: the first key is the
// oldest memo.
const missMemo = new Map<string, number>();

// Clear generations, so a lookup that was already in flight when a warm
// job cleared its key cannot write its (now outdated) miss back after
// the clear and hide the fresh entry for a whole memo window. A clear
// stamps the key with a new value of a per-instance sequence; a lookup
// records the key's stamp when it starts and writes its memo only if the
// stamp is unchanged when it settles. Capped like the memo (oldest
// dropped). Eviction could only defeat the check if more than
// `WARM_MISS_MEMO_MAX_KEYS` other keys were cleared during one ≤ 300 ms
// lookup (three clears per save → ~85 saves in 300 ms), and even then
// the cost is one memo window of fallback builds, never a wrong answer.
let clearSeq = 0;
const clearGeneration = new Map<string, number>();

function lookupKey(eventId: bigint, locale: Locale, minRev: bigint | number): string {
  return `${eventId}:${locale}:${minRev}`;
}

function dropOldest(map: Map<string, unknown>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function rememberMiss(key: string, until: number): void {
  missMemo.delete(key);
  missMemo.set(key, until);
  dropOldest(missMemo, WARM_MISS_MEMO_MAX_KEYS);
}

/** Called by a warm job on this instance after it stored `key`. */
function clearMissMemo(key: string): void {
  missMemo.delete(key);
  clearSeq += 1;
  clearGeneration.delete(key);
  clearGeneration.set(key, clearSeq);
  dropOldest(clearGeneration, WARM_MISS_MEMO_MAX_KEYS);
}

/** Test-only: forget coalescing, negative-memo and generation state. */
export function __resetLiveWarmStateForTests(): void {
  inFlightLookups.clear();
  missMemo.clear();
  clearGeneration.clear();
  faultAnnounced = null;
  faultParsed = null;
}

/** Test-only: how many keys the negative memo currently holds. */
export function __warmMissMemoSizeForTests(): number {
  return missMemo.size;
}

/**
 * Look up the warm entry for exactly `(eventId, locale, minRev)`. Bounded
 * at `WARM_LOOKUP_TIMEOUT_MS` per caller; same-key duplicates on one
 * instance are coalesced and briefly memoised (see above); every outcome
 * but `hit` means "take the normal path". Never rejects. One log line
 * per call (coalesced waiters log the shared result):
 *
 *   [setlist] warm-lookup event=<id> locale=<l> minRev=<R> result=<hit|miss|stale|invalid|error|timeout|memo-miss|capped> ms=<n> instance=<id>[ fault=<spec>]
 *
 * (`fault=` only while a drill fault is armed — see "Fault injection".)
 *
 * The time bound is a per-caller `Promise.race` against the shared
 * `get`. That is acceptable here (unlike the revision read, which bounds
 * itself in the database): a caller that loses the race holds no pool
 * connection and no server work. The `get` itself keeps running (the
 * SDK's HTTP client gives up only at its own 500 ms), so the key's
 * in-flight slot is held until the `get` SETTLES, not until the caller's
 * deadline — otherwise the number of cache operations actually in
 * flight could exceed `WARM_LOOKUP_MAX_INFLIGHT`. Callers that join the
 * key during that overhang share the still-pending `get` under their
 * own deadline (and may get a hit if it answers in time).
 */
export async function warmLookup(
  eventId: bigint,
  locale: Locale,
  minRev: number,
): Promise<WarmLookupResult> {
  const started = Date.now();
  const key = lookupKey(eventId, locale, minRev);
  const fault = activeWarmFault();
  let out: WarmLookupResult;
  const memoUntil = missMemo.get(key);
  if (memoUntil !== undefined && started < memoUntil) {
    out = { result: "memo-miss" };
  } else {
    let entry = inFlightLookups.get(key);
    if (!entry && inFlightLookups.size >= WARM_LOOKUP_MAX_INFLIGHT) {
      out = { result: "capped" };
    } else {
      if (!entry) entry = startLookup(eventId, locale, minRev, key, fault);
      out = await raceDeadline(entry.result);
      if (out.result === "timeout") memoise(key, entry.generation, out);
    }
  }
  console.log(
    `[setlist] warm-lookup event=${eventId} locale=${locale} minRev=${minRev} ` +
      `result=${out.result} ms=${Date.now() - started} instance=${INSTANCE_ID}` +
      faultTag(fault),
  );
  return out;
}

/**
 * Record a non-hit outcome in the negative memo (or clear the memo on a
 * hit) — unless a warm job cleared this key after the lookup started:
 * that outcome predates the stored entry and must not hide it.
 */
function memoise(key: string, generation: number, r: WarmLookupResult): void {
  if ((clearGeneration.get(key) ?? 0) !== generation) return;
  if (r.result === "hit") {
    missMemo.delete(key);
    return;
  }
  const window = r.result === "miss" ? WARM_MISS_MEMO_MS : WARM_FAULT_MEMO_MS;
  // Never shorten a running memo: a `get` that answers `miss` AFTER its
  // callers already timed out must not cut the 1 s fault window (the
  // cache was slow) down to the 250 ms miss window.
  const until = Math.max(Date.now() + window, missMemo.get(key) ?? 0);
  rememberMiss(key, until);
}

/**
 * Start the ONE cache `get` for `key` on this instance and register it
 * as the key's in-flight entry until the `get` settles (see
 * `warmLookup`). The entry's `result` never rejects and has no deadline
 * of its own; each caller applies its own.
 */
function startLookup(
  eventId: bigint,
  locale: Locale,
  minRev: number,
  key: string,
  fault: WarmFault | null,
): InFlightLookup {
  const generation = clearGeneration.get(key) ?? 0;
  const entry: InFlightLookup = { generation, result: undefined as never };
  entry.result = readAndDecode(eventId, locale, minRev, fault)
    .then((r) => {
      memoise(key, generation, r);
      return r;
    })
    .finally(() => {
      if (inFlightLookups.get(key) === entry) inFlightLookups.delete(key);
    });
  inFlightLookups.set(key, entry);
  return entry;
}

async function raceDeadline(result: Promise<WarmLookupResult>): Promise<WarmLookupResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<WarmLookupResult>((resolve) => {
    timer = setTimeout(() => resolve({ result: "timeout" }), WARM_LOOKUP_TIMEOUT_MS);
  });
  try {
    return await Promise.race([result, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The cache `get` + envelope validation, without a deadline. Never rejects. */
async function readAndDecode(
  eventId: bigint,
  locale: Locale,
  minRev: number,
  fault: WarmFault | null,
): Promise<WarmLookupResult> {
  let value: unknown;
  try {
    // `getCache` resolves its store synchronously and may throw; the
    // `await` turns that into the same path as a rejected `get`.
    value = await faultyGet(warmKey(eventId, locale, minRev), fault);
  } catch (error) {
    console.error(`[liveWarm] lookup-error err=${describeError(error)}`);
    return { result: "error" };
  }
  if (value === null || value === undefined) return { result: "miss" };
  const decoded = decodeWarmEnvelope(value, eventId, locale, minRev);
  return decoded.ok
    ? { result: "hit", snapshot: decoded.snapshot }
    : { result: decoded.reason };
}
