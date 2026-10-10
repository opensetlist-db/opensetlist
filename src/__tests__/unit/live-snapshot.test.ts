import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// n14 live snapshot — unit coverage for the parts that don't need a
// database: minRev validation, response-time status resolution from the
// cached raw fields, the safe-integer guard, and the cache / coalescing
// / repair control flow of `getLiveSnapshot`. The SQL itself (REPEATABLE
// READ consistency, revision bumps, broadcasts) is covered by the dev-DB
// integration suite in src/__tests__/integration/n14-live-path.test.ts.

// A fake "database": the revision and status the builder will read.
const db = vi.hoisted(() => ({
  rev: BigInt(5),
  status: "scheduled" as string,
  startTime: new Date("2026-11-14T07:30:00.000Z"),
  builds: 0,
  revReads: 0,
  // Lets a test hold a build open to prove coalescing.
  gate: null as Promise<void> | null,
  // Make the next build / revision read throw this.
  buildError: null as unknown,
  revReadError: null as unknown,
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: vi.fn(async () => {
      db.builds += 1;
      if (db.buildError) throw db.buildError;
      if (db.gate) await db.gate;
      return [
        {
          capturedAt: new Date("2026-10-10T00:00:00.000Z"),
          setlistRevision: db.rev,
          status: db.status,
          startTime: db.startTime,
          isDeleted: false,
          found: true,
        },
      ];
    }),
    setlistItem: { findMany: vi.fn(async () => []) },
    setlistItemReaction: { groupBy: vi.fn(async () => []) },
  };
  // The repair path's bounded revision read: its own short transaction
  // (`set_config('statement_timeout', …)` then the 1-row SELECT).
  const revTx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      if (strings.join("").includes("set_config")) return [{ set_config: "500" }];
      db.revReads += 1;
      if (db.revReadError) throw db.revReadError;
      return [{ setlistRevision: db.rev }];
    }),
  };
  return {
    prisma: {
      // The snapshot build is the REPEATABLE READ transaction; the
      // revision read passes no isolation level.
      $transaction: vi.fn(
        async (
          cb: (t: typeof tx | typeof revTx) => Promise<unknown>,
          opts?: { isolationLevel?: string },
        ) => cb(opts?.isolationLevel ? tx : revTx),
      ),
    },
    logPoolStats: vi.fn(),
  };
});

vi.mock("@/lib/wishes/top3", () => ({
  fetchEventWishlistTop3: vi.fn(async () => []),
}));

// In-memory stand-in for the Next data cache: a hit returns the stored
// value, a miss runs the fetcher and stores it. `revalidateEventData`
// is a spy — in Next 16 a Route Handler's purge applies only after the
// handler returns, so the mock deliberately does NOT clear the store
// (the repair path must not depend on an in-request purge).
const cache = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/dataCache", () => ({
  cachedQuery:
    (name: string, fn: (...args: unknown[]) => Promise<unknown>) =>
    async (...args: unknown[]) => {
      const key = [name, ...args].join("|");
      if (cache.has(key)) return cache.get(key);
      const value = await fn(...args);
      cache.set(key, value);
      return value;
    },
  eventTag: (id: unknown) => `event:${String(id)}`,
  revalidateEventData: vi.fn(),
}));

import {
  getLiveSnapshot,
  parseMinRev,
  resolveSnapshotForResponse,
  __resetLiveSnapshotStateForTests,
  logSnapshotFailure,
  type EventSnapshot,
} from "@/lib/liveSnapshot";
import { revalidateEventData } from "@/lib/dataCache";
import { logPoolStats, prisma } from "@/lib/prisma";

