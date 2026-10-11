// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// n14 writer warming (`src/lib/liveWarm.ts`): the envelope codec and its
// validation, the bounded lookup, the flag, and the warm job's
// concurrency and log lines. The Runtime Cache is the SDK's real
// in-memory fallback (no Vercel context, no RUNTIME_CACHE_ENDPOINT in
// the test env) unless a test swaps in a fake; the builder is mocked.

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
import { warmEntryCache, WARM_PUBLIC_DATA_TAG } from "@/lib/dataCache";
import {
  decodeWarmEnvelope,
  encodeWarmEnvelope,
  liveWarmEnabled,
  runWarmJob,
  scheduleWarm,
  warmKey,
  warmLookup,
  __resetLiveWarmStateForTests,
  __warmMissMemoSizeForTests,
  WARM_MAX_BYTES,
  WARM_MISS_MEMO_MAX_KEYS,
  WARM_LOOKUP_MAX_INFLIGHT,
  WARM_TTL_SECONDS,
  type WarmEnvelope,
} from "@/lib/liveWarm";
import type { Locale } from "@/i18n/routing";

const actualDataCache =
  await vi.importActual<typeof import("@/lib/dataCache")>("@/lib/dataCache");

const EVENT = BigInt(111);

function snap(rev: number, overrides: Partial<EventSnapshot> = {}): EventSnapshot {
  return {
    found: true,
    isDeleted: false,
    rawStatus: "ongoing",
    startTime: new Date("2026-11-14T07:30:00.000Z"),
    rev: BigInt(rev),
    capturedAt: new Date("2026-11-14T08:00:00.123Z"),
    items: [
      { id: 9007199254740993, position: 1, createdAt: "2026-11-14T08:00:00.000Z" },
    ] as unknown as EventSnapshot["items"],
    reactionCounts: { "10": { best: 2 } },
    top3Wishes: [],
    buildId: `b-${rev}`,
    ...overrides,
  };
}

function envelope(rev: number, atLeast = rev, locale: Locale = "ja"): WarmEnvelope {
  return encodeWarmEnvelope(
    EVENT,
    locale,
    BigInt(atLeast),
    snap(rev),
    new Date("2026-11-14T08:00:01.000Z"),
  );
}

const lines = () => vi.mocked(console.log).mock.calls.map((c) => String(c[0]));

beforeEach(async () => {
  vi.clearAllMocks();
  __resetLiveWarmStateForTests();
  vi.mocked(warmEntryCache).mockReset().mockImplementation(actualDataCache.warmEntryCache);
  delete process.env.LIVE_WARM_ENTRIES;
  delete process.env.LIVE_WARM_CONCURRENCY;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // The SDK's in-memory fallback is a process-wide singleton.
  await warmEntryCache().expireTag(WARM_PUBLIC_DATA_TAG);
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.LIVE_WARM_ENTRIES;
  delete process.env.LIVE_WARM_CONCURRENCY;
});

