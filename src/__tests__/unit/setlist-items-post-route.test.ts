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
//
// Conflict-handling extension added:
//   - setlistItem.findFirst    — occupant check (Gate 4.5) +
//                                exact-position dedup check (Gate 6.5)
//   - setlistItemConfirm.create — auto-merge path writes here when
//                                dedup detects same-position-same-song
vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findFirst: vi.fn() },
    song: { findFirst: vi.fn() },
    setlistItem: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    setlistItemConfirm: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { POST } from "@/app/api/events/[id]/setlist-items/route";
import { prisma } from "@/lib/prisma";
import { LAUNCH_FLAGS } from "@/lib/launchFlags";
import { Prisma } from "@/generated/prisma/client";

// `position` is now a required body field (conflict-handling PR). The
// helper auto-fills it with a default when the test body doesn't
// specify, so existing pre-conflict-handling tests stay readable —
// they're verifying flag / event-status / song-validation behavior
// where the exact position value doesn't matter. Tests that
// specifically exercise the position flow can pass an explicit
// `position` in their body override.
const DEFAULT_TEST_POSITION = 8;
function postRequest(eventId: string, body: Record<string, unknown>) {
  const withPosition =
    "position" in body ? body : { ...body, position: DEFAULT_TEST_POSITION };
  return new Request(`http://localhost/api/events/${eventId}/setlist-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(withPosition),
  });
}

const params1 = Promise.resolve({ id: "1" });

// Default mock fixtures — an ongoing event with one host performer.
// Happy path returns: no occupant at target position, no dedup match,
// create succeeds.
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
  // findFirst is used for BOTH the occupant gate (Gate 4.5) and the
  // exact-position dedup (Gate 6.5). Happy path: both return null →
  // create path proceeds.
  (prisma.setlistItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
    null,
  );
  // `$transaction(callback)` invokes the callback with a tx client whose
  // method shapes match the prisma mock above. We delegate straight back
  // to the same mocks so per-test assertions read consistent state.
  (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma),
  );
  (prisma.setlistItem.create as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: BigInt(900),
    position: 8,
    isEncore: false,
    stageType: "full_group",
    status: "rumoured",
    type: "song",
    _count: { confirms: 0 },
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

  it("creates row at the client-supplied position (conflict-handling: client owns position)", async () => {
    // Conflict-handling PR flipped position computation from server
    // (`nextSetlistPosition(items)`) to client (sent in body). Server
    // now writes whatever the client supplied — verified via the
    // create call's `position` field. This is the core mechanism
    // that closes the race-loss-misplacement bug.
    await POST(
      postRequest("1", {
        itemType: "song",
        songId: 42,
        performerIds: ["si-host-1"],
        isEncore: false,
        position: 17,
      }) as never,
      { params: params1 },
    );
    expect(prisma.setlistItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ position: 17 }),
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
        _count: { confirms: 0 },
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

// ───── Conflict-handling specific scenarios ─────

describe("POST /api/events/[id]/setlist-items — conflict handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
    mutableFlags.addItemEnabled = true;
  });

  it("returns 400 position_already_confirmed when target position has a confirmed row", async () => {
    // Gate 4.5 — partial unique negation index permits multiple
    // rumoured rows at one position, but only one non-rumoured.
    // If the user targets a position already owned by
    // confirmed/live, reject upfront (the follow-up ContestReport PR
    // adds the proper queue-based path for those).
    (prisma.setlistItem.findFirst as ReturnType<typeof vi.fn>).mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        // The occupant check filters on `status: { not: "rumoured" }`.
        if (
          (where.status as { not?: string })?.not === "rumoured"
        ) {
          return Promise.resolve({ id: BigInt(999) });
        }
        return Promise.resolve(null);
      },
    );
    const res = await POST(
      postRequest("1", {
        itemType: "song",
        songId: 42,
        performerIds: ["si-host-1"],
        isEncore: false,
        position: 5,
      }) as never,
      { params: params1 },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "position_already_confirmed" });
    // No create call should have happened — Gate 4.5 short-circuits.
    expect(prisma.setlistItem.create).not.toHaveBeenCalled();
  });

  it("same-position same-song within window → auto-confirm-merge (no INSERT, writes SetlistItemConfirm)", async () => {
    // Gate 6.5 — exact-position dedup. Two users independently
    // submitting the same song at the same position is a stronger
    // correctness signal than counting upvotes; collapse into one
    // row + bump confirmCount via a SetlistItemConfirm write.
    (prisma.setlistItem.findFirst as ReturnType<typeof vi.fn>).mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        // Occupant check (looking for non-rumoured): null
        if ((where.status as { not?: string })?.not === "rumoured") {
          return Promise.resolve(null);
        }
        // Dedup check (looking for rumoured + same song): hit
        if (where.status === "rumoured") {
          return Promise.resolve({ id: BigInt(888) });
        }
        return Promise.resolve(null);
      },
    );
    // The auto-merge path then calls findUnique for the merged row.
    // The route's response flattens `_count.confirms` → `confirmCount`
    // before serialisation, so the mock must include `_count`.
    (prisma.setlistItem.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(888),
      position: 5,
      status: "rumoured",
      _count: { confirms: 1 },
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
        position: 5,
      }) as never,
      { params: params1 },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.action).toBe("auto-confirm-merge");
    // Confirms-only write — no new SetlistItem created
    expect(prisma.setlistItemConfirm.create).toHaveBeenCalledWith({
      data: { setlistItemId: BigInt(888) },
    });
    expect(prisma.setlistItem.create).not.toHaveBeenCalled();
  });

  it("same-position different-song → INSERTs as rumoured sibling (no merge)", async () => {
    // Negation index permits multiple rumoured rows at the same
    // position. The dedup check (Gate 6.5) only triggers for SAME
    // song; a different song at the same position falls through to
    // the normal INSERT path, creating a conflict-group sibling.
    (prisma.setlistItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(
      postRequest("1", {
        itemType: "song",
        songId: 42,
        performerIds: ["si-host-1"],
        isEncore: false,
        position: 5,
      }) as never,
      { params: params1 },
    );
    expect(res.status).toBe(201);
    expect(prisma.setlistItem.create).toHaveBeenCalledTimes(1);
    expect(prisma.setlistItemConfirm.create).not.toHaveBeenCalled();
  });

  it("returns 400 when position is missing", async () => {
    const res = await POST(
      postRequest("1", {
        itemType: "song",
        songId: 42,
        performerIds: ["si-host-1"],
        isEncore: false,
        // explicitly omit position (postRequest helper would inject
        // a default; bypass by stringifying without it)
        position: undefined,
      }) as never,
      { params: params1 },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/position/);
  });

  it("returns 400 when position is zero or negative", async () => {
    for (const bad of [0, -1, -100]) {
      const res = await POST(
        postRequest("1", {
          itemType: "song",
          songId: 42,
          performerIds: ["si-host-1"],
          isEncore: false,
          position: bad,
        }) as never,
        { params: params1 },
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/position/);
    }
  });

  it("returns 400 when position is non-integer", async () => {
    const res = await POST(
      postRequest("1", {
        itemType: "song",
        songId: 42,
        performerIds: ["si-host-1"],
        isEncore: false,
        position: 1.5,
      }) as never,
      { params: params1 },
    );
    expect(res.status).toBe(400);
  });
});