beforeEach(() => {
  cache.clear();
  __resetLiveSnapshotStateForTests();
  db.rev = BigInt(5);
  db.status = "scheduled";
  db.builds = 0;
  db.revReads = 0;
  db.gate = null;
  db.buildError = null;
  db.revReadError = null;
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// Lines the module wrote through console.log, for format assertions.
function logLines(): string[] {
  return vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("parseMinRev", () => {
  it("accepts non-negative decimal safe integers", () => {
    expect(parseMinRev("0")).toBe(0);
    expect(parseMinRev("42")).toBe(42);
    expect(parseMinRev(String(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it.each([
    null,
    "",
    "-1",
    "1.5",
    "1e3",
    " 1",
    "0x10",
    "abc",
    "9007199254740993", // > MAX_SAFE_INTEGER
    "99999999999999999999",
  ])("ignores %s", (raw) => {
    expect(parseMinRev(raw as string | null)).toBeNull();
  });
});

describe("resolveSnapshotForResponse", () => {
  const base: EventSnapshot = {
    found: true,
    isDeleted: false,
    rawStatus: "scheduled",
    startTime: new Date("2026-11-14T07:30:00.000Z"),
    rev: BigInt(3),
    capturedAt: new Date("2026-11-14T07:00:00.000Z"),
    items: [],
    reactionCounts: {},
    top3Wishes: [],
    buildId: "b",
  };

  it("resolves status from the cached raw fields at response time (boundary without a write)", () => {
    // Same cached snapshot, two response times either side of startTime.
    expect(
      resolveSnapshotForResponse(base, new Date("2026-11-14T07:29:59.000Z")).status,
    ).toBe("upcoming");
    expect(
      resolveSnapshotForResponse(base, new Date("2026-11-14T07:30:01.000Z")).status,
    ).toBe("ongoing");
  });

  it("serializes rev as a number and capturedAt / startTime as ISO", () => {
    expect(resolveSnapshotForResponse(base)).toMatchObject({
      rev: 3,
      capturedAt: "2026-11-14T07:00:00.000Z",
      startTime: "2026-11-14T07:30:00.000Z",
    });
  });

  it("status and startTime are null for a missing or soft-deleted event", () => {
    expect(resolveSnapshotForResponse({ ...base, isDeleted: true })).toMatchObject({
      status: null,
      startTime: null,
    });
    expect(
      resolveSnapshotForResponse({
        ...base,
        found: false,
        rawStatus: null,
        startTime: null,
      }),
    ).toMatchObject({ status: null, startTime: null });
  });

  it("refuses a revision beyond 2^53 rather than emitting a lossy number", () => {
    expect(() =>
      resolveSnapshotForResponse({ ...base, rev: BigInt("9007199254740993") }),
    ).toThrow(/safe integer/);
  });
});

describe("getLiveSnapshot", () => {
  it("first read builds, second read is a cache hit", async () => {
    const a = await getLiveSnapshot(BigInt(1), "ja");
    const b = await getLiveSnapshot(BigInt(1), "ja");
    expect(a.source).toBe("build");
    expect(b.source).toBe("cache");
    expect(b.snapshot.rev).toBe(BigInt(5));
    expect(db.builds).toBe(1);
  });

  it("locales are separate keys", async () => {
    await getLiveSnapshot(BigInt(1), "ja");
    const ko = await getLiveSnapshot(BigInt(1), "ko");
    expect(ko.source).toBe("build");
    expect(db.builds).toBe(2);
  });

  it("concurrent misses on one instance build once", async () => {
    let release!: () => void;
    db.gate = new Promise<void>((r) => (release = r));
    const p1 = getLiveSnapshot(BigInt(1), "ja");
    const p2 = getLiveSnapshot(BigInt(1), "ja");
    const p3 = getLiveSnapshot(BigInt(1), "ja");
    release();
    const results = await Promise.all([p1, p2, p3]);
    expect(db.builds).toBe(1);
    expect(new Set(results.map((r) => r.snapshot.buildId)).size).toBe(1);
  });

  it("minRev at or below the cached revision serves the cache without a DB read", async () => {
    await getLiveSnapshot(BigInt(1), "ja");
    const r = await getLiveSnapshot(BigInt(1), "ja", 5);
    expect(r.source).toBe("cache");
    expect(db.revReads).toBe(0);
  });

  it("minRev ahead of the database (forged hint) → one revision read, no rebuild, no purge", async () => {
    await getLiveSnapshot(BigInt(1), "ja");
    const r = await getLiveSnapshot(BigInt(1), "ja", 999);
    expect(r.source).toBe("cache");
    expect(r.snapshot.rev).toBe(BigInt(5));
    expect(db.revReads).toBe(1);
    expect(db.builds).toBe(1);
    expect(revalidateEventData).not.toHaveBeenCalled();
  });

  it("concurrent forged hints share one revision read per instance", async () => {
    await getLiveSnapshot(BigInt(1), "ja");
    await Promise.all([
      getLiveSnapshot(BigInt(1), "ja", 100),
      getLiveSnapshot(BigInt(1), "ja", 200),
      getLiveSnapshot(BigInt(1), "ja", 300),
    ]);
    expect(db.revReads).toBe(1);
  });

  it("cache behind the database → purge + rebuild under the server-read revision (repair)", async () => {
    await getLiveSnapshot(BigInt(1), "ja"); // caches rev 5
    db.rev = BigInt(6); // a save committed; the cached entry is stale
    const r = await getLiveSnapshot(BigInt(1), "ja", 6);
    expect(r.source).toBe("repair");
    expect(r.snapshot.rev).toBe(BigInt(6));
    expect(revalidateEventData).toHaveBeenCalledWith(BigInt(1));
    expect(db.builds).toBe(2);
    // A second repair for the same DB revision hits the repair entry,
    // and the remembered revision (6 ≥ minRev 6) needs no second read.
    const again = await getLiveSnapshot(BigInt(1), "ja", 6);
    expect(again.source).toBe("cache");
    expect(db.builds).toBe(2);
    expect(db.revReads).toBe(1);
  });

  it("sequential forged hints within the memo window cost one revision read", async () => {
    await getLiveSnapshot(BigInt(1), "ja");
    await getLiveSnapshot(BigInt(1), "ja", 100);
    await getLiveSnapshot(BigInt(1), "ja", 200);
    await getLiveSnapshot(BigInt(1), "ja", 300);
    expect(db.revReads).toBe(1);
    expect(db.builds).toBe(1);
  });

  it("after the memo window an unsatisfied hint reads the database again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T07:00:00.000Z"));
    await getLiveSnapshot(BigInt(1), "ja");
    await getLiveSnapshot(BigInt(1), "ja", 6); // read → 5, refuted
    expect(db.revReads).toBe(1);
    db.rev = BigInt(6); // a save lands
    vi.setSystemTime(new Date("2026-11-14T07:00:00.500Z"));
    const within = await getLiveSnapshot(BigInt(1), "ja", 6);
    expect(within.snapshot.rev).toBe(BigInt(5)); // memo still refutes
    expect(db.revReads).toBe(1);
    vi.setSystemTime(new Date("2026-11-14T07:00:01.500Z"));
    const after = await getLiveSnapshot(BigInt(1), "ja", 6);
    expect(db.revReads).toBe(2);
    expect(after.source).toBe("repair");
    expect(after.snapshot.rev).toBe(BigInt(6));
  });

  it("without minRev a stale cache entry is served as-is (no DB read)", async () => {
    await getLiveSnapshot(BigInt(1), "ja");
    db.rev = BigInt(9);
    const r = await getLiveSnapshot(BigInt(1), "ja");
    expect(r.snapshot.rev).toBe(BigInt(5));
    expect(db.revReads).toBe(0);
  });
});

describe("getLiveSnapshot — diagnostics and failure handling", () => {
  it("a real build logs the build line followed by the pool stats", async () => {
    await getLiveSnapshot(BigInt(1), "ja");
    expect(logLines().some((l) => l.startsWith("[liveSnapshot] build event=1 locale=ja rev=5 "))).toBe(true);
    expect(logPoolStats).toHaveBeenCalledTimes(1);
    expect(logPoolStats).toHaveBeenCalledWith("build");
    // A cache hit builds nothing and logs no pool stats.
    await getLiveSnapshot(BigInt(1), "ja");
    expect(logPoolStats).toHaveBeenCalledTimes(1);
  });

  it("logs one coalesced line with the waiter count when a build is shared", async () => {
    let release!: () => void;
    db.gate = new Promise<void>((r) => (release = r));
    const ps = [1, 2, 3].map(() => getLiveSnapshot(BigInt(1), "ja"));
    release();
    await Promise.all(ps);
    const lines = logLines().filter((l) => l.startsWith("[liveSnapshot] coalesced "));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\[liveSnapshot\] coalesced waiters=3 event=1 locale=ja instance=[0-9a-f]{8}$/,
    );
  });

  it("a lone request logs no coalesced line", async () => {
    await getLiveSnapshot(BigInt(1), "ja");
    expect(logLines().some((l) => l.includes("coalesced"))).toBe(false);
  });

  it("a failed build rejects every waiter and logs build-failed once", async () => {
    db.buildError = Object.assign(new Error("timeout exceeded when trying to connect"), {
      clientVersion: "7.7.0",
    });
    const results = await Promise.allSettled([
      getLiveSnapshot(BigInt(1), "ja"),
      getLiveSnapshot(BigInt(1), "ja"),
    ]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    const failed = logLines().filter((l) => l.startsWith("[liveSnapshot] build-failed "));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatch(
      /^\[liveSnapshot\] build-failed event=1 locale=ja ms=\d+ err=Error:timeout exceeded when trying to connect instance=[0-9a-f]{8}$/,
    );
    // The route's own call for the same error object is a no-op.
    logSnapshotFailure(BigInt(1), "ja", 99, (results[0] as PromiseRejectedResult).reason);
    expect(logLines().filter((l) => l.startsWith("[liveSnapshot] build-failed "))).toHaveLength(1);
  });

  it("rev read runs as a bounded transaction and logs one rev-read line", async () => {
    await getLiveSnapshot(BigInt(1), "ja");
    await getLiveSnapshot(BigInt(1), "ja", 999); // forged hint → one read
    expect(prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      maxWait: 1_000,
      timeout: 1_500,
    });
    const lines = logLines().filter((l) => l.startsWith("[liveSnapshot] rev-read "));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\[liveSnapshot\] rev-read event=1 rev=5 ms=\d+ instance=[0-9a-f]{8}$/,
    );
  });

  it("rev read that times out → cannot verify: serve the cached snapshot, no repair, remembered", async () => {
    await getLiveSnapshot(BigInt(1), "ja"); // caches rev 5
    db.rev = BigInt(6);
    // Postgres cancelled the SELECT (statement_timeout), as Prisma
    // surfaces it: P2010 with the adapter error under meta.
    db.revReadError = Object.assign(new Error("Raw query failed. Code: `57014`."), {
      code: "P2010",
      meta: {
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: { kind: "postgres", code: "57014", message: "canceling statement due to statement timeout" },
        },
      },
    });
    const r = await getLiveSnapshot(BigInt(1), "ja", 6);
    expect(r.source).toBe("cache");
    expect(r.snapshot.rev).toBe(BigInt(5));
    expect(db.builds).toBe(1);
    expect(revalidateEventData).not.toHaveBeenCalled();
    expect(
      logLines().filter((l) => l.startsWith("[liveSnapshot] rev-read ")),
    ).toEqual([expect.stringMatching(/ rev=timeout ms=\d+ instance=/)]);
    // Within the memo window the failure is remembered: no second read.
    db.revReadError = null;
    await getLiveSnapshot(BigInt(1), "ja", 6);
    expect(db.revReads).toBe(1);
  });

  it("rev read failing for another reason is labelled error, still serves the cache", async () => {
    await getLiveSnapshot(BigInt(1), "ja");
    db.revReadError = new Error("boom");
    const r = await getLiveSnapshot(BigInt(1), "ja", 6);
    expect(r.source).toBe("cache");
    expect(
      logLines().filter((l) => l.startsWith("[liveSnapshot] rev-read ")),
    ).toEqual([expect.stringMatching(/ rev=error ms=\d+ instance=/)]);
  });
});