describe("envelope", () => {
  it("round-trips bigint / Date through the codec and the cache's JSON", async () => {
    const original = snap(7);
    const env = encodeWarmEnvelope(EVENT, "ko", BigInt(6), original, new Date());
    expect(env).toMatchObject({
      schema: 1,
      eventId: "111",
      locale: "ko",
      atLeastRev: 6,
      rev: 7,
      capturedAt: "2026-11-14T08:00:00.123Z",
    });
    expect(env.bytes).toBe(Buffer.byteLength(env.payload, "utf8"));

    // Through the real (in-memory) Runtime Cache: JSON.stringify on set,
    // JSON.parse on get, as the HTTP client does.
    await warmEntryCache().set("k", env);
    const stored = await warmEntryCache().get("k");
    const decoded = decodeWarmEnvelope(stored, EVENT, "ko", 6);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.snapshot).toEqual(original);
    expect(typeof decoded.snapshot.rev).toBe("bigint");
    expect(decoded.snapshot.capturedAt).toBeInstanceOf(Date);
    expect(decoded.snapshot.startTime).toBeInstanceOf(Date);
  });

  it("accepts an entry whose actual rev is above the key's R (never relabelled)", () => {
    const decoded = decodeWarmEnvelope(envelope(9, 7), EVENT, "ja", 7);
    expect(decoded.ok && decoded.snapshot.rev).toBe(BigInt(9));
  });

  const rejects: Array<[string, () => unknown, "invalid" | "stale"]> = [
    ["not an object", () => "x", "invalid"],
    ["wrong schema", () => ({ ...envelope(7), schema: 2 }), "invalid"],
    ["wrong event", () => ({ ...envelope(7), eventId: "112" }), "invalid"],
    ["wrong locale", () => ({ ...envelope(7), locale: "ko" }), "invalid"],
    ["atLeastRev ≠ requested R", () => envelope(7, 6), "invalid"],
    ["rev not a safe integer", () => ({ ...envelope(7), rev: 2 ** 53 }), "invalid"],
    ["rev < R", () => ({ ...envelope(7), rev: 6 }), "stale"],
    ["missing capturedAt", () => ({ ...envelope(7), capturedAt: undefined }), "invalid"],
    ["unparseable capturedAt", () => ({ ...envelope(7), capturedAt: "yesterday" }), "invalid"],
    ["bytes ≠ payload length", () => ({ ...envelope(7), bytes: 3 }), "invalid"],
    [
      "oversize",
      () => {
        const payload = "x".repeat(WARM_MAX_BYTES + 1);
        return { ...envelope(7), payload, bytes: payload.length };
      },
      "invalid",
    ],
    ["payload not the codec's JSON", () => ({ ...envelope(7), payload: "{", bytes: 1 }), "invalid"],
    [
      "payload rev ≠ envelope rev",
      () => {
        const other = envelope(8);
        return { ...envelope(7), payload: other.payload, bytes: other.bytes };
      },
      "invalid",
    ],
  ];
  it.each(rejects)("rejects %s", (_name, make, reason) => {
    expect(decodeWarmEnvelope(make(), EVENT, "ja", 7)).toEqual({ ok: false, reason });
  });
});

describe("flag", () => {
  it("is on only for exactly LIVE_WARM_ENTRIES=1", () => {
    expect(liveWarmEnabled()).toBe(false);
    process.env.LIVE_WARM_ENTRIES = "true";
    expect(liveWarmEnabled()).toBe(false);
    process.env.LIVE_WARM_ENTRIES = "1";
    expect(liveWarmEnabled()).toBe(true);
  });

  it("off: scheduleWarm registers nothing and warmLookup is never needed", () => {
    scheduleWarm(EVENT, BigInt(5));
    expect(after).not.toHaveBeenCalled();
    expect(lines()).toEqual([]);
  });

  it("on: scheduleWarm registers one after() job", () => {
    process.env.LIVE_WARM_ENTRIES = "1";
    scheduleWarm(EVENT, BigInt(5));
    expect(after).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledWith(expect.any(Function));
  });

  it("on: an after() that throws (no request scope) is logged, never thrown", () => {
    process.env.LIVE_WARM_ENTRIES = "1";
    vi.mocked(after).mockImplementationOnce(() => {
      throw new Error("after was called outside a request scope");
    });
    expect(() => scheduleWarm(EVENT, BigInt(5))).not.toThrow();
    expect(lines()[0]).toMatch(
      /^\[liveWarm\] schedule-failed event=111 rev=5 err=Error:after was called outside a request scope instance=[0-9a-f]{8}$/,
    );
  });
});

