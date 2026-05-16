import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { LAUNCH_FLAGS } from "@/lib/launchFlags";
import {
  parseContestReportPayload,
  MAX_COMMENT_CHARS,
  type ContestReportPayload,
} from "@/lib/contestReportPayload";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * POST /api/setlist-items/[id]/contests
 *
 *   Body: {
 *     type: "wrong_song" | "missing_performer" | "wrong_variant" | "other",
 *     payload: per-type schema (see src/lib/contestReportPayload.ts),
 *     comment?: string,  // max 500 chars; required for type="other"
 *   }
 *
 *   → 201 { ok: true, report: { id, type, status, createdAt } }
 *   → 403 { ok: false, error: "feature_flag_disabled" }
 *   → 400 { ok: false, error: <validation> | "performer_not_in_event" }
 *   → 404 { ok: false, error: "setlist_item_not_found"
 *                              | "song_not_found" }
 *
 * Backs the per-row `<IssueReportButton>` affordance + the
 * `<ContestReportSheet>` form (Phase 1C operator-queue path).
 * Complements the real-time sibling path (`POST /events/[id]/setlist-items`):
 * filed when the user wants an OPERATOR to apply a correction
 * rather than triggering a vote-driven resolution.
 *
 * Two scenarios this covers:
 *   1. Confirmed row needs a fix (operator-authoritative; the
 *      sibling path rejects with 400 `position_already_confirmed`)
 *   2. Rumoured row has a non-song issue (missing performer, wrong
 *      variant, free-text feedback) that the sibling model can't
 *      express
 *
 * Authentication NOTE: intentionally unauthenticated at Phase 1C,
 * matching every other fan-facing write endpoint. Account-bound
 * abuse mitigation lands at Phase 2.
 */

function isCommentValid(
  comment: unknown,
  type: string,
): { ok: true; comment: string | null } | { ok: false; error: string } {
  if (comment === undefined || comment === null) {
    if (type === "other") {
      return {
        ok: false,
        error: "type=other requires a non-empty comment",
      };
    }
    return { ok: true, comment: null };
  }
  if (typeof comment !== "string") {
    return { ok: false, error: "comment must be a string" };
  }
  if (comment.length > MAX_COMMENT_CHARS) {
    return {
      ok: false,
      error: `comment must be ${MAX_COMMENT_CHARS} characters or fewer`,
    };
  }
  const trimmed = comment.trim();
  if (type === "other" && trimmed.length === 0) {
    return {
      ok: false,
      error: "type=other requires a non-empty comment",
    };
  }
  return { ok: true, comment: trimmed.length > 0 ? trimmed : null };
}

