import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { verifyAdminAPI } from "@/lib/admin-auth";
import {
  readCandidates,
  readDecisions,
  reconcile,
  type ExistingListingRow,
} from "@/lib/album-bonus-import";

type RouteProps = { params: Promise<{ jobId: string }> };

/**
 * POST /api/admin/album-bonuses/import/[jobId]/apply
 *
 * Writes the operator-approved candidates from a pending job. Runs in a
 * single transaction so a partial failure rolls back the entire apply —
 * either every approved row lands or none do.
 *
 * Decisions semantics:
 *
 * - Listing approved + classification `insert`        → create new AlbumStoreListing
 * - Listing approved + classification `update-changed` → update productUrl on existing
 * - Listing approved + classification `update-noop`    → no listing write; bonuses still process
 * - Listing approved=false / missing decision          → skip listing AND its child bonuses
 *
 * - Bonus approved + classification `insert`           → create new AlbumStoreBonus
 * - Bonus approved + classification `update-noop`      → no-op (already exists with same originalBonusType)
 * - Bonus approved=false / missing decision            → skip
 *
 * Classifications are recomputed fresh against current DB state at the
 * top of the transaction — not read from the cached classifications a
 * GET might have served the review UI minutes ago. Concurrent edits to
 * the underlying listings are rare (single operator) but the freshness
 * matters when a job has been queued for days.
 *
 * `lastVerifiedAt` is NOT touched (pattern-notes §11). `sourceUrl`
 * propagates from the job to new AlbumStoreListing rows so the
 * provenance pointer survives.
 *
 *   → 200 { applied: { listingsInserted, listingsUpdated, bonusesInserted } }
 *   → 400 albumId missing on job
 *   → 401 unauthorized
 *   → 404 job not found
 *   → 409 job not pending
 */
