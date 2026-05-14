import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { LAUNCH_FLAGS } from "@/lib/launchFlags";
import { nextSetlistPosition } from "@/lib/setlist-position";
import { getEventStatus } from "@/lib/eventStatus";
import { deriveStageType, type ItemType } from "@/lib/setlistStageType";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * POST /api/events/[id]/setlist-items
 *
 *   Body: {
 *     itemType: "song" | "mc" | "video" | "interval",
 *     songId?: number,           // required when itemType === 'song';
 *                                // the variant's Song.id (variants are
 *                                // separate rows linked via baseVersionId)
 *     performerIds: string[],    // stageIdentityId[]; ignored for non-song
 *     isEncore: boolean,
 *   }
 *
 *   → 201 { ok: true, item: SerializedSetlistItem }   (success)
 *   → 403 { ok: false, error: "feature_flag_disabled" }
 *   → 400 { ok: false, error: <validation> }
 *   → 404 { ok: false, error: "event_not_found" | "song_not_found" }
 *   → 409 { ok: false, error: "position_conflict" }   (after 3 retries)
 *
 * Backs the Phase 1C `<AddItemBottomSheet>` — user-submitted setlist
 * rows. Mirrors the admin `insert-after` endpoint
 * (`src/app/api/admin/setlist-items/insert-after/route.ts`) but:
 *
 *   - Always appends at the end (`nextSetlistPosition`); users can't
 *     mid-list-insert at 1C. Operator retains that capability via the
 *     admin route.
 *   - Forces `status: 'rumoured'` (the default is `confirmed` — admin
 *     rows ship live-trusted; user rows always start unconfirmed and
 *     promote via the existing Confirm flow / 1-min auto-promote).
 *   - Recomputes `stageType` server-side from the song's actual
 *     `SongArtist` rows; client-passed stageType is ignored. Prevents
 *     tampering and drift between the client's loaded songArtists
 *     and the DB.
 *   - Accepts `performers` as an explicit, user-edited list — admin
 *     route auto-fills from event.performers. The user has already
 *     edited the checklist (auto-fill happens client-side via
 *     `deriveStageType` + the unit-current-members endpoint), so the
 *     server takes the list as-is after validating it's a subset of
 *     event.performers.
 *
 * Path param is `[id]` (not `[eventId]`) because the parent dynamic
 * segment is already `[id]` (see `src/app/api/events/[id]/wishes/`)
 * and Next.js disallows different slug names at the same depth.
 * Body field `eventId` would be redundant — the path carries it.
 *
 * Returns JSON 4xx for ALL failure modes (no Next.js HTML 500 page).
 * The bottom sheet's `await res.json()` parse path stays predictable;
 * the matching pattern to /api/songs/search (the same component
 * family) and /api/setlist-items/[id]/confirm.
 *
 * Realtime: no endpoint-side push code. Supabase Realtime
 * (`postgres_changes` on `SetlistItem` with `eventId` filter,
 * shipped v0.11.0) broadcasts the INSERT automatically; subscribed
 * viewers see the new row within ~1s.
 *
 * Conflict handling (duplicate-detect, parallel candidates) is a
 * SEPARATE task (`task-week3-conflict-handling.md`, Stage 3) that
 * layers on top of this endpoint. Out of scope here.
 *
 * Authentication NOTE: this endpoint is INTENTIONALLY unauthenticated
 * at Phase 1C, matching every other write-side fan-facing endpoint in
 * the project: `POST /api/events/[id]/wishes` (wishlist),
 * `POST /api/setlist-items/[id]/confirm` (Confirm UI), and reactions.
 * Per `wiki/conflicts.md #9` (schema-simplification decision), Phase 1C
 * fan writes carry no anonId / userId / sourceUrl — the localStorage
 * gate is the only per-viewer check, and dedup-on-write is the
 * separate Stage-3 conflict-handling task. NextAuth ships in Phase 2
 * alongside the trust-tier system; THIS endpoint adopts session-based
 * auth then, NOT at 1C. Push-review has flagged the missing
 * `getServerSession` check more than once; the answer is "Phase 2."
 */

const VALID_ITEM_TYPES: ReadonlyArray<ItemType> = [
  "song",
  "mc",
  "video",
  "interval",
];

const POSITION_RETRY_MAX = 3;

interface ParsedBody {
  itemType: ItemType;
  songId: bigint | null;
  performerIds: string[];
  isEncore: boolean;
}

