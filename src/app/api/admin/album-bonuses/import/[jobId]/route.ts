import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { parseBigInt } from "@/lib/adminParsers";
import {
  readCandidates,
  readDecisions,
  reconcile,
  type Decisions,
  type ExistingListingRow,
} from "@/lib/album-bonus-import";

type RouteProps = { params: Promise<{ jobId: string }> };

/**
 * GET /api/admin/album-bonuses/import/[jobId]
 *
 * Returns the job + its raw candidates payload + a freshly-computed
 * Classifications block. Classifications are NOT persisted — recomputing
 * on every read keeps the review UI honest against current DB state
 * even when the job has been sitting in the queue for days.
 *
 *   → 200 { job, candidates, decisions, classifications }
 *   → 401 unauthorized
 *   → 404 not found
 */
export async function GET(_request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { jobId } = await params;
  if (!jobId) {
    return NextResponse.json({ error: "잘못된 ID입니다." }, { status: 400 });
  }

  const job = await prisma.albumBonusImportJob.findUnique({
    where: { id: jobId },
    include: {
      album: {
        select: {
          id: true,
          originalTitle: true,
          slug: true,
          releaseDate: true,
        },
      },
    },
  });
  if (!job) {
    return NextResponse.json(
      { error: "임포트 작업을 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  const candidates = readCandidates(job.candidates);
  const decisions = readDecisions(job.decisions);

  let classifications;
  if (job.albumId) {
    const listings = await prisma.albumStoreListing.findMany({
      where: { albumId: job.albumId },
      select: {
        id: true,
        originalStoreName: true,
        originalEditionLabel: true,
        productUrl: true,
        bonuses: { select: { id: true, originalBonusType: true } },
      },
    });
    classifications = reconcile(candidates, listings as ExistingListingRow[]);
  } else {
    classifications = reconcile(candidates, []);
  }

  return NextResponse.json({
    job: serializeBigInt(job),
    candidates,
    decisions,
    classifications,
  });
}

type PatchBody = {
  albumId?: unknown;
  sourceUrl?: unknown;
  notes?: unknown;
  decisions?: unknown;
};

/**
 * PATCH /api/admin/album-bonuses/import/[jobId]
 *
 *   Update operator-editable fields on a pending job. All four fields
 *   are optional — `undefined` = preserve. Setting `albumId` to `null`
 *   explicitly clears the album link (operator changed their mind).
 *
 *   Decisions are accepted as a full replacement object — the review
 *   UI sends the complete current state on each save. Partial merges
 *   would race with itself when the operator toggles two checkboxes
 *   simultaneously.
 *
 *   Refuses to mutate an `applied` or `discarded` job (immutable
 *   audit trail per AlbumBonusImportJobStatus doc).
 *
 *   → 200 { job }
 *   → 400 invalid input
 *   → 401 unauthorized
 *   → 404 not found
 *   → 409 job no longer pending
 */
export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { jobId } = await params;
  if (!jobId) {
    return NextResponse.json({ error: "잘못된 ID입니다." }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "잘못된 JSON입니다." }, { status: 400 });
  }

  const data: Prisma.AlbumBonusImportJobUpdateInput = {};

  if (body.albumId !== undefined) {
    if (body.albumId === null) {
      data.album = { disconnect: true };
    } else {
      const parsed = parseBigInt(body.albumId);
      if (parsed === null) {
        return NextResponse.json(
          { error: "유효하지 않은 앨범 ID입니다." },
          { status: 400 },
        );
      }
      data.album = { connect: { id: parsed } };
    }
  }

  if (body.sourceUrl !== undefined) {
    if (body.sourceUrl === null || body.sourceUrl === "") {
      data.sourceUrl = null;
    } else if (typeof body.sourceUrl === "string") {
      data.sourceUrl = body.sourceUrl.trim() || null;
    } else {
      return NextResponse.json(
        { error: "sourceUrl 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    }
  }

  if (body.notes !== undefined) {
    if (body.notes === null || body.notes === "") {
      data.notes = null;
    } else if (typeof body.notes === "string") {
      data.notes = body.notes.trim() || null;
    } else {
      return NextResponse.json(
        { error: "notes 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    }
  }

  if (body.decisions !== undefined) {
    if (!isDecisionsShape(body.decisions)) {
      return NextResponse.json(
        { error: "decisions 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    }
    data.decisions = body.decisions as unknown as Prisma.InputJsonValue;
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Status gate enforced in-tx — guards against the race where a
      // concurrent apply flipped the job to "applied" between this
      // request's readout and the update.
      const current = await tx.albumBonusImportJob.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      if (!current) return { error: "missing" as const };
      if (current.status !== "pending") {
        return { error: "not-pending" as const, status: current.status };
      }
      return {
        row: await tx.albumBonusImportJob.update({
          where: { id: jobId },
          data,
          include: {
            album: {
              select: {
                id: true,
                originalTitle: true,
                slug: true,
                releaseDate: true,
              },
            },
          },
        }),
      };
    });

    if ("error" in updated) {
      if (updated.error === "missing") {
        return NextResponse.json(
          { error: "임포트 작업을 찾을 수 없습니다." },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: `이 작업은 이미 ${updated.status} 상태이므로 수정할 수 없습니다.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ job: serializeBigInt(updated.row) });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      // FK miss when operator picked a non-existent albumId.
      if (e.code === "P2003" || e.code === "P2025") {
        return NextResponse.json(
          { error: "앨범을 찾을 수 없습니다." },
          { status: 404 },
        );
      }
    }
    throw e;
  }
}

/**
 * DELETE /api/admin/album-bonuses/import/[jobId]
 *
 *   Hard-delete a pending job. Discards candidates without applying
 *   any row. Distinct from setting status=discarded (which keeps the
 *   audit trail) — DELETE is for "this was clearly junk, don't keep it".
 *
 *   Applied jobs cannot be deleted — they are the audit record of
 *   what was imported. To remove the rows they wrote, the operator
 *   deletes individual AlbumStoreListing / AlbumStoreBonus rows.
 *
 *   → 200 { ok: true }
 *   → 401 unauthorized
 *   → 404 not found
 *   → 409 job is applied
 */
export async function DELETE(_request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { jobId } = await params;
  if (!jobId) {
    return NextResponse.json({ error: "잘못된 ID입니다." }, { status: 400 });
  }

  const existing = await prisma.albumBonusImportJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "임포트 작업을 찾을 수 없습니다." },
      { status: 404 },
    );
  }
  if (existing.status === "applied") {
    return NextResponse.json(
      { error: "이미 적용된 작업은 삭제할 수 없습니다." },
      { status: 409 },
    );
  }

  // Atomic delete guarded by status. The findUnique above gives us
  // the 404 / 409 distinction, but between that read and the actual
  // delete a concurrent apply could flip the row to `applied` — and
  // a plain `delete({ where: { id }})` would then erase the audit
  // record. `deleteMany` with the status filter closes the window:
  // 0-count means "applied between our read and now" → 409.
  const deleted = await prisma.albumBonusImportJob.deleteMany({
    where: { id: jobId, status: { not: "applied" } },
  });
  if (deleted.count === 0) {
    return NextResponse.json(
      { error: "이미 적용된 작업은 삭제할 수 없습니다." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}

function isDecisionsShape(v: unknown): v is Decisions {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.listings === "object" &&
    o.listings !== null &&
    typeof o.bonuses === "object" &&
    o.bonuses !== null &&
    (o.globalEarlyBooking === null || typeof o.globalEarlyBooking === "object")
  );
}