export async function POST(_request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { jobId } = await params;
  if (!jobId) {
    return NextResponse.json({ error: "잘못된 ID입니다." }, { status: 400 });
  }

  const job = await prisma.albumBonusImportJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      albumId: true,
      sourceUrl: true,
      candidates: true,
      decisions: true,
    },
  });
  if (!job) {
    return NextResponse.json(
      { error: "임포트 작업을 찾을 수 없습니다." },
      { status: 404 },
    );
  }
  if (job.status !== "pending") {
    return NextResponse.json(
      { error: `이 작업은 이미 ${job.status} 상태입니다.` },
      { status: 409 },
    );
  }
  if (!job.albumId) {
    return NextResponse.json(
      { error: "앨범이 선택되지 않았습니다. 먼저 앨범을 지정하세요." },
      { status: 400 },
    );
  }

  const candidates = readCandidates(job.candidates);
  const decisions = readDecisions(job.decisions);

  // ── Transactional apply ─────────────────────────────────────────
  // Fresh classification inside the tx so concurrent DB edits don't
  // race the apply. The reconcile call is cheap (one findMany +
  // in-memory diff); doing it inside the tx costs ~one extra query
  // but eliminates the race window completely.
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.albumStoreListing.findMany({
      where: { albumId: job.albumId! },
      select: {
        id: true,
        originalStoreName: true,
        originalEditionLabel: true,
        productUrl: true,
        sourceUrl: true,
        bonuses: { select: { id: true, originalBonusType: true } },
      },
    });
    const classifications = reconcile(
      candidates,
      existing as ExistingListingRow[],
    );

    let listingsInserted = 0;
    let listingsUpdated = 0;
    let bonusesInserted = 0;

    // Track listing IDs per candidate index so the bonus loop can
    // attach to the right listing (existing-matched OR freshly-inserted).
    const listingIdByIdx = new Map<number, string>();

    for (const lc of classifications.listings) {
      const decision = decisions.listings[lc.listingIdx];
      const approved = decision?.approved === true;
      const cand = candidates.listings[lc.listingIdx];

      if (lc.kind === "update-noop" || lc.kind === "update-changed") {
        // Even when not approved for write, we still need the matched
        // listingId so that already-existing bonuses on this listing
        // can be referenced by the bonus loop's `update-noop`
        // classification. Otherwise we'd lose the linkage entirely.
        if (lc.matchedListingId) {
          listingIdByIdx.set(lc.listingIdx, lc.matchedListingId);
        }
      }

      if (!approved) continue;

      if (lc.kind === "insert") {
        const created = await tx.albumStoreListing.create({
          data: {
            albumId: job.albumId!,
            originalStoreName: cand.originalStoreName,
            originalEditionLabel: cand.originalEditionLabel,
            originalLanguage: "ja",
            productUrl: cand.productUrl,
            status: "unknown",
            sourceUrl: job.sourceUrl ?? undefined,
          },
          select: { id: true },
        });
        listingIdByIdx.set(lc.listingIdx, created.id);
        listingsInserted++;
      } else if (lc.kind === "update-changed" && lc.matchedListingId) {
        const updates: Prisma.AlbumStoreListingUpdateInput = {};
        for (const diff of lc.diffs) {
          if (diff.field === "productUrl") updates.productUrl = diff.to;
        }
        // Propagate sourceUrl if the existing row is missing one.
        // Don't overwrite an existing sourceUrl — it may have been
        // set manually with intent. (NOT lastVerifiedAt — per spec.)
        const existingRow = existing.find((e) => e.id === lc.matchedListingId);
        if (existingRow && !existingRow.sourceUrl && job.sourceUrl) {
          updates.sourceUrl = job.sourceUrl;
        }
        await tx.albumStoreListing.update({
          where: { id: lc.matchedListingId },
          data: updates,
        });
        listingsUpdated++;
      }
    }

    for (const bc of classifications.bonuses) {
      const decision = decisions.bonuses[`${bc.listingIdx}:${bc.bonusIdx}` as const];
      const approved = decision?.approved === true;
      if (!approved) continue;
      if (bc.kind !== "insert") continue;

      // Need a listingId — either from the matched listing or the
      // freshly-inserted one. If the operator approved a bonus but
      // rejected its parent listing (and there was no existing
      // matched listing), we have nowhere to attach. Skip and let
      // the operator re-review.
      const listingId = listingIdByIdx.get(bc.listingIdx);
      if (!listingId) continue;

      const bonus = candidates.listings[bc.listingIdx].bonuses[bc.bonusIdx];
      await tx.albumStoreBonus.create({
        data: {
          listingId,
          originalBonusType: bonus.originalBonusType,
          originalBonusDescription: bonus.originalBonusDescription,
          originalLanguage: "ja",
          bonusImageUrl: bonus.bonusImageUrl,
        },
      });
      bonusesInserted++;
    }

    // Global early-booking fan-out. Each attached listing gets one
    // new bonus row per global item.
    if (
      decisions.globalEarlyBooking?.approved &&
      candidates.globalEarlyBooking?.bonuses?.length
    ) {
      const attachTo = decisions.globalEarlyBooking.attachToListings ?? [];
      for (const targetIdx of attachTo) {
        const targetListingId = listingIdByIdx.get(targetIdx);
        if (!targetListingId) continue;
        for (const item of candidates.globalEarlyBooking.bonuses) {
          await tx.albumStoreBonus.create({
            data: {
              listingId: targetListingId,
              originalBonusType: item.originalBonusType,
              originalBonusDescription: item.originalBonusDescription,
              originalLanguage: "ja",
              bonusImageUrl: item.bonusImageUrl,
            },
          });
          bonusesInserted++;
        }
      }
    }

    await tx.albumBonusImportJob.update({
      where: { id: job.id },
      data: {
        status: "applied",
        appliedAt: new Date(),
      },
    });

    return { listingsInserted, listingsUpdated, bonusesInserted };
  });

  return NextResponse.json({ applied: serializeBigInt(result) });
}