describe("runWarmJob", () => {
  it("builds every locale, stores each at <event>:<locale>:<R> with ttl 90 + tags, logs start/set/done", async () => {
    vi.mocked(buildEventSnapshot).mockImplementation(async () => snap(6));
    // `warmEntryCache()` returns a fresh wrapper per call, so record the
    // `set` calls through the factory.
    const sets: Array<[string, unknown, unknown]> = [];
    vi.mocked(warmEntryCache).mockImplementation(() => {
      const c = actualDataCache.warmEntryCache();
      return {
        ...c,
        set: async (key: string, value: unknown, opts?: unknown) => {
          sets.push([key, value, opts]);
          return c.set(key, value, opts as never);
        },
      };
    });

    await runWarmJob(EVENT, BigInt(5));

    expect(buildEventSnapshot).toHaveBeenCalledTimes(3);
    expect(sets.map(([k]) => k).sort()).toEqual(
      ["en", "ja", "ko"].map((l) => warmKey(EVENT, l as Locale, 5)).sort(),
    );
    for (const [, value, opts] of sets) {
      expect(value).toMatchObject({ atLeastRev: 5, rev: 6 });
      expect(opts).toEqual({
        ttl: WARM_TTL_SECONDS,
        tags: ["warm-public-data", "warm-event-111"],
      });
    }
    const out = lines();
    expect(out[0]).toMatch(/^\[liveWarm\] start event=111 rev=5 instance=[0-9a-f]{8}$/);
    const setLines = out.filter((l) => l.startsWith("[liveWarm] set "));
    expect(setLines).toHaveLength(3);
    for (const l of setLines) {
      expect(l).toMatch(
        /^\[liveWarm\] set event=111 locale=(ko|ja|en) atLeastRev=5 rev=6 bytes=\d+ buildMs=\d+ setMs=\d+ ok=true instance=[0-9a-f]{8}$/,
      );
    }
    expect(out.at(-1)).toMatch(/^\[liveWarm\] done event=111 rev=5 ms=\d+ instance=[0-9a-f]{8}$/);

    // And the reader finds them.
    process.env.LIVE_WARM_ENTRIES = "1";
    const hit = await warmLookup(EVENT, "ko", 5);
    expect(hit.result).toBe("hit");
  });

  it("runs at most 2 builds at once (1 with LIVE_WARM_CONCURRENCY=1)", async () => {
    for (const [env, expected] of [
      [undefined, 2],
      ["1", 1],
    ] as const) {
      if (env) process.env.LIVE_WARM_CONCURRENCY = env;
      let running = 0;
      let peak = 0;
      vi.mocked(buildEventSnapshot).mockImplementation(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running -= 1;
        return snap(6);
      });
      await runWarmJob(EVENT, BigInt(5));
      expect(peak).toBe(expected);
      expect(buildEventSnapshot).toHaveBeenCalledTimes(3);
      vi.mocked(buildEventSnapshot).mockClear();
    }
  });

  it("a failed build skips that locale only; the job still finishes", async () => {
    vi.mocked(buildEventSnapshot).mockImplementation(async (_id, locale) => {
      if (locale === "ja") throw new Error("pool exhausted");
      return snap(6);
    });
    await expect(runWarmJob(EVENT, BigInt(5))).resolves.toBeUndefined();
    const out = lines();
    expect(out).toContainEqual(
      expect.stringMatching(
        /^\[liveWarm\] skip event=111 locale=ja atLeastRev=5 reason=build-error rev=- bytes=- buildMs=\d+ instance=[0-9a-f]{8}$/,
      ),
    );
    expect(out.filter((l) => l.startsWith("[liveWarm] set "))).toHaveLength(2);
    expect(out.at(-1)).toMatch(/^\[liveWarm\] done /);
    process.env.LIVE_WARM_ENTRIES = "1";
    expect((await warmLookup(EVENT, "ja", 5)).result).toBe("miss");
  });

  it("an oversize snapshot is skipped, not stored", async () => {
    vi.mocked(buildEventSnapshot).mockImplementation(async () =>
      snap(6, { buildId: "x".repeat(WARM_MAX_BYTES) }),
    );
    await runWarmJob(EVENT, BigInt(5));
    const skips = lines().filter((l) => l.startsWith("[liveWarm] skip "));
    expect(skips).toHaveLength(3);
    expect(skips[0]).toMatch(/reason=oversize rev=6 bytes=\d+ buildMs=\d+ instance=/);
    process.env.LIVE_WARM_ENTRIES = "1";
    expect((await warmLookup(EVENT, "ko", 5)).result).toBe("miss");
  });

  it("a set that throws is logged ok=false and the job continues", async () => {
    vi.mocked(buildEventSnapshot).mockImplementation(async () => snap(6));
    vi.mocked(warmEntryCache).mockReturnValue({
      set: async () => {
        throw new Error("boom");
      },
    } as unknown as RuntimeCache);
    await runWarmJob(EVENT, BigInt(5));
    const setLines = lines().filter((l) => l.startsWith("[liveWarm] set "));
    expect(setLines).toHaveLength(3);
    expect(setLines.every((l) => l.includes(" ok=false "))).toBe(true);
  });
});