// Body parse + shape validation. Returns either a parsed body or a
// 400-bound error. Centralising the per-field guards here keeps the
// handler body shallow and the error contract uniform.
function parseBody(
  raw: unknown,
): { ok: true; body: ParsedBody } | { ok: false; error: string } {
  if (raw === null || typeof raw !== "object") {
    return { ok: false, error: "body must be an object" };
  }
  const body = raw as Record<string, unknown>;

  const itemType = body.itemType;
  if (
    typeof itemType !== "string" ||
    !VALID_ITEM_TYPES.includes(itemType as ItemType)
  ) {
    return {
      ok: false,
      error: "itemType must be one of: song, mc, video, interval",
    };
  }

  // songId is required only for itemType=song. For MC/video/interval
  // it's silently ignored if present (defensive; the client shouldn't
  // send it on a non-song row, but if it does, dropping is friendlier
  // than 400-ing).
  let songId: bigint | null = null;
  if (itemType === "song") {
    const rawSongId = body.songId;
    if (
      typeof rawSongId !== "number" ||
      !Number.isFinite(rawSongId) ||
      !Number.isInteger(rawSongId) ||
      rawSongId <= 0
    ) {
      return { ok: false, error: "songId required for itemType=song" };
    }
    songId = BigInt(rawSongId);
  }

  const performerIds = body.performerIds;
  if (!Array.isArray(performerIds)) {
    return { ok: false, error: "performerIds must be an array" };
  }
  if (!performerIds.every((id) => typeof id === "string" && id.length > 0)) {
    return { ok: false, error: "performerIds must be non-empty strings" };
  }

  const isEncore = body.isEncore;
  if (typeof isEncore !== "boolean") {
    return { ok: false, error: "isEncore must be boolean" };
  }

  return {
    ok: true,
    body: {
      itemType: itemType as ItemType,
      songId,
      performerIds,
      isEncore,
    },
  };
}

