import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LAUNCH_FLAGS } from "@/lib/launchFlags";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * Phase 1C SetlistItemConfirm POST endpoint.
 *
 *   POST /api/setlist-items/[id]/confirm
 *        → { ok: true }                        (DB write succeeded)
 *        → { ok: true, skipped: "feature_flag_disabled" }  (flag off)
 *
 * Two-stage activation per the 5/3 timeline:
 *   - 5/23 + 5/24 Kobe   — `LAUNCH_FLAGS.confirmDbEnabled === false`,
 *                          handler short-circuits with the `skipped`
 *                          response so the UI flow is exercised
 *                          without DB contamination.
 *   - 5/30 Kanagawa Day-1 onward — flag flips to `true`, the same
 *                          endpoint starts inserting confirm rows.
 *                          Activation is one-line: delete the
 *                          `confirmDbEnabled` entry from launchFlags
 *                          (the entry's removal IS the activation,
 *                          per the comment block on the flag).
 *
 * No `anonId` recorded (`wiki/conflicts.md #9` — schema simplification).
 * No partial-unique constraint. Viewers in private windows can submit
 * multiple confirms for the same row; the threshold-aggregation pass
 * in Week 3 handles deduplication. Operator runbook covers the
 * bounded abuse risk for Phase 1.
 *
 * The handler always returns 200 — even on the flag-off path — so
 * the client's fire-and-forget POST never throws and the UI's
 * optimistic-update flow stays clean. Errors are still 500'd
 * normally if the DB write itself fails.
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
  const item = await prisma.setlistItem.findFirst({
    where: { id: setlistItemId, isDeleted: false },
    select: { id: true },
  });
  if (!item) {
    return NextResponse.json(
      { error: "Setlist item not found" },
      { status: 404 },
    );
  }

  await prisma.setlistItemConfirm.create({
    data: { setlistItemId },
  });

  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
