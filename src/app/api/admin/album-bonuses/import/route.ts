import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { parseBigInt } from "@/lib/adminParsers";
import {
  EMPTY_DECISIONS,
  isParsedCandidates,
  reconcile,
  type ExistingListingRow,
} from "@/lib/album-bonus-import";

type CreateBody = {
  candidates?: unknown;
  albumId?: unknown;
  sourceUrl?: unknown;
  notes?: unknown;
};

/**
 * POST /api/admin/album-bonuses/import
 *
 * Persists a new AlbumBonusImportJob row from a `fetch-bonus.mjs`
 * parser output. The candidates JSON is stored verbatim — classifications
 * (insert / update-noop / update-changed) are computed fresh on every
 * subsequent GET against current DB state, so the operator never sees
 * stale reconciliation.
 *
 *   Body:
 *     candidates : ParsedCandidates (required) — see album-bonus-import.ts
 *     albumId    : string | number (optional) — operator may pre-resolve
 *     sourceUrl  : string (optional) — 公式 news URL
 *     notes      : string (optional) — operator-private note
 *
 *   → 201 { job: {...}, classifications: {...} }
 *   → 400 invalid input
 *   → 401 unauthorized
 *   → 404 referenced album not found (when albumId provided)
 */
export async function POST(request: NextRequest) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "잘못된 JSON입니다." }, { status: 400 });
  }

  if (!isParsedCandidates(body.candidates)) {
    return NextResponse.json(
      { error: "candidates 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  const candidates = body.candidates;

  // Empty listings: reject. There is nothing for the operator to
  // review and persisting an empty job is just clutter.
  if (candidates.listings.length === 0) {
    return NextResponse.json(
      { error: "후보 매장이 비어 있습니다." },
      { status: 400 },
    );
  }

  let albumId: bigint | null = null;
  if (body.albumId !== undefined && body.albumId !== null) {
    const parsed = parseBigInt(body.albumId);
    if (parsed === null) {
      return NextResponse.json(
        { error: "유효하지 않은 앨범 ID입니다." },
        { status: 400 },
      );
    }
    albumId = parsed;
  }

  const sourceUrl =
    typeof body.sourceUrl === "string" && body.sourceUrl.trim()
      ? body.sourceUrl.trim()
      : null;
  const notes =
    typeof body.notes === "string" && body.notes.trim()
      ? body.notes.trim()
      : null;

  try {
    const job = await prisma.albumBonusImportJob.create({
      data: {
        albumId,
        sourceUrl,
        notes,
        candidates: candidates as unknown as Prisma.InputJsonValue,
        decisions: EMPTY_DECISIONS as unknown as Prisma.InputJsonValue,
      },
    });

    // Compute initial classifications so the operator sees the
    // insert/update breakdown immediately on upload, even before
    // they navigate to the review page.
    const classifications = await classifyJob(albumId, candidates);

    return NextResponse.json(
      {
        job: serializeBigInt(job),
        classifications,
      },
      { status: 201 },
    );
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2003"
    ) {
      // albumId FK miss — the pre-selected album doesn't exist.
      return NextResponse.json(
        { error: "앨범을 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    throw e;
  }
}

async function classifyJob(
  albumId: bigint | null,
  candidates: Parameters<typeof reconcile>[0],
) {
  if (!albumId) {
    // No album resolved yet — every listing is necessarily an insert
    // (nothing to match against). Skip the DB roundtrip.
    return reconcile(candidates, []);
  }
  const listings = await prisma.albumStoreListing.findMany({
    where: { albumId },
    select: {
      id: true,
      originalStoreName: true,
      originalEditionLabel: true,
      productUrl: true,
      bonuses: {
        select: { id: true, originalBonusType: true },
      },
    },
  });
  // Prisma row shape ↔ ExistingListingRow shape match exactly; cast
  // is for clarity, no runtime work.
  return reconcile(candidates, listings as ExistingListingRow[]);
}

/**
 * GET /api/admin/album-bonuses/import
 *
 * List jobs for the review queue. Returns minimal rows — full
 * candidates JSON loads only on the per-job GET. Sorted newest-first.
 *
 *   Query: ?status=pending|applied|discarded (default = pending)
 *
 *   → 200 { jobs: [...] }
 *   → 401 unauthorized
 */
export async function GET(request: NextRequest) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status =
    statusParam === "applied" || statusParam === "discarded"
      ? statusParam
      : "pending";

  const jobs = await prisma.albumBonusImportJob.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      albumId: true,
      sourceUrl: true,
      status: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      appliedAt: true,
      discardedAt: true,
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

  return NextResponse.json({ jobs: serializeBigInt(jobs) });
}
