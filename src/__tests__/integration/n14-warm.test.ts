import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { devPgClient } from "./devPg";

// n14 writer warming (`LIVE_WARM_ENTRIES`) — integration test against
// the DEV database: a real live save, the real warm job building every
// locale from the database, and the real `/api/setlist` handler serving
// a hinted request from the warmed entry.
//
// What this can prove: the writer registers the job only after a
// committed save, the job's snapshots survive the codec + envelope +
// Runtime Cache JSON round trip, and a hinted request for that exact
// revision is answered `warm` / `satisfied` with the same body a fresh
// build produces; with the flag unset the path is the R2 one.
//
// What it cannot prove: the Runtime Cache here is the SDK's per-process
// IN-MEMORY fallback (no Vercel request context, no
// RUNTIME_CACHE_ENDPOINT), so writer and reader share one process.
// Cross-instance visibility, regional sharing, eviction, `set` latency
// and swallowed `set` errors are only observable on a Vercel deployment.
//
// `after()` has no request scope under Vitest, so it is replaced by a
// recorder and the registered job is run directly.

vi.mock("@/lib/admin-auth", () => ({ verifyAdminAPI: vi.fn(async () => null) }));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));

// As in n14-live-path.test.ts: `unstable_cache` and tag expiry need a
// Next request scope, so the data cache is a pass-through (every
// unhinted request is a real build) and expiry is a spy. The warm
// Runtime Cache handle stays real.
vi.mock("@/lib/dataCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dataCache")>()),
  cachedQuery:
    <A extends unknown[], R>(_name: string, fn: (...args: A) => Promise<R>) =>
    (...args: A) =>
      fn(...args),
  revalidateEventData: vi.fn(),
  revalidatePublicData: vi.fn(),
  revalidateEventImpressions: vi.fn(),
}));

import { after, type NextRequest } from "next/server";
import { poolStats, prisma } from "@/lib/prisma";
import {
  __resetLiveSnapshotStateForTests,
  __setSnapshotEstablishedHookForTests,
} from "@/lib/liveSnapshot";
import { parseWarmFault, runWarmJob } from "@/lib/liveWarm";
import { warmEntryCache, WARM_PUBLIC_DATA_TAG } from "@/lib/dataCache";
import { GET as SETLIST_GET } from "@/app/api/setlist/route";
import { POST as ADMIN_CREATE } from "@/app/api/admin/setlist-items/route";
import { locales } from "@/i18n/routing";

const SLUG = `n14-warm-itest-${Date.now()}`;
let eventId: bigint;
const pg = devPgClient();

