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

import { POST } from "@/app/api/setlist-items/[id]/confirm/route";
import { prisma } from "@/lib/prisma";

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
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockResolvedValue([]);
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
    // $transaction(array) — replay each call sequentially so the
    // mockImplementation above fires in order
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (ops: Promise<unknown>[]) => Promise.all(ops),
    );

    await POST(postRequest(), { params: params42 });
    expect(calls).toEqual(["hide-siblings", "promote-winner"]);
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
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (ops: Promise<unknown>[]) => Promise.all(ops),
    );
    await POST(postRequest(), { params: params42 });
    // Find the call that's the winner-promote — its where should
    // include status='rumoured'.
    const winnerCall = updateManySpy.mock.calls.find((call) => {
      const arg = call[0] as { data?: Record<string, unknown> };
      return arg.data?.status === "confirmed";
    });
    expect(winnerCall).toBeDefined();
    expect(winnerCall![0]).toEqual({
      where: { id: BigInt(42), status: "rumoured" },
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
});
