import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/launchFlags", () => ({
  LAUNCH_FLAGS: {
    showSignIn: false as boolean,
    showSearch: false as boolean,
    confirmDbEnabled: true as boolean, // promotion path requires this
    addItemEnabled: false as boolean,
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    setlistItem: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    setlistItemConfirm: { create: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// The writer-transaction helpers are mocked: these tests pin the
// route's control flow (when it locks / bumps), the SQL itself is
// covered by the dev-DB integration suite.
vi.mock("@/lib/liveBroadcast", () => ({
  lockEvent: vi.fn(),
  bumpSetlistRevisionAndBroadcast: vi.fn(),
}));

import { POST } from "@/app/api/setlist-items/[id]/confirm/route";
import { prisma } from "@/lib/prisma";
import {
  bumpSetlistRevisionAndBroadcast,
  lockEvent,
} from "@/lib/liveBroadcast";

const params42 = Promise.resolve({ id: "42" });

function postRequest() {
  return new Request("http://localhost/api/setlist-items/42/confirm", {
    method: "POST",
  });
}

describe("POST /api/setlist-items/[id]/confirm — conflict-handling promotion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: rumoured target row, threshold not yet reached, no
    // siblings. Tests below override per-scenario.
    (prisma.setlistItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(42),
      eventId: BigInt(1),
      position: 5,
      status: "rumoured",
    });
    (prisma.setlistItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.setlistItemConfirm.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.setlistItemConfirm.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    // Interactive transaction (n14): run the callback against the same
    // mock client so per-test assertions see one consistent state.
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma),
    );
    (prisma.setlistItem.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
    });
    vi.mocked(lockEvent).mockResolvedValue(true);
    vi.mocked(bumpSetlistRevisionAndBroadcast).mockResolvedValue(BigInt(1));
  });

  it("threshold NOT reached + has siblings → just writes confirm row, no promotion", async () => {
    (prisma.setlistItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: BigInt(43) },
      { id: BigInt(44) },
    ]);
    (prisma.setlistItemConfirm.count as ReturnType<typeof vi.fn>).mockResolvedValue(2); // < 3
    const res = await POST(postRequest(), { params: params42 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(prisma.setlistItemConfirm.create).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("threshold reached + NO siblings → just writes confirm row, no promotion", async () => {
    // Non-contested row reaching threshold is NOT promoted to confirmed
    // — the existing 60s auto-promote handles single-row "settled"
    // semantics at render time. DB-level promotion is reserved for
    // conflict resolution (to auto-hide losers, which requires DB
    // mutation).
    (prisma.setlistItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.setlistItemConfirm.count as ReturnType<typeof vi.fn>).mockResolvedValue(3); // >= threshold
    const res = await POST(postRequest(), { params: params42 });
    expect(res.status).toBe(200);
    expect(prisma.setlistItemConfirm.create).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("threshold reached + has siblings → promotion transaction fires (promoted: true)", async () => {
    (prisma.setlistItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: BigInt(43) },
      { id: BigInt(44) },
    ]);
    (prisma.setlistItemConfirm.count as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    const res = await POST(postRequest(), { params: params42 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, promoted: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("promotion transaction order is load-bearing: siblings hidden BEFORE winner promoted", async () => {
    // If the order were reversed, the intermediate state would have
    // two `status != 'rumoured'` rows at the same position, tripping
    // the negation partial-unique index. Verify via the order of
    // operations passed to $transaction.
    (prisma.setlistItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: BigInt(43) },
    ]);
    (prisma.setlistItemConfirm.count as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    // We can't directly inspect the operations inside the array
    // because Prisma's updateMany returns a "pending operation"
    // proxy. Instead, capture the call into a sentinel via
    // mockImplementation.
    const calls: string[] = [];
    (prisma.setlistItem.updateMany as ReturnType<typeof vi.fn>).mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        if (data.isDeleted === true) calls.push("hide-siblings");
        else if (data.status === "confirmed") calls.push("promote-winner");
        return Promise.resolve({ count: 1 });
      },
    );
    await POST(postRequest(), { params: params42 });
    expect(calls).toEqual(["hide-siblings", "promote-winner"]);
  });

  it("promotion locks the event first and bumps the revision once (n14)", async () => {
    (prisma.setlistItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: BigInt(43) },
    ]);
    (prisma.setlistItemConfirm.count as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    const order: string[] = [];
    vi.mocked(lockEvent).mockImplementation(async () => {
      order.push("lock");
      return true;
    });
    (prisma.setlistItem.updateMany as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        order.push("update");
        return { count: 1 };
      },
    );
    vi.mocked(bumpSetlistRevisionAndBroadcast).mockImplementation(async () => {
      order.push("bump");
      return BigInt(7);
    });
    await POST(postRequest(), { params: params42 });
    expect(order).toEqual(["lock", "update", "update", "bump"]);
    expect(lockEvent).toHaveBeenCalledWith(prisma, BigInt(1));
    expect(bumpSetlistRevisionAndBroadcast).toHaveBeenCalledWith(prisma, BigInt(1));
  });

  it("a promotion that matched no rows (raced) does not bump", async () => {
    (prisma.setlistItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: BigInt(43) },
    ]);
    (prisma.setlistItemConfirm.count as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    (prisma.setlistItem.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 0,
    });
    await POST(postRequest(), { params: params42 });
    expect(bumpSetlistRevisionAndBroadcast).not.toHaveBeenCalled();
  });

  it("a plain confirm (no promotion) never bumps", async () => {
    (prisma.setlistItemConfirm.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    await POST(postRequest(), { params: params42 });
    expect(lockEvent).not.toHaveBeenCalled();
    expect(bumpSetlistRevisionAndBroadcast).not.toHaveBeenCalled();
  });

  it("winner update uses `where: { status: 'rumoured' }` for idempotency", async () => {
    // Two confirm POSTs racing past the threshold both run the
    // promotion transaction. The second one finds the winner already
    // `confirmed` — the `where: { status: 'rumoured' }` filter on
    // updateMany ensures it's a no-op rather than a re-promote or
    // a P2002.
    (prisma.setlistItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: BigInt(43) },
    ]);
    (prisma.setlistItemConfirm.count as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    const updateManySpy = prisma.setlistItem.updateMany as ReturnType<typeof vi.fn>;
    updateManySpy.mockResolvedValue({ count: 1 });
    await POST(postRequest(), { params: params42 });
    // Find the call that's the winner-promote — its where should
    // include status='rumoured'.
    const winnerCall = updateManySpy.mock.calls.find((call) => {
      const arg = call[0] as { data?: Record<string, unknown> };
      return arg.data?.status === "confirmed";
    });
    expect(winnerCall).toBeDefined();
    expect(winnerCall![0]).toEqual({
      where: { id: BigInt(42), status: "rumoured", isDeleted: false },
      data: { status: "confirmed" },
    });
  });

  it("does NOT attempt promotion when parent row is already 'confirmed'", async () => {
    // Operator-confirmed rows shouldn't reach the promotion path —
    // confirmCount on a confirmed row has no resolution semantics.
    (prisma.setlistItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(42),
      eventId: BigInt(1),
      position: 5,
      status: "confirmed",
    });
    (prisma.setlistItemConfirm.count as ReturnType<typeof vi.fn>).mockResolvedValue(100);
    await POST(postRequest(), { params: params42 });
    expect(prisma.setlistItem.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("busy database on the confirm write → 503 db_busy (nothing written), no i18n text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    (prisma.setlistItemConfirm.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("timeout exceeded when trying to connect"),
    );
    const res = await POST(postRequest(), { params: params42 });
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("2");
    expect(await res.json()).toEqual({ ok: false, error: "db_busy" });
  });

  it("busy database on the promotion → still 200: the confirm row is already committed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    (prisma.setlistItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: BigInt(43) },
    ]);
    (prisma.setlistItemConfirm.count as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(
        new Error("Transaction API error: Unable to start a transaction in the given time."),
        { code: "P2028" },
      ),
    );
    const res = await POST(postRequest(), { params: params42 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
