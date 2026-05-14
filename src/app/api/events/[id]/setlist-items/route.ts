import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { LAUNCH_FLAGS } from "@/lib/launchFlags";
import { getEventStatus } from "@/lib/eventStatus";
import { deriveStageType, type ItemType } from "@/lib/setlistStageType";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * POST /api/events/[id]/setlist-items
 *
 *   Body: {
 *     itemType: "song" | "mc" | "video" | "interval",
 *     songId?: number | string,  // required when itemType === 'song';
 *                                // the variant's Song.id (variants are
 *                                // separate rows linked via baseVersionId).
 *                                // Accepts safe-integer number OR
 *                                // decimal string (BigInt round-trip)
 *     performerIds: string[],    // stageIdentityId[]; ignored for non-song
 *     isEncore: boolean,
 *     position: number,          // explicit position the client chose
 *                                // from the visible setlist; server
 *                                // lands there exactly (no
 *                                // `nextSetlistPosition` computation)
 *   }
 *
 *   → 201 { ok: true, item: SerializedSetlistItem }   (create)
 *   → 200 { ok: true, item: SerializedSetlistItem, action: "auto-confirm-merge" }
 *         (same-position same-song dedup → SetlistItemConfirm on the
 *         existing row instead of creating a sibling)
 *   → 403 { ok: false, error: "feature_flag_disabled" }
 *   → 400 { ok: false, error: <validation> | "event_not_ongoing"
 *                              | "performer_not_in_event"
 *                              | "position_already_confirmed" }
 *   → 404 { ok: false, error: "event_not_found" | "song_not_found" }
 *   → 409 { ok: false, error: "position_conflict" }   (after retries)
 *
 * Backs the Phase 1C `<AddItemBottomSheet>` — user-submitted setlist
 * rows. The conflict-handling extension (this PR) flips the position
 * model from server-computed (`nextSetlistPosition(items)`) to
 * client-supplied. The race-loss-misplacement bug that motivated the
 * change: with server-side position computation, User B's intended
 * "next position N+1" submission could silently land at N+2 if User A
 * grabbed N+1 first. With explicit position, both submissions land at
 * exactly N+1 — same song merges via dedup, different song creates a
 * rumoured sibling (conflict group).
 *
 * Mirrors the admin `insert-after` endpoint
 * (`src/app/api/admin/setlist-items/insert-after/route.ts`) but:
 *
 *   - Position from `body.position`, not server-computed
 *   - Forces `status: 'rumoured'` (admin default is `confirmed`)
 *   - Recomputes `stageType` server-side from the song's
 *     `SongArtist` rows; client-passed stageType is ignored
 *   - Accepts `performers` as an explicit, user-edited list
 *   - Rejects if the target position is already owned by a
 *     non-rumoured row (operator/promoted): 400
 *     `position_already_confirmed`. The follow-up ContestReport PR
 *     will provide the proper contest path for confirmed rows
 *   - Auto-merges if a rumoured row at the SAME position with the
 *     SAME songId exists within the dedup window → writes a
 *     `SetlistItemConfirm` instead of creating a sibling
 *   - Allows multiple rumoured rows at the same position (conflict
 *     siblings) — the partial unique index is gated on
 *     `status != 'rumoured'`, so the negation form permits siblings.
 *     Vote-driven promotion in `/api/setlist-items/[id]/confirm`
 *     resolves the conflict (winner promoted + siblings auto-hidden)
 *     when one candidate crosses `CONFLICT_CONFIRMATION_THRESHOLD`
 *
 * Path param is `[id]` because the parent dynamic segment is
 * `[id]` for the events tree and Next.js disallows different slug
 * names at the same depth.
 *
 * Returns JSON 4xx/5xx for ALL failure modes. Realtime broadcasts
 * the INSERT automatically (postgres_changes on SetlistItem).
 *
 * Authentication NOTE: intentionally unauthenticated at Phase 1C,
 * matching every other fan-facing write endpoint. Per
 * `wiki/conflicts.md #9`, 1C fan writes carry no anonId / userId.
 * NextAuth ships in Phase 2 with the trust-tier system.
 */

const VALID_ITEM_TYPES: ReadonlyArray<ItemType> = [
  "song",
  "mc",
  "video",
  "interval",
];

const POSITION_RETRY_MAX = 3;

