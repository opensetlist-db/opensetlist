// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Drill fault injection at the warm-cache boundary (`src/lib/liveWarm.ts`,
// "Fault injection"): each mode's observable effect through `warmLookup`
// and `runWarmJob` against a fake Map-backed cache, the arming rules
// (two env vars, never in production), the one-line announcements, the
// `fault=` tag on log lines, and that an unarmed process behaves exactly
// as before.

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));

vi.mock("@/lib/liveSnapshot", () => ({ buildEventSnapshot: vi.fn() }));

vi.mock("@/lib/dataCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dataCache")>();
  return { ...actual, warmEntryCache: vi.fn(actual.warmEntryCache) };
});

import { after } from "next/server";
import type { RuntimeCache } from "@vercel/functions";
import { buildEventSnapshot, type EventSnapshot } from "@/lib/liveSnapshot";
import { warmEntryCache } from "@/lib/dataCache";
import {
  activeWarmFault,
  encodeWarmEnvelope,
  parseWarmFault,
  requestWarmFault,
  runWarmJob,
  scheduleWarm,
  SLOWBUILD_MAX_MS,
  WARM_FAULT_HEADER,
  WARM_FAULT_HEADER_UNPARSEABLE,
  WARM_FAULT_HEADER_UNSUPPORTED,
  warmKey,
  warmLookup,
  __resetLiveWarmStateForTests,
} from "@/lib/liveWarm";
import type { Locale } from "@/i18n/routing";

const EVENT = BigInt(111);

function snap(rev: number): EventSnapshot {
  return {
    found: true,
    isDeleted: false,
    rawStatus: "ongoing",
    startTime: new Date("2026-11-14T07:30:00.000Z"),
    rev: BigInt(rev),
    capturedAt: new Date("2026-11-14T08:00:00.123Z"),
    items: [] as unknown as EventSnapshot["items"],
    reactionCounts: {},
    top3Wishes: [],
    buildId: `b-${rev}`,
  };
}

// A Map-backed stand-in for the Runtime Cache, counting calls, so a test
// can tell "the get never happened" (absent) from "it happened and its
// value was dropped" (getnull).
function fakeCache() {
  const store = new Map<string, unknown>();
  const get = vi.fn(async (key: string) => store.get(key) ?? null);
  const set = vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
  });
  vi.mocked(warmEntryCache).mockReturnValue({ get, set } as unknown as RuntimeCache);
  const put = (locale: Locale, rev: number) =>
    store.set(
      warmKey(EVENT, locale, rev),
      encodeWarmEnvelope(EVENT, locale, BigInt(rev), snap(rev), new Date()),
    );
  return { store, get, set, put };
}

const lines = () => vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
const lookupLines = () => lines().filter((l) => l.startsWith("[setlist] warm-lookup "));

function arm(spec: string) {
  process.env.LIVE_WARM_FAULT_ARMED = "1";
  process.env.LIVE_WARM_FAULT = spec;
}

const ENV_KEYS = [
  "LIVE_WARM_FAULT_ARMED",
  "LIVE_WARM_FAULT",
  "VERCEL_ENV",
  "LIVE_WARM_CONCURRENCY",
  "LIVE_WARM_ENTRIES",
];

