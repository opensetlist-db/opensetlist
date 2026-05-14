import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LAUNCH_FLAGS } from "@/lib/launchFlags";
import { CONFLICT_CONFIRMATION_THRESHOLD } from "@/lib/config";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * Phase 1C SetlistItemConfirm POST endpoint.
 *
 *   POST /api/setlist-items/[id]/confirm
 *        → { ok: true }                                    (DB write succeeded)
 *        → { ok: true, promoted: true }                    (write succeeded
 *                                                          AND this row crossed
 *                                                          CONFLICT_CONFIRMATION_THRESHOLD
 *                                                          AND it had rumoured
 *                                                          siblings → promotion
 *                                                          transaction fired)
 *        → { ok: true, skipped: "feature_flag_disabled" }  (flag off)
 *
 * Two-stage activation per the 5/3 timeline:
 *   - 5/23 + 5/24 Kobe   — `LAUNCH_FLAGS.confirmDbEnabled === false`,
 *                          handler short-circuits with the `skipped`
 *                          response so the UI flow is exercised
 *                          without DB contamination.
 *   - 5/30 Kanagawa Day-1 onward — flag flips to `true`, the same
 *                          endpoint starts inserting confirm rows.
 *
 * No `anonId` recorded (`wiki/conflicts.md #9` — schema simplification).
 * No partial-unique constraint. Viewers in private windows can submit
 * multiple confirms for the same row; the threshold-aggregation +
 * conflict-handling promotion (this PR's extension) bound the abuse.
 *
 * Conflict-handling extension (this PR): after writing the
 * SetlistItemConfirm row, check whether this row has crossed
 * `CONFLICT_CONFIRMATION_THRESHOLD` AND has rumoured siblings at the
 * same position. If both, run the promotion transaction in a single
 * atomic block:
 *   1. Hide siblings (`isDeleted = true, deletedAt = now()`)
 *   2. Promote winner (`status = 'confirmed'`)
 *
 * Order is load-bearing: siblings must transition out of the
 * `status != 'rumoured'` set first; reversing the order would have
 * two confirmed rows at the same position in the intermediate state
 * and trip the negation partial-unique index. The `where` filter on
 * the winner update (`status: 'rumoured'`) makes the promotion
 * idempotent — two confirm POSTs racing past the threshold both fire
 * the transaction, but the second one finds the winner already in
 * `confirmed` status and updates nothing.
 *
 * The handler always returns 200 on success paths — even on the
 * flag-off path — so the client's fire-and-forget POST never throws.
 * DB errors still 500 normally.
 */
export async function POST(_req: Request, { params }: RouteProps) {
  const { id } = await params;

  let setlistItemId: bigint;
  try {
    setlistItemId = BigInt(id);
  } catch {
    return NextResponse.json(
      { error: "Invalid setlist item id" },
      { status: 400 },
    );
  }

  if (!LAUNCH_FLAGS.confirmDbEnabled) {
    // Skip the DB write but return success. The `skipped` field is
    // diagnostic — it lets ops monitoring see "would-have-confirmed"
    // call rates during 5/23 Kobe testing without inspecting flag
    // state separately.
    return NextResponse.json(
      { ok: true, skipped: "feature_flag_disabled" },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  // Verify the setlist item exists (and isn't soft-deleted) before
  // we write. The FK constraint would catch a stale id but the
  // Prisma error is opaque (P2003); explicit 404 gives the client a
  // usable error shape, matches the reactions / wishes route
  // precedent.
  //
  // We also need `eventId, position, status` for the conflict-handling
  // threshold check below — load them in the same query.
  let item: { id: bigint; eventId: bigint; position: number; status: string } | null;
  try {
    item = await prisma.setlistItem.findFirst({
      where: { id: setlistItemId, isDeleted: false },
      select: { id: true, eventId: true, position: true, status: true },
    });
  } catch (err) {
    console.error("[POST /confirm] item lookup failed", err);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 },
    );
  }
  if (!item) {
    return NextResponse.json(
      { error: "Setlist item not found" },
      { status: 404 },
    );
  }

  // Write the confirm row.
  try {
    await prisma.setlistItemConfirm.create({
      data: { setlistItemId },
    });
  } catch (err) {
    console.error("[POST /confirm] confirm row write failed", err);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 },
    );
  }

  // Conflict-handling promotion path. Only applies when:
  //   1. The parent row is still `rumoured` (operator-confirmed +
  //      operator-live rows are immutable from the user side).
  //   2. The row has rumoured siblings at the same `(eventId, position)`
  //      (otherwise there's no conflict to resolve; the row is a
  //      regular non-contested rumoured row).
  //   3. confirmCount on this row has reached
  //      CONFLICT_CONFIRMATION_THRESHOLD after the write above.
  //
  // The check + transaction is fire-and-forget from the client's POV
  // — even if it fails, the confirm row is already persisted and the
  // POST still returns 200 (the client's optimistic UI update stays
  // valid). A failed promotion just means the conflict persists; the
  // next confirm tap retries it.
  if (item.status === "rumoured") {
    try {
      // Load siblings + the post-write confirmCount. One round-trip
      // each — could collapse into a transaction but the threshold
      // check is read-only and the promotion transaction below only
      // fires on a positive outcome, so the brief window between
      // these two queries is harmless (a parallel confirm arriving
      // mid-check would just trigger its own promotion attempt
      // idempotently).
      const [siblings, confirmCount] = await Promise.all([
        prisma.setlistItem.findMany({
          where: {
            eventId: item.eventId,
            position: item.position,
            isDeleted: false,
            status: "rumoured",
            id: { not: item.id },
          },
          select: { id: true },
        }),
        prisma.setlistItemConfirm.count({
          where: { setlistItemId: item.id },
        }),
      ]);

      const shouldPromote =
        siblings.length > 0 &&
        confirmCount >= CONFLICT_CONFIRMATION_THRESHOLD;

      if (shouldPromote) {
        // Atomic promotion + auto-hide. Order is load-bearing:
        // siblings out of the `status != 'rumoured'` set BEFORE the
        // winner enters it. Reversed order would have two confirmed
        // rows at the same position in the intermediate state →
        // negation partial-unique index P2002.
        //
        // The `where: { status: 'rumoured' }` filter on the winner
        // update makes this idempotent: a second confirm POST racing
        // past the threshold finds the winner already `confirmed`
        // and updates nothing. updateMany doesn't throw on zero rows.
        await prisma.$transaction([
          prisma.setlistItem.updateMany({
            where: {
              eventId: item.eventId,
              position: item.position,
              id: { not: item.id },
              status: "rumoured",
              isDeleted: false,
            },
            data: { isDeleted: true, deletedAt: new Date() },
          }),
          prisma.setlistItem.updateMany({
            where: { id: item.id, status: "rumoured" },
            data: { status: "confirmed" },
          }),
        ]);

        return NextResponse.json(
          { ok: true, promoted: true },
          { headers: { "Cache-Control": "private, no-store" } },
        );
      }
    } catch (err) {
      // Promotion path failed but the confirm row is still
      // persisted. Log + fall through to the normal 200 — the
      // client's optimistic [✓] state is correct, and the next
      // confirm tap will retry promotion. Don't 500 here.
      console.error(
        "[POST /confirm] promotion attempt failed (confirm row persisted)",
        err,
      );
    }
  }

  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
