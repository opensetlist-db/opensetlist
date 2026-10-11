import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// GET /api/setlist (n14) — response shape, headers and parameter
// handling. `getLiveSnapshot` is mocked; `parseMinRev` and
// `resolveSnapshotForResponse` stay real so the response-time status
// resolution and minRev validation are exercised end-to-end through the
// handler.

vi.mock("@/lib/liveSnapshot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/liveSnapshot")>();
  return { ...actual, getLiveSnapshot: vi.fn() };
});

import { GET } from "@/app/api/setlist/route";
import { getLiveSnapshot, type EventSnapshot } from "@/lib/liveSnapshot";

const snapshot: EventSnapshot = {
  found: true,
  isDeleted: false,
  rawStatus: "scheduled",
  startTime: new Date("2026-11-14T07:30:00.000Z"),
  rev: BigInt(42),
  capturedAt: new Date("2026-11-14T07:29:00.123Z"),
  items: [],
  reactionCounts: { "10": { best: 2 } },
  top3Wishes: [],
  buildId: "b1",
};

function get(query: string) {
  return GET(
    new Request(`http://localhost/api/setlist?${query}`) as unknown as Parameters<
      typeof GET
    >[0],
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLiveSnapshot).mockResolvedValue({ snapshot, source: "cache", verify: { kind: "none" } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/setlist", () => {
  it("400s without a valid eventId and never reads", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("eventId=abc")).status).toBe(400);
    expect(getLiveSnapshot).not.toHaveBeenCalled();
  });

  it("returns the R1 shape with rev / capturedAt / startTime and the legacy updatedAt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-14T07:31:00.000Z"));
    const res = await get("eventId=111&locale=ja");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      items: [],
      reactionCounts: { "10": { best: 2 } },
      top3Wishes: [],
      status: "ongoing",
      startTime: "2026-11-14T07:30:00.000Z",
      rev: 42,
      capturedAt: "2026-11-14T07:29:00.123Z",
      servedAt: "2026-11-14T07:31:00.000Z",
      updatedAt: "2026-11-14T07:31:00.000Z",
    });
    expect(Number.isSafeInteger(body.rev)).toBe(true);
  });

  it("headers: public must-revalidate, no s-maxage, snapshot source passed through", async () => {
    vi.mocked(getLiveSnapshot).mockResolvedValue({ snapshot, source: "repair", verify: { kind: "none" } });
    const res = await get("eventId=111&locale=ja");
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(res.headers.get("x-snapshot-source")).toBe("repair");
  });

  it("status is resolved at response time from the same cached snapshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-14T07:29:30.000Z"));
    expect((await (await get("eventId=111")).json()).status).toBe("upcoming");
    vi.setSystemTime(new Date("2026-11-14T07:30:30.000Z"));
    expect((await (await get("eventId=111")).json()).status).toBe("ongoing");
  });

  it("passes a valid minRev through and ignores an invalid one", async () => {
    await get("eventId=111&locale=ko&minRev=43");
    expect(getLiveSnapshot).toHaveBeenLastCalledWith(BigInt(111), "ko", 43, { hint: false });
    await get("eventId=111&locale=ko&minRev=-1");
    expect(getLiveSnapshot).toHaveBeenLastCalledWith(BigInt(111), "ko", null, { hint: false });
    await get("eventId=111&locale=ko&minRev=1e9");
    expect(getLiveSnapshot).toHaveBeenLastCalledWith(BigInt(111), "ko", null, { hint: false });
  });

  it("normalizes an unknown locale to the default before it reaches the cache key", async () => {
    await get("eventId=111&locale=xx");
    expect(getLiveSnapshot).toHaveBeenLastCalledWith(BigInt(111), "ja", null, { hint: false });
  });

  it("soft-deleted event → status null", async () => {
    vi.mocked(getLiveSnapshot).mockResolvedValue({
      snapshot: { ...snapshot, isDeleted: true },
      source: "cache",
      verify: { kind: "none" },
    });
    const body = await (await get("eventId=111")).json();
    expect(body.status).toBeNull();
    expect(body.startTime).toBeNull();
  });
});

