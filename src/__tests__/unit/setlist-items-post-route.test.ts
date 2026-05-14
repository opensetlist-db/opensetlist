import { describe, it, expect, vi, beforeEach } from "vitest";

// `LAUNCH_FLAGS` is `as const`, so vi.mock has to fake the whole module
// for the per-test flag flip. The route reads `LAUNCH_FLAGS.addItemEnabled`
// at call time, so changing the mock between tests is enough — no module
// re-import needed.
vi.mock("@/lib/launchFlags", () => ({
  // Object typed as `{ ...: boolean }` (not literal `true`/`false`)
  // so the test can flip `addItemEnabled` between cases without
  // tripping TS's literal-type narrowing.
  LAUNCH_FLAGS: {
    showSignIn: false as boolean,
    showSearch: false as boolean,
    confirmDbEnabled: false as boolean,
    addItemEnabled: true as boolean,
  },
}));

// `Prisma` namespace (PrismaClientKnownRequestError) must be the real
// import so `err instanceof Prisma.PrismaClientKnownRequestError` works
// in the route's catch branch. We only fake the actual client methods.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findFirst: vi.fn() },
    song: { findFirst: vi.fn() },
    setlistItem: { findMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { POST } from "@/app/api/events/[id]/setlist-items/route";
import { prisma } from "@/lib/prisma";
import { LAUNCH_FLAGS } from "@/lib/launchFlags";
import { Prisma } from "@/generated/prisma/client";

function postRequest(eventId: string, body: unknown) {
  return new Request(`http://localhost/api/events/${eventId}/setlist-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params1 = Promise.resolve({ id: "1" });

// Default mock fixtures — an ongoing event with one host performer.
function setupHappyPath() {
  (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: BigInt(1),
    status: "ongoing",
    startTime: new Date("2026-05-13T00:00:00Z"),
    performers: [{ stageIdentityId: "si-host-1" }],
  });
  (prisma.song.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: BigInt(42),
    artists: [
      { artistId: BigInt(100), artist: { type: "group" } },
    ],
  });
  // `$transaction(callback)` invokes the callback with a tx client whose
  // method shapes match the prisma mock above. We delegate straight back
  // to the same mocks so per-test assertions read consistent state.
  (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma),
  );
  (prisma.setlistItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
    { position: 5 },
    { position: 7 },
    { position: 3 },
  ]);
  (prisma.setlistItem.create as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: BigInt(900),
    position: 8,
    isEncore: false,
    stageType: "full_group",
    status: "rumoured",
    type: "song",
    songs: [],
    performers: [],
    artists: [],
  });
}

// LAUNCH_FLAGS is `as const` on the source side, so TypeScript marks
// every property readonly AND narrows each value to a literal type
// (e.g. `false`). The mock module above returns a fresh plain object,
// so mutating it at runtime works — but the import sees the source's
// readonly + literal narrowed type. Cast to a writable-boolean shape
// at the assignment sites so the test can flip flags between cases
// without tripping either constraint.
type WritableFlags = { -readonly [K in keyof typeof LAUNCH_FLAGS]: boolean };
const mutableFlags = LAUNCH_FLAGS as unknown as WritableFlags;

describe("POST /api/events/[id]/setlist-items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
    mutableFlags.addItemEnabled = true;
  });

  it("returns 403 with feature_flag_disabled when LAUNCH_FLAGS.addItemEnabled is false", async () => {
    mutableFlags.addItemEnabled = false;
    const res = await POST(
      postRequest("1", {
        itemType: "song",
        songId: 42,
        performerIds: [],
        isEncore: false,
      }) as never,
      { params: params1 },
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "feature_flag_disabled" });
    // Critically: NO Prisma calls when flag is off — guards against
    // accidental DB queries from a flag-gated endpoint.
    expect(prisma.event.findFirst).not.toHaveBeenCalled();
  });

  it("returns 400 when event status is not 'ongoing' (defense in depth — client gate alone is forgeable)", async () => {
    (prisma.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(1),
      status: "completed",
      startTime: new Date("2026-01-01T00:00:00Z"),
      performers: [],
    });
    const res = await POST(
      postRequest("1", {
        itemType: "song",
        songId: 42,
        performerIds: [],
        isEncore: false,
      }) as never,
      { params: params1 },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("event_not_ongoing");
  });

  it("returns 400 when itemType=song but songId is missing", async () => {
    const res = await POST(
      postRequest("1", {
        itemType: "song",
        performerIds: [],
        isEncore: false,
      }) as never,
      { params: params1 },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/songId/);
  });

  it("accepts a decimal-string songId (BigInt IDs > 2^53-1 round-tripped as JSON strings)", async () => {
    // Number.MAX_SAFE_INTEGER is 2^53-1. BigInt IDs that exceed
    // that lose precision through `JSON.parse` if sent as numbers;
    // clients that serialise via String(bigint) need the string
    // form to land cleanly. Validates the BigInt(rawSongId) branch
    // for the string case.
    const res = await POST(
      postRequest("1", {
        itemType: "song",
        songId: "42",
        performerIds: ["si-host-1"],
        isEncore: false,
      }) as never,
      { params: params1 },
    );
    expect(res.status).toBe(201);
    // Song lookup must have happened with BigInt(42).
    expect(prisma.song.findFirst).toHaveBeenCalledWith({
      where: { id: BigInt(42), isDeleted: false },
      select: expect.anything(),
    });
  });

  it("returns 400 when songId is an unsafe-integer number (would lose precision via BigInt)", async () => {
    // A number above Number.MAX_SAFE_INTEGER (2^53-1) silently rounds
    // when JSON-parsed; we reject those rather than convert and look
    // up a slightly-different DB row.
    const res = await POST(
      postRequest("1", {
        itemType: "song",
        songId: Number.MAX_SAFE_INTEGER + 100, // unsafe
        performerIds: ["si-host-1"],
        isEncore: false,
      }) as never,
      { params: params1 },
    );
    expect(res.status).toBe(400);
    expect(prisma.song.findFirst).not.toHaveBeenCalled();
  });

  it("returns 400 when songId is a non-digit string", async () => {
    const res = await POST(
      postRequest("1", {
        itemType: "song",
        songId: "abc",
        performerIds: ["si-host-1"],
        isEncore: false,
      }) as never,
      { params: params1 },
    );
    expect(res.status).toBe(400);
    expect(prisma.song.findFirst).not.toHaveBeenCalled();
  });

  it("returns 400 when performerIds contains duplicate stageIdentityIds (avoids opaque P2002)", async () => {
    // A duplicate stageIdentityId would otherwise trip the
    // SetlistItemMember composite unique [setlistItemId,
    // stageIdentityId] at create time and surface as a non-position
    // P2002 (500 internal_error). Catching dup input upfront turns
    // the same client mistake into a clear 400.
    const res = await POST(
      postRequest("1", {
        itemType: "song",
        songId: 42,
        performerIds: ["si-host-1", "si-host-1"],
        isEncore: false,
      }) as never,
      { params: params1 },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unique/);
    expect(prisma.song.findFirst).not.toHaveBeenCalled();
  });

  it("returns 400 when performerIds includes a stageIdentity not in event.performers", async () => {
    const res = await POST(
      postRequest("1", {
        itemType: "song",
        songId: 42,
        performerIds: ["si-stranger-not-in-event"],
        isEncore: false,
      }) as never,
      { params: params1 },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("performer_not_in_event");
  });

  it("creates row at MAX(position)+1 ignoring soft-deleted rows", async () => {
    await POST(
      postRequest("1", {
        itemType: "song",
        songId: 42,
        performerIds: ["si-host-1"],
        isEncore: false,
      }) as never,
      { params: params1 },
    );
    // findMany must filter by `isDeleted: false` — verifies the
    // position calc uses only the active set (partial unique index
    // semantics).
    expect(prisma.setlistItem.findMany).toHaveBeenCalledWith({
      where: { eventId: BigInt(1), isDeleted: false },
      select: { position: true },
    });
    // Three rows with positions 3, 5, 7 → nextPosition is 8.
    expect(prisma.setlistItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ position: 8 }),
      }),
    );
  });

  it("forces status='rumoured' on the created row (override default 'confirmed')", async () => {
    await POST(
      postRequest("1", {
        itemType: "song",
        songId: 42,
        performerIds: ["si-host-1"],
        isEncore: false,
      }) as never,
      { params: params1 },
    );
    expect(prisma.setlistItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "rumoured" }),
      }),
    );
  });

  it("creates performers via the `performers` key (NOT `members` — guards the spec-naming bug)", async () => {
    // The task spec pseudocode used `members:` but the actual Prisma
    // relation is `performers` (schema.prisma:552). This assertion
    // pins the correct key so a future refactor regression surfaces
    // here instead of as a Prisma type error at build time (which
    // is also caught, but a green-test signal is faster).
    await POST(
      postRequest("1", {
        itemType: "song",
        songId: 42,
        performerIds: ["si-host-1"],
        isEncore: false,
      }) as never,
      { params: params1 },
    );
    const createCall = (
      prisma.setlistItem.create as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(createCall.data).toHaveProperty("performers");
    expect(createCall.data).not.toHaveProperty("members");
    expect(createCall.data.performers).toEqual({
      create: [{ stageIdentityId: "si-host-1" }],
    });
  });

  it("MC type creates no performers and no songs", async () => {
    await POST(
      postRequest("1", {
        itemType: "mc",
        performerIds: ["si-host-1"], // sent but ignored for MC per spec
        isEncore: false,
      }) as never,
      { params: params1 },
    );
    const createCall = (
      prisma.setlistItem.create as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(createCall.data.type).toBe("mc");
    expect(createCall.data.songs).toBeUndefined();
    expect(createCall.data.performers).toBeUndefined();
    // MC stageType resolves to 'special' per deriveStageType rules.
    expect(createCall.data.stageType).toBe("special");
    // Song lookup is skipped for non-song types.
    expect(prisma.song.findFirst).not.toHaveBeenCalled();
  });

  it("recomputes stageType server-side from DB SongArtist+Artist.type (doesn't trust client)", async () => {
    // Song with a single unit-type credit → stageType MUST be 'unit'
    // regardless of what the client might claim. The route's body
    // schema doesn't accept stageType at all — this is the defensive
    // recomputation lane.
    (prisma.song.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(42),
      artists: [{ artistId: BigInt(7), artist: { type: "unit" } }],
    });
    await POST(
      postRequest("1", {
        itemType: "song",
        songId: 42,
        performerIds: ["si-host-1"],
        isEncore: false,
      }) as never,
      { params: params1 },
    );
    expect(prisma.setlistItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stageType: "unit" }),
      }),
    );
  });

  it("retries on Prisma P2002 position conflict (partial unique index race)", async () => {
    // Simulate a race: first attempt's create throws P2002, second
    // attempt's create succeeds. Route's retry loop should iterate
    // and the final response is 201 — opaque to the client that a
    // retry happened.
    const raceError = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test", meta: { target: ["eventId", "position"] } },
    );
    const createMock = prisma.setlistItem.create as ReturnType<typeof vi.fn>;
    createMock
      .mockRejectedValueOnce(raceError)
      .mockResolvedValueOnce({
        id: BigInt(901),
        position: 9, // second attempt's recomputed position
        isEncore: false,
        stageType: "full_group",
        status: "rumoured",
        type: "song",
        songs: [],
        performers: [],
        artists: [],
      });

    const res = await POST(
      postRequest("1", {
        itemType: "song",
        songId: 42,
        performerIds: ["si-host-1"],
        isEncore: false,
      }) as never,
      { params: params1 },
    );
    expect(res.status).toBe(201);
    // Two create attempts: first (P2002) + second (success).
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces 409 after exhausting position-conflict retries", async () => {
    const raceError = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test", meta: { target: ["eventId", "position"] } },
    );
    (prisma.setlistItem.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      raceError,
    );
    const res = await POST(
      postRequest("1", {
        itemType: "song",
        songId: 42,
        performerIds: ["si-host-1"],
        isEncore: false,
      }) as never,
      { params: params1 },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "position_conflict" });
  });

  it("returns 500 (NOT 409) on a P2002 against a non-position unique constraint", async () => {
    // The retry loop's `isPositionRace` filter discriminates on the
    // target substring "position". Anything else (e.g. a
    // SetlistItemMember composite-unique violation if a future
    // client bug submits duplicate performerIds) breaks out of the
    // loop on the first attempt and must NOT be surfaced as
    // "position_conflict" — that would be a misleading error message.
    // CR PR #360 caught the post-loop check being too broad.
    const nonPositionError = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on SetlistItemMember",
      {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["setlistItemId", "stageIdentityId"] },
      },
    );
    (prisma.setlistItem.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      nonPositionError,
    );
    const res = await POST(
      postRequest("1", {
        itemType: "song",
        songId: 42,
        performerIds: ["si-host-1"],
        isEncore: false,
      }) as never,
      { params: params1 },
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "internal_error" });
  });
});
