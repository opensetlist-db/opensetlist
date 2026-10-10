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
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: vi.fn(async () => {
      db.builds += 1;
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
  return {
    prisma: {
      $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
      // The repair path's uncached `SELECT "setlistRevision"`.
      $queryRaw: vi.fn(async () => {
        db.revReads += 1;
        return [{ setlistRevision: db.rev }];
      }),
    },
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
  type EventSnapshot,
} from "@/lib/liveSnapshot";
import { revalidateEventData } from "@/lib/dataCache";

beforeEach(() => {
  cache.clear();
  __resetLiveSnapshotStateForTests();
  db.rev = BigInt(5);
  db.status = "scheduled";
  db.builds = 0;
  db.revReads = 0;
  db.gate = null;
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

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