// Dedup window for the auto-confirm-merge path (Gate 6.5). Two
// users independently submitting the same song at the same
// position within this window collapses into one row with a
// SetlistItemConfirm row added. 5 minutes matches the original
// task spec; longer windows risk false-positive merges of
// genuinely-distinct submissions (rare song repeats in special
// live setlists), shorter windows risk missing real race-ties.
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

interface ParsedBody {
  itemType: ItemType;
  songId: bigint | null;
  performerIds: string[];
  isEncore: boolean;
  // Conflict-handling: explicit position is now part of the request.
  // The client computes this from the visible setlist at button-
  // click time and freezes it for the duration of the sheet's
  // deliberation period. Server uses this value as-is — no longer
  // computes `nextSetlistPosition` internally. See plan section
  // "Server position computation: eliminated" for the race-loss
  // rationale.
  position: number;
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
  //
  // Accepts BOTH a JS number (must pass `Number.isSafeInteger` so big
  // BigInt IDs that exceed 2^53-1 aren't silently lost-precision) AND
  // a decimal string (clients hitting this from a fetch that
  // pre-serialises BigInt → string can route through unchanged).
  // `Song.id` is `BigInt @default(autoincrement())` and we currently
  // sit well under 2^53, but the validator should not assume that
  // forever.
  let songId: bigint | null = null;
  if (itemType === "song") {
    const rawSongId = body.songId;
    const isSafeNumber =
      typeof rawSongId === "number" &&
      Number.isSafeInteger(rawSongId) &&
      rawSongId > 0;
    // `^[1-9]\d*$` rejects leading zeros and "0" itself, mirroring
    // the `> 0` check on the number path.
    const isDigitString =
      typeof rawSongId === "string" && /^[1-9]\d*$/.test(rawSongId);
    if (!isSafeNumber && !isDigitString) {
      return { ok: false, error: "songId required for itemType=song" };
    }
    songId = BigInt(rawSongId as number | string);
  }

  const performerIds = body.performerIds;
  if (!Array.isArray(performerIds)) {
    return { ok: false, error: "performerIds must be an array" };
  }
  if (!performerIds.every((id) => typeof id === "string" && id.length > 0)) {
    return { ok: false, error: "performerIds must be non-empty strings" };
  }
  // Duplicate stageIdentityIds would otherwise trip the
  // `SetlistItemMember` composite unique on `[setlistItemId,
  // stageIdentityId]` at create time — that surfaces as a non-position
  // P2002 which (correctly) routes to 500 internal_error in the
  // catch path. Catching dup IDs HERE turns the same malformed input
  // into a clear 400 instead of an opaque 500.
  if (new Set(performerIds).size !== performerIds.length) {
    return { ok: false, error: "performerIds must be unique" };
  }

  const isEncore = body.isEncore;
  if (typeof isEncore !== "boolean") {
    return { ok: false, error: "isEncore must be boolean" };
  }

  // Position is required for all item types — the client decides
  // where the row lands based on the live setlist it sees, then
  // freezes that value through the sheet's deliberation window.
  // Must be a positive integer (matches the `Int` column on
  // `SetlistItem.position`). Plain JS number suffices — position
  // values won't exceed 2^53-1 in any realistic setlist.
  const rawPosition = body.position;
  if (
    typeof rawPosition !== "number" ||
    !Number.isInteger(rawPosition) ||
    rawPosition <= 0
  ) {
    return { ok: false, error: "position must be a positive integer" };
  }