describe("warmLookup", () => {
  const LOOKUP =
    /^\[setlist\] warm-lookup event=111 locale=ja minRev=7 result=(\w+) ms=\d+ instance=[0-9a-f]{8}$/;

  it("miss when nothing is stored; logs one line", async () => {
    expect(await warmLookup(EVENT, "ja", 7)).toEqual({ result: "miss" });
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatch(LOOKUP);
    expect(LOOKUP.exec(lines()[0])![1]).toBe("miss");
  });

  it("hit for the exact key; another R or locale is a miss", async () => {
    await warmEntryCache().set(warmKey(EVENT, "ja", 7), envelope(8, 7), {
      tags: [WARM_PUBLIC_DATA_TAG],
    });
    const hit = await warmLookup(EVENT, "ja", 7);
    expect(hit.result).toBe("hit");
    expect(hit.result === "hit" && hit.snapshot.rev).toBe(BigInt(8));
    expect((await warmLookup(EVENT, "ja", 8)).result).toBe("miss");
    expect((await warmLookup(EVENT, "ko", 7)).result).toBe("miss");
  });

  it("invalid / stale stored values are reported and never served", async () => {
    await warmEntryCache().set(warmKey(EVENT, "ja", 7), { ...envelope(7), rev: 6 }, {
      tags: [WARM_PUBLIC_DATA_TAG],
    });
    expect(await warmLookup(EVENT, "ja", 7)).toEqual({ result: "stale" });
    __resetLiveWarmStateForTests();
    await warmEntryCache().set(warmKey(EVENT, "ja", 7), { ...envelope(7), capturedAt: "" }, {
      tags: [WARM_PUBLIC_DATA_TAG],
    });
    expect(await warmLookup(EVENT, "ja", 7)).toEqual({ result: "invalid" });
  });

  it("a GET slower than 300 ms is a timeout (and its late value is dropped)", async () => {
    vi.useFakeTimers();
    let release!: (v: unknown) => void;
    vi.mocked(warmEntryCache).mockReturnValue({
      get: () => new Promise((r) => (release = r)),
    } as unknown as RuntimeCache);
    const pending = warmLookup(EVENT, "ja", 7);
    await vi.advanceTimersByTimeAsync(300);
    expect(await pending).toEqual({ result: "timeout" });
    release(envelope(7));
    expect(LOOKUP.exec(lines()[0])![1]).toBe("timeout");
  });

  it("a GET that rejects, or a cache that throws synchronously, is an error", async () => {
    vi.mocked(warmEntryCache).mockReturnValueOnce({
      get: async () => {
        throw new Error("network");
      },
    } as unknown as RuntimeCache);
    expect(await warmLookup(EVENT, "ja", 7)).toEqual({ result: "error" });
    __resetLiveWarmStateForTests();
    vi.mocked(warmEntryCache).mockImplementationOnce(() => {
      throw new Error("no cache");
    });
    expect(await warmLookup(EVENT, "ja", 7)).toEqual({ result: "error" });
  });
});

