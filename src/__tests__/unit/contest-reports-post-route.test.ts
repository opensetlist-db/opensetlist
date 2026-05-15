import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/launchFlags", () => ({
  LAUNCH_FLAGS: {
    showSignIn: false as boolean,
    showSearch: false as boolean,
    confirmDbEnabled: false as boolean,
    addItemEnabled: false as boolean,
    contestReportEnabled: true as boolean,
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    setlistItem: { findFirst: vi.fn() },
    song: { findFirst: vi.fn() },
    eventPerformer: { findMany: vi.fn() },
    contestReport: { create: vi.fn() },
  },
}));

import { POST } from "@/app/api/setlist-items/[id]/contests/route";
import { prisma } from "@/lib/prisma";
import { LAUNCH_FLAGS } from "@/lib/launchFlags";

type WritableFlags = {
  -readonly [K in keyof typeof LAUNCH_FLAGS]: boolean;
};
const mutableFlags = LAUNCH_FLAGS as unknown as WritableFlags;

const params42 = Promise.resolve({ id: "42" });

function postRequest(body: unknown) {
  return new Request("http://localhost/api/setlist-items/42/contests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/setlist-items/[id]/contests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutableFlags.contestReportEnabled = true;
    (prisma.setlistItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(42),
      eventId: BigInt(1),
    });
    (prisma.song.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(100),
      baseVersionId: null,
    });
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      { stageIdentityId: "si-1" },
      { stageIdentityId: "si-2" },
    ]);
    (prisma.contestReport.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "report-uuid-1",
      type: "wrong_song",
      status: "pending",
      createdAt: new Date("2026-05-14T12:00:00Z"),
    });
  });

  it("returns 403 when flag is off", async () => {
    mutableFlags.contestReportEnabled = false;
    const res = await POST(
      postRequest({ type: "wrong_song", payload: { proposedSongId: 100 } }) as never,
      { params: params42 },
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "feature_flag_disabled" });
    expect(prisma.setlistItem.findFirst).not.toHaveBeenCalled();
  });

  it("returns 404 when SetlistItem missing", async () => {
    (prisma.setlistItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(
      postRequest({ type: "wrong_song", payload: { proposedSongId: 100 } }) as never,
      { params: params42 },
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("setlist_item_not_found");
  });

  it("returns 400 on bad type", async () => {
    const res = await POST(
      postRequest({ type: "garbage", payload: {} }) as never,
      { params: params42 },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when wrong_song missing proposedSongId", async () => {
    const res = await POST(
      postRequest({ type: "wrong_song", payload: {} }) as never,
      { params: params42 },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when wrong_song target Song doesn't exist", async () => {
    (prisma.song.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(
      postRequest({ type: "wrong_song", payload: { proposedSongId: 999 } }) as never,
      { params: params42 },
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("song_not_found");
  });

  it("returns 400 when missing_performer references non-event stageIdentity", async () => {
    const res = await POST(
      postRequest({
        type: "missing_performer",
        payload: { stageIdentityIds: ["si-stranger"] },
      }) as never,
      { params: params42 },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("performer_not_in_event");
  });

  it("returns 400 when other type lacks a comment", async () => {
    const res = await POST(
      postRequest({ type: "other", payload: {} }) as never,
      { params: params42 },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when comment exceeds 500 chars", async () => {
    const res = await POST(
      postRequest({
        type: "other",
        payload: {},
        comment: "x".repeat(501),
      }) as never,
      { params: params42 },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when wrong_variant.proposedVariantId is not a variant of proposedSongId", async () => {
    // First call (proposedSongId lookup): returns the base.
    // Second call (proposedVariantId lookup): returns a row whose
    // baseVersionId is something DIFFERENT from proposedSongId.
    (prisma.song.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: BigInt(100), baseVersionId: null })
      .mockResolvedValueOnce({ id: BigInt(200), baseVersionId: BigInt(999) });
    const res = await POST(
      postRequest({
        type: "wrong_variant",
        payload: { proposedSongId: 100, proposedVariantId: 200 },
      }) as never,
      { params: params42 },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/variant/);
  });

  it("creates ContestReport on happy path with all fields", async () => {
    const res = await POST(
      postRequest({
        type: "missing_performer",
        payload: { stageIdentityIds: ["si-1"] },
        comment: "Was definitely there",
      }) as never,
      { params: params42 },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.report.id).toBe("report-uuid-1");
    expect(prisma.contestReport.create).toHaveBeenCalledWith({
      data: {
        setlistItemId: BigInt(42),
        type: "missing_performer",
        payload: { stageIdentityIds: ["si-1"] },
        comment: "Was definitely there",
      },
      select: expect.any(Object),
    });
  });
});