  return {
    ok: true,
    body: {
      itemType: itemType as ItemType,
      songId,
      performerIds,
      isEncore,
      position: rawPosition,
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
  const { itemType, songId, performerIds, isEncore, position } = parsed.body;

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

  // Gate 4.5 — position not already owned by a finalized (non-rumoured)
  // row. The partial unique index permits multiple rumoured rows at the
  // same position (conflict siblings), but only one `status != 'rumoured'`
  // row. If the target position already has a confirmed/live row, the
  // user's submission cannot land there as a rumoured sibling without
  // the eventual promotion transaction tripping the index. Reject up
  // front with a clear error and a hint about the operator path
  // (which the follow-up ContestReport PR will expose).
  let occupant;
  try {
    occupant = await prisma.setlistItem.findFirst({
      where: {
        eventId,
        position,
        isDeleted: false,
        status: { not: "rumoured" },
      },
      select: { id: true },
    });
  } catch (err) {
    console.error(
      "[POST /api/events/[id]/setlist-items] occupant lookup failed",
      err,
    );
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }
  if (occupant) {
    return NextResponse.json(
      { ok: false, error: "position_already_confirmed" },
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

  // Gate 6.5 — exact-position-same-song dedup (auto-confirm-merge).
  // If a rumoured row already exists at the SAME position with the
  // SAME songId within the dedup window, write a SetlistItemConfirm
  // on the existing row instead of creating a sibling. Two users
  // independently submitting the same song at the same position
  // (race-tied submissions, or sequential agreement) is a stronger
  // correctness signal than counting upvotes — collapse into one
  // row + bump confirmCount.
  //
  // SCOPE NARROWED FROM THE TASK SPEC: the original spec checked
  // position ±1 (proposedPosition ± 1) to catch race-loss scenarios
  // where User B's "next position" submission landed at N+2 because
  // User A grabbed N+1 first. With the explicit-position model the
  // race-loss path is closed (client sends explicit position, server
  // doesn't compute), so the ±1 expansion would now over-match —
  // legitimate "same song played twice consecutively" cases (rare
  // but possible in special live setlists) would be mis-merged. We
  // check the exact position only.
  if (itemType === "song" && songId !== null) {
    const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
    let dupRow;
    try {
      dupRow = await prisma.setlistItem.findFirst({
        where: {
          eventId,
          position,
          isDeleted: false,
          status: "rumoured",
          createdAt: { gte: cutoff },
          songs: { some: { songId } },
        },
        select: { id: true },
      });
    } catch (err) {
      console.error(
        "[POST /api/events/[id]/setlist-items] dup lookup failed",
        err,
      );
      return NextResponse.json(
        { ok: false, error: "internal_error" },
        { status: 500 },
      );
    }
    if (dupRow) {
      // Write a SetlistItemConfirm on the existing row + return its
      // re-included payload so the client gets the same response
      // shape as a create. The confirm POST route's promotion
      // transaction is NOT triggered from here — it runs on the
      // user's own /confirm POSTs, not this auto-merge path. The
      // auto-merge confirm represents "two users independently
      // submitted the same song" which is a strong signal but not
      // necessarily a user explicitly voting through the
      // ConfirmButton.
      try {
        await prisma.setlistItemConfirm.create({
          data: { setlistItemId: dupRow.id },
        });
      } catch (err) {
        console.error(
          "[POST /api/events/[id]/setlist-items] auto-merge confirm write failed",
          err,
        );
        return NextResponse.json(
          { ok: false, error: "internal_error" },
          { status: 500 },
        );
      }
      const merged = await prisma.setlistItem.findUnique({
        where: { id: dupRow.id },
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
      return NextResponse.json(
        {
          ok: true,
          item: serializeBigInt(merged),
          action: "auto-confirm-merge",
        },
        { status: 200 },
      );
    }
  }

  // Gate 7 — create transaction. With the explicit-position model
  // the client owns position computation, so the legacy
  // `nextSetlistPosition` race + retry-on-P2002 loop is mostly
  // historical: the negation index (post-deploy.sql:181 area) now
  // permits multiple rumoured rows at the same position, so user
  // POSTs through this route shouldn't see a position-target P2002
  // at all. The retry remains as defensive infrastructure in case a
  // future code path inserts a non-rumoured row via this handler;
  // the in-loop `isPositionRace` filter + post-loop target-substring
  // match still discriminate correctly.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < POSITION_RETRY_MAX; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
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
  // Mirror the in-loop `isPositionRace` target-substring check so a
  // P2002 on some OTHER unique constraint (e.g. `SetlistItemMember`'s
  // composite `[setlistItemId, stageIdentityId]` if a future client
  // bug submitted duplicate performerIds) is surfaced as 500, not as
  // a misleading "position_conflict" 409. The looser
  // `code === "P2002"`-only check we had before would 409 those, and
  // also flip the in-loop `break` path's intent: the loop already
  // discriminates and only retries on a position-target hit, so the
  // post-loop check must agree with that classifier.
  const wasPositionRace =
    lastError instanceof Prisma.PrismaClientKnownRequestError &&
    lastError.code === "P2002" &&
    JSON.stringify(lastError.meta?.target ?? "").includes("position");
  if (wasPositionRace) {
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