export async function POST(request: NextRequest, { params }: RouteProps) {
  // Gate 1 — feature flag.
  if (!LAUNCH_FLAGS.contestReportEnabled) {
    return NextResponse.json(
      { ok: false, error: "feature_flag_disabled" },
      { status: 403 },
    );
  }

  // Gate 2 — setlistItemId parses to bigint.
  const { id: rawId } = await params;
  let setlistItemId: bigint;
  try {
    setlistItemId = BigInt(rawId);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_setlist_item_id" },
      { status: 400 },
    );
  }

  // Gate 3 — body parse + per-type validation.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }
  if (rawBody === null || typeof rawBody !== "object") {
    return NextResponse.json(
      { ok: false, error: "body must be an object" },
      { status: 400 },
    );
  }
  const body = rawBody as Record<string, unknown>;

  const parsed = parseContestReportPayload(body.type, body.payload);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: `validation: ${parsed.error}` },
      { status: 400 },
    );
  }
  const { type, payload }: ContestReportPayload = parsed.value;

  const commentCheck = isCommentValid(body.comment, type);
  if (!commentCheck.ok) {
    return NextResponse.json(
      { ok: false, error: `validation: ${commentCheck.error}` },
      { status: 400 },
    );
  }
  const comment = commentCheck.comment;

  // Gate 4 — parent SetlistItem exists + not soft-deleted. We also
  // load `eventId` so the per-payload DB-existence checks below
  // (Gate 5) can scope their lookups (performer-in-event check).
  let setlistItem;
  try {
    setlistItem = await prisma.setlistItem.findFirst({
      where: { id: setlistItemId, isDeleted: false },
      select: { id: true, eventId: true },
    });
  } catch (err) {
    console.error(
      "[POST /api/setlist-items/[id]/contests] setlist-item lookup failed",
      err,
    );
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }
  if (!setlistItem) {
    return NextResponse.json(
      { ok: false, error: "setlist_item_not_found" },
      { status: 404 },
    );
  }

  // Gate 5 — per-payload DB-existence checks. The payload parser
  // (Gate 3) handles shape + scalar validation; DB lookups happen
  // here so the user gets a specific 404 instead of a Prisma FK
  // error at insert time.
  try {
    if (type === "wrong_song" || type === "wrong_variant") {
      const song = await prisma.song.findFirst({
        where: {
          id: BigInt(payload.proposedSongId),
          isDeleted: false,
        },
        select: { id: true, baseVersionId: true },
      });
      if (!song) {
        return NextResponse.json(
          { ok: false, error: "song_not_found" },
          { status: 404 },
        );
      }
      if (type === "wrong_variant" && payload.proposedVariantId !== undefined) {
        // For wrong_variant we accept either a base song id (user
        // says "this should be a variant of this base — operator
        // picks which") or a specific variant id (a Song whose
        // baseVersionId points at another song). If the user gave
        // a specific variant id, verify it exists AND that it IS
        // a variant of the proposed base.
        const variant = await prisma.song.findFirst({
          where: {
            id: BigInt(payload.proposedVariantId),
            isDeleted: false,
          },
          select: { id: true, baseVersionId: true },
        });
        if (!variant) {
          return NextResponse.json(
            { ok: false, error: "song_not_found" },
            { status: 404 },
          );
        }
        // The variant's baseVersionId must match the proposedSongId
        // (the user-asserted base). Otherwise the report describes
        // an incoherent pair.
        if (
          variant.baseVersionId === null ||
          variant.baseVersionId !== BigInt(payload.proposedSongId)
        ) {
          return NextResponse.json(
            {
              ok: false,
              error: "wrong_variant: proposedVariantId must be a variant of proposedSongId",
            },
            { status: 400 },
          );
        }
      }
    } else if (type === "missing_performer") {
      // All stageIdentityIds must be on the event's performer
      // roster (host or guest — both are valid contestees).
      const eventPerformerIds = new Set(
        (
          await prisma.eventPerformer.findMany({
            where: { eventId: setlistItem.eventId },
            select: { stageIdentityId: true },
          })
        ).map((p) => p.stageIdentityId),
      );
      const stranger = payload.stageIdentityIds.find(
        (id) => !eventPerformerIds.has(id),
      );
      if (stranger !== undefined) {
        return NextResponse.json(
          { ok: false, error: "performer_not_in_event" },
          { status: 400 },
        );
      }
    }
    // type === "other" has no DB-existence step.
  } catch (err) {
    console.error(
      "[POST /api/setlist-items/[id]/contests] db-existence check failed",
      err,
    );
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }

  // Gate 6 — write. ContestReport has no unique constraints
  // (intentional — same row can have multiple reports of the same
  // type at 1C; operator deduplicates by reading + dismissing).
  let report;
  try {
    report = await prisma.contestReport.create({
      data: {
        setlistItemId,
        type,
        // Prisma's Json column accepts `InputJsonValue` for writes.
        // Our typed `ContestReportPayload` unions don't structurally
        // match that index-signature recursive type, so we cast via
        // unknown → InputJsonValue. The payload was already
        // validated upstream by `parseContestReportPayload`, so the
        // cast is semantically safe — just a structural-typing
        // workaround for Prisma's Json column convention.
        payload: payload as unknown as Prisma.InputJsonValue,
        comment,
      },
      select: {
        id: true,
        type: true,
        status: true,
        createdAt: true,
      },
    });
  } catch (err) {
    console.error(
      "[POST /api/setlist-items/[id]/contests] insert failed",
      err,
    );
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      report: {
        id: report.id,
        type: report.type,
        status: report.status,
        createdAt: report.createdAt.toISOString(),
      },
    },
    { status: 201 },
  );
}