describe("warmLookup — per-instance volume bound (untrusted hints)", () => {
  // A cache whose `get` the test resolves by hand, counting calls.
  function manualCache() {
    const pending: Array<(v: unknown) => void> = [];
    const get = vi.fn(() => new Promise((r) => pending.push(r)));
    const set = vi.fn(async () => {});
    vi.mocked(warmEntryCache).mockReturnValue({ get, set } as unknown as RuntimeCache);
    return { get, set, pending };
  }

  it("concurrent lookups for one key share a single get and its result", async () => {
    const { get, pending } = manualCache();
    const a = warmLookup(EVENT, "ja", 7);
    const b = warmLookup(EVENT, "ja", 7);
    const c = warmLookup(EVENT, "ko", 7); // another key: its own get
    await Promise.resolve();
    expect(get).toHaveBeenCalledTimes(2);
    pending[0](envelope(7));
    pending[1](null);
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra.result).toBe("hit");
    expect(rb.result).toBe("hit");
    expect(rc.result).toBe("miss");
    expect(lines().filter((l) => l.startsWith("[setlist] warm-lookup "))).toHaveLength(3);
  });

  it("a plain miss suppresses the get for 250 ms (memo-miss), then asks again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(10_000);
    const { get } = manualCache();
    get.mockResolvedValue(null);
    expect((await warmLookup(EVENT, "ja", 7)).result).toBe("miss");
    vi.setSystemTime(10_249);
    expect((await warmLookup(EVENT, "ja", 7)).result).toBe("memo-miss");
    expect(get).toHaveBeenCalledTimes(1);
    expect(lines().at(-1)).toMatch(
      /^\[setlist\] warm-lookup event=111 locale=ja minRev=7 result=memo-miss ms=\d+ instance=[0-9a-f]{8}$/,
    );
    vi.setSystemTime(10_250);
    expect((await warmLookup(EVENT, "ja", 7)).result).toBe("miss");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it.each(["invalid", "stale", "error", "timeout"] as const)(
    "a %s result is memoised for 1 s",
    async (kind) => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      vi.setSystemTime(20_000);
      const { get, pending } = manualCache();
      if (kind === "invalid") get.mockResolvedValue({ junk: true });
      if (kind === "stale") get.mockResolvedValue({ ...envelope(7), rev: 6 });
      if (kind === "error") get.mockRejectedValue(new Error("network"));
      const first = warmLookup(EVENT, "ja", 7);
      if (kind === "timeout") await vi.advanceTimersByTimeAsync(300);
      expect((await first).result).toBe(kind);
      const doneAt = Date.now();
      if (kind === "timeout") {
        // The slow get answers later: it frees its slot, and its `miss`
        // must not shorten the 1 s fault window.
        pending[0](null);
        await vi.advanceTimersByTimeAsync(0);
      }
      vi.setSystemTime(doneAt + 999);
      expect((await warmLookup(EVENT, "ja", 7)).result).toBe("memo-miss");
      expect(get).toHaveBeenCalledTimes(1);
      vi.setSystemTime(doneAt + 1_000);
      const again = warmLookup(EVENT, "ja", 7);
      if (kind === "timeout") await vi.advanceTimersByTimeAsync(300);
      expect((await again).result).toBe(kind);
      expect(get).toHaveBeenCalledTimes(2);
    },
  );

  it("a hit is not memoised: every lookup reads the cache", async () => {
    const { get } = manualCache();
    get.mockResolvedValue(envelope(7));
    for (let i = 0; i < 3; i++) {
      expect((await warmLookup(EVENT, "ja", 7)).result).toBe("hit");
    }
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("a warm job storing the key on this instance clears its memoised miss", async () => {
    // Frozen clock: the memo cannot expire on its own, so the hit below
    // is the job clearing it.
    vi.useFakeTimers({ toFake: ["Date"] });
    expect((await warmLookup(EVENT, "ko", 5)).result).toBe("miss");
    expect((await warmLookup(EVENT, "ko", 5)).result).toBe("memo-miss");
    vi.mocked(buildEventSnapshot).mockImplementation(async () => snap(5));
    await runWarmJob(EVENT, BigInt(5));
    expect((await warmLookup(EVENT, "ko", 5)).result).toBe("hit");
  });

  it("the memo holds at most WARM_MISS_MEMO_MAX_KEYS keys, dropping the oldest", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); // no memo expires mid-test
    const { get } = manualCache();
    get.mockResolvedValue(null);
    for (let r = 1; r <= WARM_MISS_MEMO_MAX_KEYS + 50; r++) {
      await warmLookup(EVENT, "ja", r);
    }
    expect(__warmMissMemoSizeForTests()).toBe(WARM_MISS_MEMO_MAX_KEYS);
    // The oldest forged revision was evicted (asks again); the newest is
    // still memoised.
    get.mockClear();
    expect((await warmLookup(EVENT, "ja", 1)).result).toBe("miss");
    expect((await warmLookup(EVENT, "ja", WARM_MISS_MEMO_MAX_KEYS + 50)).result).toBe("memo-miss");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("caps concurrent DISTINCT keys: the 17th new key is capped without a get; same-key joins still share", async () => {
    const { get, pending } = manualCache();
    const inflight = Array.from({ length: WARM_LOOKUP_MAX_INFLIGHT }, (_, i) =>
      warmLookup(EVENT, "ja", 100 + i),
    );
    await Promise.resolve();
    expect(get).toHaveBeenCalledTimes(WARM_LOOKUP_MAX_INFLIGHT);

    expect(await warmLookup(EVENT, "ja", 999)).toEqual({ result: "capped" });
    expect(get).toHaveBeenCalledTimes(WARM_LOOKUP_MAX_INFLIGHT);
    expect(lines().at(-1)).toMatch(
      /^\[setlist\] warm-lookup event=111 locale=ja minRev=999 result=capped ms=\d+ instance=[0-9a-f]{8}$/,
    );

    // Joining a key already in flight takes no slot and shares its get.
    const join = warmLookup(EVENT, "ja", 100);
    expect(get).toHaveBeenCalledTimes(WARM_LOOKUP_MAX_INFLIGHT);
    pending[0](envelope(100));
    for (const resolve of pending.slice(1)) resolve(null);
    expect((await join).result).toBe("hit");
    expect((await inflight[0]).result).toBe("hit");
    await Promise.all(inflight);

    // Slots are free again once the gets settled.
    const next = warmLookup(EVENT, "ja", 999);
    await Promise.resolve();
    expect(get).toHaveBeenCalledTimes(WARM_LOOKUP_MAX_INFLIGHT + 1);
    pending.at(-1)!(null);
    expect((await next).result).toBe("miss");
  });

  it("a lookup in flight when a warm job stores its key does not memoise its outdated miss", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); // the memo cannot expire on its own
    const { get, set, pending } = manualCache();
    const early = warmLookup(EVENT, "ko", 5);
    await Promise.resolve();
    expect(get).toHaveBeenCalledTimes(1);

    vi.mocked(buildEventSnapshot).mockImplementation(async () => snap(5));
    await runWarmJob(EVENT, BigInt(5)); // stores (and clears) ko/ja/en for R=5
    expect(set).toHaveBeenCalledTimes(3);

    pending[0](null); // the early get answers "absent" — from before the set
    expect((await early).result).toBe("miss");
    expect(__warmMissMemoSizeForTests()).toBe(0);

    // The next lookup asks the cache instead of answering memo-miss.
    const next = warmLookup(EVENT, "ko", 5);
    await Promise.resolve();
    expect(get).toHaveBeenCalledTimes(2);
    pending[1](envelope(5, 5, "ko"));
    expect((await next).result).toBe("hit");
  });

  it("a timed-out lookup keeps its slot until the underlying get settles", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const { get } = manualCache(); // later gets stay pending
    // The first key's get answers (absent) only at 400 ms.
    get.mockImplementationOnce(() => new Promise((r) => setTimeout(() => r(null), 400)));
    const slow = warmLookup(EVENT, "ja", 1);
    await vi.advanceTimersByTimeAsync(300);
    expect(await slow).toEqual({ result: "timeout" }); // the caller's deadline

    await vi.advanceTimersByTimeAsync(50); // t = 350: get still running
    const others = Array.from({ length: WARM_LOOKUP_MAX_INFLIGHT - 1 }, (_, i) =>
      warmLookup(EVENT, "ja", 100 + i),
    );
    expect(get).toHaveBeenCalledTimes(WARM_LOOKUP_MAX_INFLIGHT);
    // The slow key + 15 others = 16 slots: a 17th distinct key is capped.
    expect(await warmLookup(EVENT, "ja", 999)).toEqual({ result: "capped" });

    await vi.advanceTimersByTimeAsync(100); // t = 450: the slow get settled
    const freed = warmLookup(EVENT, "ja", 998);
    expect(get).toHaveBeenCalledTimes(WARM_LOOKUP_MAX_INFLIGHT + 1);
    await vi.advanceTimersByTimeAsync(300);
    expect((await freed).result).toBe("timeout");
    await Promise.all(others);
  });
});