function req(url: string, body?: unknown): NextRequest {
  return new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

async function save(position: number): Promise<number> {
  const res = await ADMIN_CREATE(
    req("http://x/api/admin/setlist-items", {
      eventId: eventId.toString(),
      position,
      type: "mc",
    }),
  );
  expect(res.status).toBe(201);
  return (await res.json()).rev;
}

async function getSetlist(query: string) {
  const res = await SETLIST_GET(req(`http://x/api/setlist?eventId=${eventId}${query}`));
  expect(res.status).toBe(200);
  const body = await res.json();
  return {
    source: res.headers.get("x-snapshot-source"),
    verify: res.headers.get("x-snapshot-verify"),
    body,
  };
}

// The response minus the per-response stamps and the snapshot's own
// capture instant (a fresh build is a new transaction).
function comparable(body: Record<string, unknown>) {
  const { servedAt, updatedAt, capturedAt, ...rest } = body;
  void servedAt;
  void updatedAt;
  void capturedAt;
  return rest;
}

async function runRegisteredJobs(): Promise<number> {
  const jobs = vi.mocked(after).mock.calls.map((c) => c[0] as () => Promise<void>);
  for (const job of jobs) await job();
  return jobs.length;
}

beforeAll(async () => {
  await pg.connect();
  const created = await prisma.event.create({
    data: {
      slug: SLUG,
      type: "concert",
      status: "ongoing",
      startTime: new Date(Date.now() - 60 * 60 * 1000),
      originalName: "n14 warm integration test (throwaway)",
    },
    select: { id: true },
  });
  eventId = created.id;
});

afterAll(async () => {
  delete process.env.LIVE_WARM_ENTRIES;
  if (eventId !== undefined) {
    const id = eventId.toString();
    await pg.query("BEGIN");
    for (const sql of [
      `DELETE FROM "SetlistItem" WHERE "eventId" = $1`,
      `DELETE FROM "Event" WHERE id = $1`,
    ]) {
      await pg.query(sql, [id]);
    }
    await pg.query("COMMIT");
  }
  await pg.end();
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.mocked(after).mockClear();
  __resetLiveSnapshotStateForTests();
  await warmEntryCache().expireTag(WARM_PUBLIC_DATA_TAG);
});

afterEach(() => {
  delete process.env.LIVE_WARM_ENTRIES;
});

describe("writer warming ON (LIVE_WARM_ENTRIES=1, in-memory Runtime Cache)", () => {
  it("a save warms every locale; the hinted request for that rev is served warm with a fresh build's body", async () => {
    process.env.LIVE_WARM_ENTRIES = "1";
    const log = vi.spyOn(console, "log");
    const rev = await save(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(await runRegisteredJobs()).toBe(1);

    const warmLines = log.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.startsWith("[liveWarm] "));
    expect(warmLines[0]).toMatch(new RegExp(`^\\[liveWarm\\] start event=${eventId} rev=${rev} `));
    const sets = warmLines.filter((l) => l.startsWith("[liveWarm] set "));
    expect(sets).toHaveLength(locales.length);
    for (const l of sets) {
      expect(l).toMatch(new RegExp(` atLeastRev=${rev} rev=${rev} bytes=\\d+ buildMs=\\d+ setMs=\\d+ ok=true `));
    }
    expect(warmLines.at(-1)).toMatch(new RegExp(`^\\[liveWarm\\] done event=${eventId} rev=${rev} ms=\\d+ `));

    for (const locale of locales) {
      const warm = await getSetlist(`&locale=${locale}&minRev=${rev}&hint=1`);
      expect(warm.source).toBe("warm");
      expect(warm.verify).toBe("satisfied");
      expect(warm.body.rev).toBe(rev);
      expect(Number.isFinite(Date.parse(warm.body.capturedAt))).toBe(true);

      const fresh = await getSetlist(`&locale=${locale}`);
      expect(fresh.source).toBe("build");
      expect(comparable(warm.body)).toEqual(comparable(fresh.body));
      // The warm snapshot was captured after the commit and before this
      // later build.
      expect(Date.parse(warm.body.capturedAt)).toBeLessThanOrEqual(
        Date.parse(fresh.body.capturedAt),
      );
    }
    const lookups = log.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.startsWith("[setlist] warm-lookup "));
    expect(lookups).toHaveLength(locales.length);
    expect(lookups.every((l) => l.includes(" result=hit "))).toBe(true);
    log.mockRestore();
  });

  it("only the exact hinted revision is warm: no hint, or a revision nobody warmed, takes the verified path", async () => {
    process.env.LIVE_WARM_ENTRIES = "1";
    const rev = await save(2);
    await runRegisteredJobs();

    const unhinted = await getSetlist(`&locale=ja&minRev=${rev}`);
    expect(unhinted.source).toBe("build");
    expect(unhinted.verify).toBe("satisfied");

    // A forged / future revision: a miss, then the bounded revision read
    // refutes it with fresh evidence.
    const forged = await getSetlist(`&locale=ja&minRev=${rev + 1000}&hint=1`);
    expect(forged.source).not.toBe("warm");
    expect(forged.verify).toBe(`fresh=${rev}`);
  });
});

describe("writer warming OFF (flag unset)", () => {
  it("a save registers no job and the hinted request is built as before", async () => {
    const rev = await save(3);
    expect(after).not.toHaveBeenCalled();
    const r = await getSetlist(`&locale=ja&minRev=${rev}&hint=1`);
    expect(r.source).toBe("build");
    expect(r.verify).toBe("satisfied");
    expect(r.body.rev).toBe(rev);
  });
});

