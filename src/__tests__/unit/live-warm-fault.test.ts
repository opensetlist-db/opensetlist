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

import type { RuntimeCache } from "@vercel/functions";
import { buildEventSnapshot, type EventSnapshot } from "@/lib/liveSnapshot";
import { warmEntryCache } from "@/lib/dataCache";
import {
  activeWarmFault,
  encodeWarmEnvelope,
  parseWarmFault,
  runWarmJob,
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

const ENV_KEYS = ["LIVE_WARM_FAULT_ARMED", "LIVE_WARM_FAULT", "VERCEL_ENV", "LIVE_WARM_CONCURRENCY"];

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
      /^\[liveWarm\] start event=111 rev=8 instance=[0-9a-f]{8}$/,
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
    expect(out.find((l) => l.startsWith("[liveWarm] start"))).toMatch(/ fault=seterror$/);
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
        /^\[liveWarm\] skip event=111 locale=ja atLeastRev=5 reason=fault-locale rev=- bytes=- buildMs=0 instance=/,
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
      / fault=slow:400\+locale:ja$/,
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
