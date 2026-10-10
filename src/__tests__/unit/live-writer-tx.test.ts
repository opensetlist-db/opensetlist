import { describe, it, expect, vi, beforeEach } from "vitest";

// `liveWriterTransaction` / `liveWriterBusyResponse`: limits, the timing
// log line, and which failures become a 503. `$transaction` is mocked;
// whether it enters the callback decides "did the save start".

vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: vi.fn() } }));

import {
  ADMIN_DB_BUSY_MESSAGE,
  LiveWriterBusyError,
  liveWriterBusyResponse,
  liveWriterTransaction,
  withAdminLiveWriterBusy,
} from "@/lib/liveWriterTx";
import { prisma } from "@/lib/prisma";

const tx = {} as never;

// Run the callback (the save starts), optionally failing inside it.
function enters(fail?: unknown) {
  vi.mocked(prisma.$transaction).mockImplementationOnce((async (
    cb: (t: unknown) => Promise<unknown>,
  ) => {
    const out = await cb(tx);
    if (fail) throw fail;
    return out;
  }) as never);
}
// Reject without ever running the callback (the save never starts).
function neverStarts(err: unknown) {
  vi.mocked(prisma.$transaction).mockImplementationOnce((async () => {
    throw err;
  }) as never);
}

const acquireTimeout = () =>
  new Error("timeout exceeded when trying to connect");
const emaxconn = () =>
  Object.assign(new Error("(EMAXCONN) max client connections reached, limit: 200"), {
    cause: {
      kind: "postgres",
      code: "XX000",
      severity: "FATAL",
      message: "(EMAXCONN) max client connections reached, limit: 200",
    },
  });
const maxWait = () =>
  Object.assign(
    new Error("Transaction API error: Unable to start a transaction in the given time."),
    { code: "P2028" },
  );

const lines = () => vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
const LINE =
  /^\[liveWriter\] route=(\S+) acquireMs=(\d+) execMs=(\d+) rev=(\S+) ok=(true|false) instance=[0-9a-f]{8}$/;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("liveWriterTransaction", () => {
  it("passes explicit maxWait 2 s / timeout 8 s and returns the result", async () => {
    enters();
    const out = await liveWriterTransaction("admin-create", async () => "x");
    expect(out).toBe("x");
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 2_000,
      timeout: 8_000,
    });
  });

  it("logs one timing line with the revision read by revOf", async () => {
    enters();
    await liveWriterTransaction(
      "admin-update",
      async () => ({ kind: "ok", rev: BigInt(41) }),
      (r) => r.rev,
    );
    expect(lines()).toHaveLength(1);
    const m = lines()[0].match(LINE);
    expect(m?.slice(1)).toEqual(["admin-update", expect.any(String), expect.any(String), "41", "true"]);
  });

  it("a bigint result is the revision by default; anything else logs rev=-", async () => {
    enters();
    await liveWriterTransaction("admin-swap", async () => BigInt(7));
    enters();
    await liveWriterTransaction("admin-x", async () => ({ kind: "invalid" }));
    expect(lines().map((l) => l.match(LINE)?.[4])).toEqual(["7", "-"]);
  });

  it("measures acquire up to callback entry and execution after it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    vi.mocked(prisma.$transaction).mockImplementationOnce((async (
      cb: (t: unknown) => Promise<unknown>,
    ) => {
      vi.setSystemTime(300); // waited 300 ms for a connection + BEGIN
      const out = await cb(tx);
      vi.setSystemTime(345); // commit
      return out;
    }) as never);
    await liveWriterTransaction("admin-create", async () => {
      vi.setSystemTime(340); // lock + writes
      return BigInt(1);
    });
    vi.useRealTimers();
    expect(lines()[0]).toMatch(/ acquireMs=300 execMs=45 rev=1 ok=true /);
  });

  it.each([
    ["pool acquire timeout", acquireTimeout(), "pool_acquire_timeout"],
    ["pooler cap (EMAXCONN)", emaxconn(), "pooler_cap"],
    ["Prisma maxWait (P2028)", maxWait(), "tx_max_wait"],
  ])("%s before the callback → LiveWriterBusyError, ok=false execMs=0, one attempt", async (_l, err, kind) => {
    neverStarts(err);
    const run = vi.fn(async () => "never");
    const thrown = await liveWriterTransaction("admin-create", run).catch((e) => e);
    expect(thrown).toBeInstanceOf(LiveWriterBusyError);
    expect(thrown.kind).toBe(kind);
    expect(thrown.cause).toBe(err);
    expect(run).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(lines()[0]).toMatch(
      new RegExp(`^\\[liveWriter\\] failed route=admin-create kind=${kind} err=Error:`),
    );
    expect(lines()[1]).toMatch(/ execMs=0 rev=- ok=false /);
  });

  it("a failure after the callback ran is rethrown as is, never busy — even one that looks like a pool error", async () => {
    const expired = Object.assign(
      new Error("Transaction API error: A query cannot be executed on an expired transaction."),
      { code: "P2028" },
    );
    enters(expired);
    await expect(liveWriterTransaction("admin-create", async () => 1)).rejects.toBe(expired);
    expect(liveWriterBusyResponse(expired, "admin")).toBeNull();

    const odd = acquireTimeout();
    enters(odd);
    await expect(liveWriterTransaction("admin-create", async () => 1)).rejects.toBe(odd);
    expect(liveWriterBusyResponse(odd, "admin")).toBeNull();
    expect(lines().filter((l) => l.startsWith("[liveWriter] failed "))).toEqual([
      expect.stringContaining(" kind=other "),
      expect.stringContaining(" kind=other "),
    ]);
  });
});

describe("liveWriterBusyResponse", () => {
  it("admin: 503, Retry-After 2, no-store, Korean operator message + code", async () => {
    const res = liveWriterBusyResponse(
      new LiveWriterBusyError("pooler_cap", "admin-create", emaxconn()),
      "admin",
    )!;
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("2");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: ADMIN_DB_BUSY_MESSAGE, code: "db_busy" });
  });

  it("public: stable code only, no text", async () => {
    const res = liveWriterBusyResponse(
      new LiveWriterBusyError("tx_max_wait", "public-add-item", maxWait()),
      "public",
    )!;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "db_busy" });
  });

  it("a raw pool / pooler failure from a plain statement is busy; a raw P2028 is not", () => {
    expect(liveWriterBusyResponse(acquireTimeout(), "public")?.status).toBe(503);
    expect(liveWriterBusyResponse(emaxconn(), "public")?.status).toBe(503);
    // Only trusted through liveWriterTransaction, which knows whether
    // the callback ran.
    expect(liveWriterBusyResponse(maxWait(), "public")).toBeNull();
    expect(liveWriterBusyResponse(new Error("boom"), "public")).toBeNull();
  });
});

describe("withAdminLiveWriterBusy", () => {
  it("passes results and non-busy errors through, turns busy errors into 503", async () => {
    const ok = await withAdminLiveWriterBusy(async () => new Response("3"));
    expect(await ok.text()).toBe("3");

    const busy = await withAdminLiveWriterBusy(async () => {
      throw acquireTimeout();
    });
    expect(busy.status).toBe(503);

    await expect(
      withAdminLiveWriterBusy(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