// n14 step 4 — the `slowbuild` drill hold against the real local pool
// (`src/lib/prisma.ts`, max 2). What the deployed drills cannot force
// deterministically: a warm job at concurrency 2 with a DB-held slow
// build occupies BOTH of the instance's connections, so a third
// transaction on the instance cannot even start. Chosen assertion: the
// third transaction's `maxWait` (500 ms) is shorter than the remaining
// hold, so it FAILS with Prisma's "Unable to start a transaction in the
// given time" — rather than measuring a wait ≥ the remaining hold.
describe("slowbuild drill hold (dev DB, pool max 2)", () => {
  it("a slowbuild=1500 job holds both pool connections; a third transaction cannot start within maxWait", async () => {
    const rev = await save(4);
    const log = vi.spyOn(console, "log");

    // Barrier: both concurrent builds have run their snapshot-establishing
    // first statement, i.e. both are inside their transactions holding a
    // connection, and the 1500 ms hold starts right after.
    let established = 0;
    let bothEstablished!: () => void;
    const both = new Promise<void>((r) => (bothEstablished = r));
    __setSnapshotEstablishedHookForTests(async (id) => {
      if (id === eventId && ++established === 2) bothEstablished();
    });
    try {
      const job = runWarmJob(eventId, BigInt(rev), parseWarmFault("slowbuild=1500"));
      await both;
      const t0 = Date.now();
      await expect(
        prisma.$transaction(async (tx) => tx.$queryRaw`SELECT 1`, {
          maxWait: 500,
          timeout: 2_000,
        }),
      ).rejects.toThrow(/Unable to start a transaction in the given time/);
      const waited = Date.now() - t0;
      // Gave up on its own maxWait, while the hold was still running.
      expect(waited).toBeGreaterThanOrEqual(450);
      expect(waited).toBeLessThan(1_500);
      await job;
    } finally {
      __setSnapshotEstablishedHookForTests(null);
    }

    // The abandoned acquisition is served once a holder lets go and is
    // discarded by Prisma; wait for the pool to settle so later suites
    // start from an idle pool.
    const deadline = Date.now() + 10_000;
    for (;;) {
      const s = poolStats();
      if (s.waiting === 0 && s.idle === s.total) break;
      if (Date.now() > deadline) throw new Error("pool did not settle");
      await new Promise((r) => setTimeout(r, 50));
    }

    const sets = log.mock.calls
      .map((c) => String(c[0]))
      .filter(
        (l) =>
          l.startsWith("[liveWarm] set ") &&
          l.includes(` event=${eventId} `) &&
          l.includes(` atLeastRev=${rev} `),
      );
    log.mockRestore();
    expect(sets).toHaveLength(locales.length);
    const num = (l: string, k: string) => Number(l.match(new RegExp(` ${k}=(\\d+)(?: |$)`))?.[1]);
    const iv = sets
      .map((l) => {
        expect(l).toMatch(/ ok=true /);
        expect(l).toMatch(/ holdMs=1500 /);
        return { start: num(l, "txStartAt"), end: num(l, "txEndAt"), buildStart: num(l, "buildStartAt") };
      })
      .sort((a, b) => a.start - b.start);
    for (const i of iv) {
      expect(i.end - i.start).toBeGreaterThanOrEqual(1_500);
      // Queueing for a connection happens before the transaction starts.
      expect(i.start).toBeGreaterThanOrEqual(i.buildStart);
    }
    // The first two held their connections at the same time …
    expect(Math.max(iv[0].start, iv[1].start)).toBeLessThan(Math.min(iv[0].end, iv[1].end));
    // … and the third locale's build only got a connection after one of
    // them was released.
    expect(iv[2].start).toBeGreaterThanOrEqual(Math.min(iv[0].end, iv[1].end));
  });
});