beforeEach(() => {
  vi.clearAllMocks();
  __resetLiveWarmStateForTests();
  for (const k of ENV_KEYS) delete process.env[k];
  vi.mocked(buildEventSnapshot).mockImplementation(async () => snap(5));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("parseWarmFault", () => {
  it("rejects a spec with an empty token instead of arming the rest of it", () => {
    expect(parseWarmFault("slow=400,,locale=ja")).toBeNull();
    expect(parseWarmFault("slow=400,")).toBeNull();
    expect(parseWarmFault(",absent")).toBeNull();
    expect(parseWarmFault("   ")).toBeNull();
  });
  it("parses single and combined modes, normalising the label", () => {
    expect(parseWarmFault(" slow=400 , locale=ja ")).toMatchObject({
      label: "slow:400+locale:ja",
      slowMs: 400,
      skipLocales: new Set(["ja"]),
      absent: false,
    });
    const all = parseWarmFault(
      "absent,getnull,geterror,seterror,setskip,slowjob=250,locale=ko,locale=en",
    );
    expect(all).toMatchObject({
      absent: true,
      getNull: true,
      getError: true,
      setError: true,
      setSkip: true,
      slowJobMs: 250,
      skipLocales: new Set(["ko", "en"]),
    });
  });

  it("rejects the whole spec on any unknown or malformed token", () => {
    for (const bad of [
      "",
      "nope",
      "slow",
      "slow=",
      "slow=abc",
      "slow=0",
      "slow=-5",
      "slow=10001",
      "locale=fr",
      "absent=1",
      "absent,typo",
    ]) {
      expect(parseWarmFault(bad), bad).toBeNull();
    }
  });
});

describe("arming", () => {
  it("unarmed: no fault, no announcement, log lines without fault=", async () => {
    const { get, put } = fakeCache();
    process.env.LIVE_WARM_FAULT = "absent"; // a stray spec alone does nothing
    put("ja", 7);
    expect(activeWarmFault()).toBeNull();
    expect((await warmLookup(EVENT, "ja", 7)).result).toBe("hit");
    expect(get).toHaveBeenCalledTimes(1);
    expect(lookupLines()[0]).toMatch(/result=hit ms=\d+ instance=[0-9a-f]{8}$/);
    expect(lines().some((l) => l.includes("fault"))).toBe(false);

    await runWarmJob(EVENT, BigInt(8));
    expect(lines().find((l) => l.startsWith("[liveWarm] start"))).toMatch(
      /^\[liveWarm\] start event=111 rev=8 at=\d+ instance=[0-9a-f]{8}$/,
    );
  });

  it("armed without a spec, or with ARMED other than exactly 1: inactive", () => {
    process.env.LIVE_WARM_FAULT_ARMED = "1";
    expect(activeWarmFault()).toBeNull();
    process.env.LIVE_WARM_FAULT_ARMED = "true";
    process.env.LIVE_WARM_FAULT = "absent";
    expect(activeWarmFault()).toBeNull();
    expect(lines()).toEqual([]);
  });

  it("production: blocked even when armed, with one fault-blocked line per process", async () => {
    const { get, put } = fakeCache();
    put("ja", 7);
    arm("absent");
    process.env.VERCEL_ENV = "production";
    expect((await warmLookup(EVENT, "ja", 7)).result).toBe("hit");
    expect((await warmLookup(EVENT, "ja", 7)).result).toBe("hit");
    expect(get).toHaveBeenCalledTimes(2);
    const blocked = lines().filter((l) => l.startsWith("[liveWarm] fault-blocked"));
    expect(blocked).toEqual([
      expect.stringMatching(/^\[liveWarm\] fault-blocked mode=absent reason=production instance=/),
    ]);
    expect(lookupLines().every((l) => !l.includes("fault="))).toBe(true);
  });

  it("preview: one 'fault armed' line per process, fault= on every lookup line", async () => {
    fakeCache();
    arm("absent");
    process.env.VERCEL_ENV = "preview";
    await warmLookup(EVENT, "ja", 7);
    await warmLookup(EVENT, "ko", 7);
    expect(lines().filter((l) => l.startsWith("[liveWarm] fault armed"))).toEqual([
      expect.stringMatching(/^\[liveWarm\] fault armed mode=absent instance=[0-9a-f]{8}$/),
    ]);
    expect(lookupLines()).toHaveLength(2);
    for (const l of lookupLines()) expect(l).toMatch(/ fault=absent$/);
  });

  it("an invalid spec injects nothing and says so once", async () => {
    const { get, put } = fakeCache();
    put("ja", 7);
    arm("slow=fast");
    expect((await warmLookup(EVENT, "ja", 7)).result).toBe("hit");
    await warmLookup(EVENT, "ja", 7);
    expect(get).toHaveBeenCalledTimes(2);
    expect(lines().filter((l) => l.includes("fault-invalid"))).toEqual([
      expect.stringMatching(/^\[liveWarm\] fault-invalid mode=slow:fast injected=none /),
    ]);
    expect(lookupLines().every((l) => !l.includes("fault="))).toBe(true);
  });
});

describe("reader modes (warmLookup)", () => {
  it("absent: a stored entry is reported miss and the get never runs", async () => {
    const { get, put } = fakeCache();
    put("ja", 7);
    arm("absent");
    expect(await warmLookup(EVENT, "ja", 7)).toEqual({ result: "miss" });
    expect(get).not.toHaveBeenCalled();
    expect(lookupLines()[0]).toMatch(/result=miss .* fault=absent$/);
  });

  it("getnull: the get runs, its value is dropped → miss", async () => {
    const { get, put } = fakeCache();
    put("ja", 7);
    arm("getnull");
    expect(await warmLookup(EVENT, "ja", 7)).toEqual({ result: "miss" });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("geterror: the get runs, then rejects → error (logged as lookup-error)", async () => {
    const { get, put } = fakeCache();
    put("ja", 7);
    arm("geterror");
    expect(await warmLookup(EVENT, "ja", 7)).toEqual({ result: "error" });
    expect(get).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toMatch(
      /lookup-error .*injected fault: geterror/,
    );
  });

  it("slow=400 crosses the 300 ms deadline → timeout; the get still runs afterwards", async () => {
    vi.useFakeTimers();
    const { get, put } = fakeCache();
    put("ja", 7);
    arm("slow=400");
    const pending = warmLookup(EVENT, "ja", 7);
    await vi.advanceTimersByTimeAsync(300);
    expect(await pending).toEqual({ result: "timeout" });
    expect(get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(get).toHaveBeenCalledTimes(1);
    expect(lookupLines()[0]).toMatch(/result=timeout .* fault=slow:400$/);
  });

  it("slow=150 is a slow hit", async () => {
    vi.useFakeTimers();
    const { put } = fakeCache();
    put("ja", 7);
    arm("slow=150");
    const pending = warmLookup(EVENT, "ja", 7);
    await vi.advanceTimersByTimeAsync(149);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).result).toBe("hit");
  });

  it("combined slow=150,getnull: a slow miss", async () => {
    vi.useFakeTimers();
    const { get, put } = fakeCache();
    put("ja", 7);
    arm("slow=150,getnull");
    const pending = warmLookup(EVENT, "ja", 7);
    await vi.advanceTimersByTimeAsync(150);
    expect(await pending).toEqual({ result: "miss" });
    expect(get).toHaveBeenCalledTimes(1);
    expect(lookupLines()[0]).toMatch(/ fault=slow:150\+getnull$/);
  });

  it("writer-only modes leave lookups untouched (but tagged)", async () => {
    const { put } = fakeCache();
    put("ja", 7);
    arm("seterror,locale=ko,slowjob=10");
    expect((await warmLookup(EVENT, "ja", 7)).result).toBe("hit");
    expect(lookupLines()[0]).toMatch(/ fault=seterror\+locale:ko\+slowjob:10$/);
  });
});

describe("writer modes (runWarmJob)", () => {
  it("seterror: every set fails ok=false, nothing is published, readers miss", async () => {
    const { set, store } = fakeCache();
    arm("seterror");
    await runWarmJob(EVENT, BigInt(5));
    expect(set).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
    const out = lines();
    expect(out.find((l) => l.startsWith("[liveWarm] start"))).toMatch(/ fault=seterror source=env$/);
    const sets = out.filter((l) => l.startsWith("[liveWarm] set "));
    expect(sets).toHaveLength(3);
    for (const l of sets) expect(l).toMatch(/ ok=false /);
    expect(
      vi.mocked(console.error).mock.calls.filter((c) => String(c[0]).includes("injected fault: seterror")),
    ).toHaveLength(3);
    expect((await warmLookup(EVENT, "ja", 5)).result).toBe("miss");
  });

  it("setskip: logged ok=true, but the entry is absent", async () => {
    const { set, store } = fakeCache();
    arm("setskip");
    await runWarmJob(EVENT, BigInt(5));
    expect(set).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
    for (const l of lines().filter((x) => x.startsWith("[liveWarm] set "))) {
      expect(l).toMatch(/ ok=true /);
    }
    expect((await warmLookup(EVENT, "ko", 5)).result).toBe("miss");
  });

  it("locale=ja: ja is neither built nor stored (skip reason=fault-locale); ko/en are", async () => {
    const { store } = fakeCache();
    arm("locale=ja");
    await runWarmJob(EVENT, BigInt(5));
    expect(vi.mocked(buildEventSnapshot).mock.calls.map((c) => c[1]).sort()).toEqual(["en", "ko"]);
    expect([...store.keys()].sort()).toEqual(
      [warmKey(EVENT, "en", 5), warmKey(EVENT, "ko", 5)].sort(),
    );
    expect(lines().filter((l) => l.startsWith("[liveWarm] skip "))).toEqual([
      expect.stringMatching(
        /^\[liveWarm\] skip event=111 locale=ja atLeastRev=5 reason=fault-locale rev=- bytes=- buildMs=0 buildStartAt=(\d+) buildEndAt=\1 at=\1 instance=/,
      ),
    ]);
    expect((await warmLookup(EVENT, "ja", 5)).result).toBe("miss");
    expect((await warmLookup(EVENT, "ko", 5)).result).toBe("hit");
  });

  it("slowjob=500: each locale's build starts 500 ms later; done only after the delays", async () => {
    vi.useFakeTimers();
    fakeCache();
    process.env.LIVE_WARM_CONCURRENCY = "1"; // sequential: 3 × 500 ms
    arm("slowjob=500");
    let done = false;
    const job = runWarmJob(EVENT, BigInt(5)).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(499);
    expect(buildEventSnapshot).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(buildEventSnapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await job;
    expect(done).toBe(true);
    expect(buildEventSnapshot).toHaveBeenCalledTimes(3);
  });

  it("combined slow=400,locale=ja: ja never published, other locales time out on read", async () => {
    vi.useFakeTimers();
    const { store } = fakeCache();
    arm("slow=400,locale=ja");
    await runWarmJob(EVENT, BigInt(5));
    expect(store.has(warmKey(EVENT, "ja", 5))).toBe(false);
    expect(store.has(warmKey(EVENT, "ko", 5))).toBe(true);
    const ko = warmLookup(EVENT, "ko", 5);
    await vi.advanceTimersByTimeAsync(300);
    expect(await ko).toEqual({ result: "timeout" });
    expect(lines().find((l) => l.startsWith("[liveWarm] start"))).toMatch(
      / fault=slow:400\+locale:ja source=env$/,
    );
  });

  it("combined spec: every emitted line keeps one locale= field and no unencoded spec", async () => {
    vi.useFakeTimers();
    fakeCache();
    arm("slow=400, locale=ja ,getnull");
    await runWarmJob(EVENT, BigInt(5));
    for (const l of ["ja", "ko"] as const) {
      const p = warmLookup(EVENT, l, 5);
      await vi.advanceTimersByTimeAsync(400);
      await p;
    }
    // And the production / invalid announcements use the same encoding.
    __resetLiveWarmStateForTests();
    process.env.VERCEL_ENV = "production";
    activeWarmFault();
    delete process.env.VERCEL_ENV;
    arm("slow=fast,locale=ja");
    activeWarmFault();

    const out = lines();
    expect(out.some((l) => l.includes("fault=slow:400+locale:ja+getnull"))).toBe(true);
    expect(out.some((l) => l.includes("fault armed mode=slow:400+locale:ja+getnull"))).toBe(true);
    expect(out.some((l) => l.includes("fault-blocked mode=slow:400+locale:ja+getnull"))).toBe(true);
    expect(out.some((l) => l.includes("fault-invalid mode=slow:fast+locale:ja"))).toBe(true);
    for (const l of out) {
      expect(l.match(/\blocale=/g)?.length ?? 0, l).toBeLessThanOrEqual(1);
      expect(l, l).not.toContain(",");
      // Every space-separated token is a single key=value at most.
      for (const tok of l.split(" ")) {
        expect((tok.match(/=/g) ?? []).length, tok).toBeLessThanOrEqual(1);
      }
    }
  });

  it("unarmed: the job stores all three locales through the real set path", async () => {
    const { set, store } = fakeCache();
    await runWarmJob(EVENT, BigInt(5));
    expect(set).toHaveBeenCalledTimes(3);
    expect(store.size).toBe(3);
    expect(lines().some((l) => l.includes("fault"))).toBe(false);
  });
});

// ---------------------------------------------------------------------
// n14 step 4: `slowset` / `slowbuild`, the per-request fault header and
// the explicit server-clock fields on the job's lines.
// ---------------------------------------------------------------------

// Numeric value of ` <key>=<n>` on a log line (NaN when absent / `-`).
// A token lookup rather than a RegExp built from `key`, which Semgrep's
// detect-non-literal-regexp rule blocks.
const num = (line: string, key: string) => {
  const v = line
    .split(" ")
    .find((t) => t.startsWith(`${key}=`))
    ?.slice(key.length + 1);
  return v !== undefined && /^\d+$/.test(v) ? Number(v) : NaN;
};
const setLinesOf = () => lines().filter((l) => l.startsWith("[liveWarm] set "));
const startLines = () => lines().filter((l) => l.startsWith("[liveWarm] start "));

describe("parseWarmFault — slowset / slowbuild", () => {
  it("parses both with their one-token labels", () => {
    expect(parseWarmFault("slowset=1500")).toMatchObject({
      label: "slowset:1500",
      slowSetMs: 1500,
      slowBuildMs: 0,
      slowJobMs: 0,
    });
    expect(parseWarmFault("slowbuild=1500")).toMatchObject({
      label: "slowbuild:1500",
      slowBuildMs: 1500,
      slowSetMs: 0,
    });
    expect(parseWarmFault("slowset=1500,locale=ja")).toMatchObject({
      label: "slowset:1500+locale:ja",
      skipLocales: new Set(["ja"]),
    });
  });

  it("bounds: slowset up to 10 000 ms, slowbuild only up to SLOWBUILD_MAX_MS (5 000)", () => {
    expect(SLOWBUILD_MAX_MS).toBe(5_000);
    expect(parseWarmFault("slowset=10000")?.slowSetMs).toBe(10_000);
    expect(parseWarmFault("slowbuild=5000")?.slowBuildMs).toBe(5_000);
    for (const bad of [
      "slowset=0",
      "slowset=10001",
      "slowset=",
      "slowset",
      "slowbuild=0",
      "slowbuild=5001",
      "slowbuild=1.5",
      "slowbuild=1500,",
    ]) {
      expect(parseWarmFault(bad), bad).toBeNull();
    }
  });
});

describe("slowset / slowbuild in the warm job", () => {
  it("slowset=1500 delays the set, not the build", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { set } = fakeCache();
    arm("slowset=1500");
    const job = runWarmJob(EVENT, BigInt(5));
    await vi.advanceTimersByTimeAsync(1499);
    // Both concurrent builds are done; neither set has started.
    expect(buildEventSnapshot).toHaveBeenCalledTimes(2);
    expect(set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(set).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1500);
    await job;
    expect(set).toHaveBeenCalledTimes(3);
    expect(startLines()[0]).toMatch(/ fault=slowset:1500 source=env$/);
    const sets = setLinesOf();
    expect(sets).toHaveLength(3);
    for (const l of sets) {
      expect(num(l, "buildEndAt") - num(l, "buildStartAt"), l).toBeLessThan(50);
      expect(num(l, "setStartAt") - num(l, "buildEndAt"), l).toBeGreaterThanOrEqual(1500);
      expect(num(l, "at"), l).toBeGreaterThanOrEqual(num(l, "setStartAt"));
      expect(num(l, "holdMs"), l).toBe(0);
    }
  });

  it("slowbuild=1500 hands holdMs (and a timing record) to the builder; the set line reports the builder's timing", async () => {
    fakeCache();
    arm("slowbuild=1500");
    vi.mocked(buildEventSnapshot).mockImplementation(async (_id, _locale, opts) => {
      if (opts?.timing) {
        opts.timing.txStartAt = 1_000;
        opts.timing.holdMs = opts.holdMs ?? 0;
        opts.timing.txEndAt = 2_600;
      }
      return snap(5);
    });
    await runWarmJob(EVENT, BigInt(5));
    const calls = vi.mocked(buildEventSnapshot).mock.calls;
    expect(calls).toHaveLength(3);
    for (const c of calls) expect(c[2]).toEqual({ holdMs: 1500, timing: expect.any(Object) });
    for (const l of setLinesOf()) {
      expect(l).toMatch(/ txStartAt=1000 txEndAt=2600 holdMs=1500 captureAt=\d+ /);
    }
    expect(startLines()[0]).toMatch(/ fault=slowbuild:1500 source=env$/);
  });

  it("without a slowbuild fault the builder gets only the timing record, never holdMs", async () => {
    fakeCache();
    await runWarmJob(EVENT, BigInt(5));
    for (const c of vi.mocked(buildEventSnapshot).mock.calls) {
      expect(c[2]).toEqual({ timing: expect.any(Object) });
    }
    // The mocked builder fills nothing: tx fields are `-`, hold 0.
    for (const l of setLinesOf()) expect(l).toMatch(/ txStartAt=- txEndAt=- holdMs=0 /);
  });

  it("every job line carries the explicit server-clock fields in the contract order", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    fakeCache();
    await runWarmJob(EVENT, BigInt(5), parseWarmFault("locale=ja"));
    const out = lines();
    expect(out[0]).toMatch(
      /^\[liveWarm\] start event=111 rev=5 at=1700000000000 instance=[0-9a-f]{8} fault=locale:ja source=header$/,
    );
    expect(out.find((l) => l.includes("reason=fault-locale"))).toMatch(
      / buildMs=0 buildStartAt=1700000000000 buildEndAt=1700000000000 at=1700000000000 instance=/,
    );
    for (const l of setLinesOf()) {
      expect(l).toMatch(
        /^\[liveWarm\] set event=111 locale=(ko|en) atLeastRev=5 rev=5 bytes=\d+ buildMs=\d+ setMs=\d+ ok=true buildStartAt=\d+ buildEndAt=\d+ txStartAt=- txEndAt=- holdMs=0 captureAt=1794643200123 setStartAt=\d+ at=\d+ instance=[0-9a-f]{8}$/,
      );
    }
    expect(out.at(-1)).toMatch(
      /^\[liveWarm\] done event=111 rev=5 ms=\d+ at=1700000000000 instance=[0-9a-f]{8}$/,
    );
  });
});

describe("requestWarmFault (x-live-warm-fault header)", () => {
  // A Headers whose `get` is observed, to prove the header is not even
  // consulted when the deployment is unarmed or production.
  function observed(spec: string | null) {
    const h = new Headers(spec === null ? {} : { [WARM_FAULT_HEADER]: spec });
    const get = vi.spyOn(h, "get");
    return { h, get };
  }

  it("unarmed: ignored without reading the header, even a malformed one", () => {
    process.env.LIVE_WARM_FAULT = "seterror"; // env spec alone arms nothing
    for (const v of [undefined, "0", "true"]) {
      if (v === undefined) delete process.env.LIVE_WARM_FAULT_ARMED;
      else process.env.LIVE_WARM_FAULT_ARMED = v;
      const { h, get } = observed("garbage!!");
      expect(requestWarmFault(h)).toEqual({ ok: true, fault: null });
      expect(get).not.toHaveBeenCalled();
    }
  });

  it("production + armed: ignored without reading the header", () => {
    process.env.LIVE_WARM_FAULT_ARMED = "1";
    process.env.VERCEL_ENV = "production";
    const { h, get } = observed("slowset=1500");
    expect(requestWarmFault(h)).toEqual({ ok: true, fault: null });
    expect(get).not.toHaveBeenCalled();
  });

  it("armed: absent or empty header → no fault", () => {
    process.env.LIVE_WARM_FAULT_ARMED = "1";
    expect(requestWarmFault(observed(null).h)).toEqual({ ok: true, fault: null });
    expect(requestWarmFault(observed("").h)).toEqual({ ok: true, fault: null });
  });

  it("armed: a job-side spec is parsed (no env spec needed)", () => {
    process.env.LIVE_WARM_FAULT_ARMED = "1";
    process.env.VERCEL_ENV = "preview";
    const r = requestWarmFault(observed("slowset=1500,locale=ja").h);
    expect(r).toMatchObject({
      ok: true,
      fault: { label: "slowset:1500+locale:ja", slowSetMs: 1500, skipLocales: new Set(["ja"]) },
    });
    for (const spec of ["slowjob=200", "slowbuild=5000", "seterror", "setskip", "locale=en"]) {
      expect(requestWarmFault(observed(spec).h).ok, spec).toBe(true);
    }
  });

  it("armed: any lookup-side mode → ok:false (unsupported), Korean message", () => {
    process.env.LIVE_WARM_FAULT_ARMED = "1";
    for (const spec of ["absent", "slow=100", "getnull", "geterror", "seterror,getnull"]) {
      expect(requestWarmFault(observed(spec).h), spec).toEqual({
        ok: false,
        error: WARM_FAULT_HEADER_UNSUPPORTED,
      });
    }
    expect(WARM_FAULT_HEADER_UNSUPPORTED).toBe(
      "x-live-warm-fault: 지원하지 않는 모드 (slowjob, slowset, slowbuild, seterror, setskip, locale만 가능)",
    );
  });

  it("armed: an off-grammar spec → ok:false (unparseable), Korean message", () => {
    process.env.LIVE_WARM_FAULT_ARMED = "1";
    for (const spec of ["nope", "slowset=0", "slowbuild=5001", "slowset=1500,", "locale=fr"]) {
      expect(requestWarmFault(observed(spec).h), spec).toEqual({
        ok: false,
        error: WARM_FAULT_HEADER_UNPARSEABLE,
      });
    }
    expect(WARM_FAULT_HEADER_UNPARSEABLE).toBe("x-live-warm-fault: 해석할 수 없는 사양");
  });
});

describe("request faults are request-local", () => {
  it("concurrent jobs each keep their own fault; a job without one uses the env fault (source=env)", async () => {
    const { set, store } = fakeCache();
    arm("setskip"); // the env fault — must not leak into the header jobs
    const a = parseWarmFault("slowset=40")!;
    const b = parseWarmFault("seterror")!;
    // Staggered by a few ms (still overlapping: A sleeps 40 ms before
    // its sets) because Vitest's module mocking is not safe for
    // CONCURRENT first-time dynamic imports of a mocked module — the
    // job's lazy `import("@/lib/liveSnapshot")` racing itself can
    // resolve to the real builder (a test-runner artifact; Node's own
    // module cache has no such race).
    const tick = () => new Promise((r) => setTimeout(r, 5));
    const ja = runWarmJob(EVENT, BigInt(5), a);
    await tick();
    const jb = runWarmJob(EVENT, BigInt(6), b);
    await tick();
    const jc = runWarmJob(EVENT, BigInt(7));
    await Promise.all([ja, jb, jc]);
    const starts = startLines();
    expect(starts.find((l) => l.includes(" rev=5 "))).toMatch(/ fault=slowset:40 source=header$/);
    expect(starts.find((l) => l.includes(" rev=6 "))).toMatch(/ fault=seterror source=header$/);
    expect(starts.find((l) => l.includes(" rev=7 "))).toMatch(/ fault=setskip source=env$/);

    const of = (rev: number) => setLinesOf().filter((l) => l.includes(` atLeastRev=${rev} `));
    for (const l of of(5)) {
      expect(l).toMatch(/ ok=true /);
      expect(num(l, "setStartAt") - num(l, "buildEndAt")).toBeGreaterThanOrEqual(39);
    }
    for (const l of of(6)) expect(l).toMatch(/ ok=false /);
    for (const l of of(7)) expect(l).toMatch(/ ok=true /);
    for (const rev of [5, 6, 7]) expect(of(rev)).toHaveLength(3);
    // The three jobs really overlapped: B and C started before A's last set.
    const aLastSet = Math.max(...of(5).map((l) => num(l, "at")));
    for (const rev of [6, 7]) {
      const s = startLines().find((l) => l.includes(` rev=${rev} `))!;
      expect(num(s, "at")).toBeLessThan(aLastSet);
    }
    // Only the slowset job really stored anything (seterror threw,
    // setskip dropped silently).
    expect(set).toHaveBeenCalledTimes(3);
    expect([...store.keys()].sort()).toEqual(
      (["en", "ja", "ko"] as const).map((l) => warmKey(EVENT, l, 5)).sort(),
    );
  });

  it("scheduleWarm captures the request fault by value in the after() job", async () => {
    fakeCache();
    process.env.LIVE_WARM_ENTRIES = "1";
    scheduleWarm(EVENT, BigInt(5), parseWarmFault("seterror"));
    scheduleWarm(EVENT, BigInt(6));
    const jobs = vi.mocked(after).mock.calls.map((c) => c[0] as () => Promise<void>);
    expect(jobs).toHaveLength(2);
    for (const j of jobs) await j();
    const starts = startLines();
    expect(starts.find((l) => l.includes(" rev=5 "))).toMatch(/ fault=seterror source=header$/);
    // Unarmed process, no request fault: no fault= at all.
    expect(starts.find((l) => l.includes(" rev=6 "))).toMatch(/ instance=[0-9a-f]{8}$/);
  });

  it("new modes keep the one-token encoding: one locale= per line, one '=' per token", async () => {
    vi.useFakeTimers();
    fakeCache();
    const job = runWarmJob(EVENT, BigInt(5), parseWarmFault("slowset=10, locale=ja ,slowbuild=10"));
    await vi.advanceTimersByTimeAsync(100);
    await job;
    const out = lines();
    expect(out[0]).toContain(" fault=slowset:10+locale:ja+slowbuild:10 source=header");
    for (const l of out) {
      expect(l.match(/\blocale=/g)?.length ?? 0, l).toBeLessThanOrEqual(1);
      expect(l, l).not.toContain(",");
      for (const tok of l.split(" ")) {
        expect((tok.match(/=/g) ?? []).length, tok).toBeLessThanOrEqual(1);
      }
    }
  });
});