export async function POST(request: NextRequest, { params }: RouteProps) {
  // Gate 1 — feature flag. Returns 403 + flag-name error so the
  // client can render a "feature unavailable" message instead of a
  // generic failure toast. Matches the
  // `/api/setlist-items/[id]/confirm` pattern (PR #283) for
  // consistency in the user-input write-side surfaces.
  if (!LAUNCH_FLAGS.addItemEnabled) {
    return NextResponse.json(
      { ok: false, error: "feature_flag_disabled" },
      { status: 403 },
    );
  }

  // Gate 2 — eventId parses to bigint.
  const { id: rawEventId } = await params;
  let eventId: bigint;
  try {
    eventId = BigInt(rawEventId);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_event_id" },
      { status: 400 },
    );
  }

  // Gate 3 — body parse + shape.
  let bodyRaw: unknown;
  try {
    bodyRaw = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }
  const parsed = parseBody(bodyRaw);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: `validation: ${parsed.error}` },
      { status: 400 },
    );
  }
  const { itemType, songId, performerIds, isEncore } = parsed.body;

  // Gate 4 — event exists, not soft-deleted, status === 'ongoing'.
  // The 'ongoing' gate is a server-side mirror of the client's button
  // visibility check (ActualSetlist gates the button by `getEventStatus`
  // too). Client gate alone is forgeable — a curl POST mid-show
  // bypasses it. Both must say "ongoing" or we 400.
  //
  // We also load `event.performers` here in the same query so the
  // subset check below (Gate 6) doesn't need a second round-trip.
  // NOTE: no `isGuest: false` filter here — both host and guest
  // performers on the event are valid picks. A guest StageIdentity
  // explicitly added to `EventPerformer` (e.g. Miyake Miu before
  // joining as member) is a legitimate performer that fans should
  // be able to credit; the "out-of-event guests" the spec forbids
  // are people who aren't on the EventPerformer list at all. The
  // admin route's `isGuest: false` filter is for auto-fill defaults
  // (operator pre-checks main lineup), not membership validation.
  //
  // Both the Gate 4 event lookup and the Gate 5 song lookup are
  // wrapped in try/catch — a DB connection error during either
  // would otherwise escape uncaught and Next.js would render its
  // HTML 500 page, which the bottom sheet's `await res.json()`
  // can't parse. The transaction inside the retry loop below has
  // its own scoped error handling; this outer try only covers the
  // pre-transaction validation lookups.
  let event;
  try {
    event = await prisma.event.findFirst({
      where: { id: eventId, isDeleted: false },
      select: {
        id: true,
        status: true,
        startTime: true,
        performers: {
          select: { stageIdentityId: true },
        },
      },
    });
  } catch (err) {
    console.error(
      "[POST /api/events/[id]/setlist-items] event lookup failed",
      err,
    );
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }
  if (!event) {
    return NextResponse.json(
      { ok: false, error: "event_not_found" },
      { status: 404 },
    );
  }
  if (getEventStatus(event) !== "ongoing") {
    return NextResponse.json(
      { ok: false, error: "event_not_ongoing" },
      { status: 400 },
    );
  }

  // Gate 5 — song exists (itemType=song path only). We pull
  // SongArtist rows in the same query so the server-authoritative
  // stageType derivation (below) gets the live data, not a stale
  // copy from the client's earlier load.
  let songArtists: { artistId: bigint; type: "solo" | "group" | "unit" }[] = [];
  if (itemType === "song") {
    let song;
    try {
      song = await prisma.song.findFirst({
        where: { id: songId!, isDeleted: false },
        select: {
          id: true,
          artists: {
            select: {
              artistId: true,
              artist: { select: { type: true } },
            },
          },
        },
      });
    } catch (err) {
      console.error(
        "[POST /api/events/[id]/setlist-items] song lookup failed",
        err,
      );
      return NextResponse.json(
        { ok: false, error: "internal_error" },
        { status: 500 },
      );
    }
    if (!song) {
      return NextResponse.json(
        { ok: false, error: "song_not_found" },
        { status: 404 },
      );
    }
    songArtists = song.artists.map((sa) => ({
      artistId: sa.artistId,
      type: sa.artist.type,
    }));
  }

  // Gate 6 — every performerId must be in event.performers (no
  // out-of-event guests at 1C; the spec directs users to the operator
  // via the bottom sheet's footer link). MC/video/interval items
  // ignore performerIds entirely per spec.
  if (itemType === "song" && performerIds.length > 0) {
    const eventPerformerIds = new Set(
      event.performers.map((p) => p.stageIdentityId),
    );
    const stranger = performerIds.find((id) => !eventPerformerIds.has(id));
    if (stranger !== undefined) {
      return NextResponse.json(
        { ok: false, error: "performer_not_in_event" },
        { status: 400 },
      );
    }
  }

  // Server-authoritative stageType derivation. The client computed
  // its own for performer auto-fill UX, but the DB write goes through
  // this — the client may have a stale SongArtist list, or be lying.
  const { stageType } = deriveStageType(
    itemType,
    songArtists.map((sa) => ({
      artistId: Number(sa.artistId),
      type: sa.type,
    })),
  );

  // Gate 7 — transaction with position retry. Two simultaneous user
  // submissions can compute the same `nextPos` (both read MAX(position)
  // before either commits). The partial unique index
  // `[eventId, position] WHERE isDeleted = false` (post-deploy.sql:181)
  // catches the collision with Prisma P2002; we retry up to
  // POSITION_RETRY_MAX times before surfacing 409. With ≤3 users
  // tapping submit within milliseconds of each other on the same
  // event, retry resolves; with a higher contention rate the 409 is
  // legitimately surfaceable as "try again."
  //
  // Stage-type is computed OUTSIDE the transaction (deterministic
  // from the song's artists; the loop doesn't change it).
  let lastError: unknown = null;
  for (let attempt = 0; attempt < POSITION_RETRY_MAX; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const existing = await tx.setlistItem.findMany({
          where: { eventId, isDeleted: false },
          select: { position: true },
        });
        const position = nextSetlistPosition(existing);

        return tx.setlistItem.create({
          data: {
            eventId,
            position,
            isEncore,
            stageType, // server-recomputed, not from client
            status: "rumoured",
            performanceType: "live_performance",
            type: itemType,
            songs:
              itemType === "song" && songId !== null
                ? { create: [{ songId, order: 1 }] }
                : undefined,
            // CRITICAL: the relation is `performers`, NOT `members`
            // (despite the task-spec pseudocode using `members:`).
            // See prisma/schema.prisma:552 — SetlistItem.performers:
            // SetlistItemMember[]. Using `members:` here would fail
            // Prisma's type check at compile time.
            performers:
              itemType === "song" && performerIds.length > 0
                ? {
                    create: performerIds.map((stageIdentityId) => ({
                      stageIdentityId,
                    })),
                  }
                : undefined,
          },
          // Same include shape as the admin insert-after route so the
          // response payload matches across both user + admin
          // creation paths. Downstream renderers (ActualSetlist row
          // primitive, optimistic insert into the local items array)
          // can use one shared type.
          include: {
            songs: {
              include: { song: { include: { translations: true } } },
              orderBy: { order: "asc" },
            },
            performers: {
              include: {
                stageIdentity: { include: { translations: true } },
              },
            },
            artists: {
              include: { artist: { include: { translations: true } } },
            },
          },
        });
      });

      return NextResponse.json(
        { ok: true, item: serializeBigInt(created) },
        { status: 201 },
      );
    } catch (err) {
      lastError = err;
      // Only retry on a position-unique-constraint hit. Anything else
      // (DB down, FK violation from a deleted performer, etc.) is
      // not a race — fall through to the 500 handling below.
      const isPositionRace =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        // `target` on P2002 is the unique-index columns. Our partial
        // unique is on [eventId, position], so the target contains
        // 'position'. Defensive substring check — Prisma's exact
        // target shape varies by adapter (array vs string).
        JSON.stringify(err.meta?.target ?? "").includes("position");
      if (!isPositionRace) break;
      // Loop continues; recomputes nextPosition with the (now larger)
      // active-position set the colliding writer committed.
    }
  }

  // Exhausted retries or non-retryable error.
  const wasRace =
    lastError instanceof Prisma.PrismaClientKnownRequestError &&
    lastError.code === "P2002";
  if (wasRace) {
    return NextResponse.json(
      { ok: false, error: "position_conflict" },
      { status: 409 },
    );
  }
  console.error(
    "[POST /api/events/[id]/setlist-items] unexpected error",
    lastError,
  );
  return NextResponse.json(
    { ok: false, error: "internal_error" },
    { status: 500 },
  );
}