describe("GET /api/setlist — failure and slow-hit diagnostics", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  const lines = () => vi.mocked(console.log).mock.calls.map((c) => String(c[0]));

  it("a failed build answers 503 snapshot_unavailable, no-store, randomized Retry-After 1..3", async () => {
    const seen = new Set<string>();
    for (const r of [0, 0.5, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValueOnce(r);
      vi.mocked(getLiveSnapshot).mockRejectedValueOnce(
        Object.assign(new Error("(EMAXCONN) max client connections reached, limit: 200"), {
          cause: { code: "XX000", severity: "FATAL" },
        }),
      );
      const res = await get("eventId=111&locale=ko");
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "snapshot_unavailable" });
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(res.headers.get("x-snapshot-source")).toBe("error");
      seen.add(res.headers.get("Retry-After")!);
    }
    expect([...seen].sort()).toEqual(["1", "2", "3"]);
    // Errors that did not come through the builder are logged here.
    const failed = lines().filter((l) => l.startsWith("[liveSnapshot] build-failed "));
    expect(failed).toHaveLength(3);
    expect(failed[0]).toMatch(
      /^\[liveSnapshot\] build-failed event=111 locale=ko ms=\d+ err=Error:\(EMAXCONN\) max client connections reached, limit: 200 instance=[0-9a-f]{8}$/,
    );
  });

  it("logs slow-hit only for a cache-sourced response over 500 ms", async () => {
    const at = (ms: number) =>
      vi.mocked(getLiveSnapshot).mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + ms);
        return { snapshot, source: "cache", verify: { kind: "none" } } as const;
      });
    vi.useFakeTimers({ toFake: ["Date"] });
    at(120);
    await get("eventId=111&locale=en");
    expect(lines().some((l) => l.startsWith("[setlist] slow-hit"))).toBe(false);
    at(800);
    await get("eventId=111&locale=en");
    expect(lines().filter((l) => l.startsWith("[setlist] slow-hit"))).toEqual([
      expect.stringMatching(
        /^\[setlist\] slow-hit ms=800 event=111 locale=en instance=[0-9a-f]{8}$/,
      ),
    ]);
    // A slow BUILD is expected and not a slow hit.
    vi.mocked(getLiveSnapshot).mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 900);
      return { snapshot, source: "build", verify: { kind: "none" } } as const;
    });
    await get("eventId=111&locale=en");
    expect(lines().filter((l) => l.startsWith("[setlist] slow-hit"))).toHaveLength(1);
  });
});

describe("GET /api/setlist — x-snapshot-verify and ?hint=1", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  const hintLines = () =>
    vi
      .mocked(console.log)
      .mock.calls.map((c) => String(c[0]))
      .filter((l) => l.startsWith("[setlist] hint-fetch"));

  it.each([
    [{ kind: "none" }, "none"],
    [{ kind: "satisfied" }, "satisfied"],
    [{ kind: "fresh", dbRev: 41 }, "fresh=41"],
    [{ kind: "memo", rev: 41, ageMs: 730 }, "memo=41;age=730"],
    [{ kind: "deferred" }, "deferred"],
  ] as const)("200 carries x-snapshot-verify for %o", async (verify, wire) => {
    vi.mocked(getLiveSnapshot).mockResolvedValue({ snapshot, source: "cache", verify });
    const res = await get("eventId=111&locale=ja&minRev=50");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-snapshot-verify")).toBe(wire);
    // Verification is per request: never part of the body.
    expect(await res.json()).not.toHaveProperty("verify");
  });

  it("a 503 carries no x-snapshot-verify", async () => {
    vi.mocked(getLiveSnapshot).mockRejectedValueOnce(new Error("pool"));
    const res = await get("eventId=111&locale=ja&minRev=50&hint=1");
    expect(res.status).toBe(503);
    expect(res.headers.get("x-snapshot-verify")).toBeNull();
  });

  it("passes hint=1 through as { hint: true }; anything else is no hint", async () => {
    await get("eventId=111&locale=ko&minRev=43&hint=1");
    expect(getLiveSnapshot).toHaveBeenLastCalledWith(BigInt(111), "ko", 43, { hint: true });
    for (const raw of ["0", "true", "", "2", "01"]) {
      await get(`eventId=111&locale=ko&minRev=43&hint=${raw}`);
      expect(getLiveSnapshot).toHaveBeenLastCalledWith(BigInt(111), "ko", 43, { hint: false });
    }
  });

  it("logs exactly one hint-fetch line per hint-carrying request, none otherwise", async () => {
    vi.mocked(getLiveSnapshot).mockResolvedValue({
      snapshot,
      source: "cache",
      verify: { kind: "fresh", dbRev: 42 },
    });
    await get("eventId=111&locale=ko&minRev=50");
    expect(hintLines()).toHaveLength(0);
    await get("eventId=111&locale=ko&minRev=50&hint=1");
    expect(hintLines()).toEqual([
      expect.stringMatching(
        /^\[setlist\] hint-fetch event=111 locale=ko minRev=50 verify=fresh instance=[0-9a-f]{8}$/,
      ),
    ]);
    // No (valid) minRev → minRev=none; a 503 still logs, as verify=error.
    vi.mocked(getLiveSnapshot).mockRejectedValueOnce(new Error("pool"));
    await get("eventId=111&locale=ko&hint=1");
    expect(hintLines()).toHaveLength(2);
    expect(hintLines()[1]).toMatch(
      /^\[setlist\] hint-fetch event=111 locale=ko minRev=none verify=error instance=[0-9a-f]{8}$/,
    );
  });
});
