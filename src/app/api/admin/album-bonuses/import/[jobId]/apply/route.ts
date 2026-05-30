import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { randomUUID } from "node:crypto";
import {
  normalizeBonusTranslations,
  normalizeListingTranslations,
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
    // Atomically claim the job. updateMany with the status filter
    // is the standard "compare-and-set" pattern: exactly one
    // concurrent apply transitions pending→applied; the loser sees
    // count=0 and bails out without writing anything. Without this,
    // two parallel applies (double-click on the operator's "적용"
    // button, or a stuck spinner re-submit) would both pass the
    // earlier findUnique gate and double-insert every approved row.
    // AlbumStoreBonus has no unique constraint by design (variants
    // are intentional duplicates), so dup inserts would persist
    // silently — atomic claim closes that hole.
    const claimed = await tx.albumBonusImportJob.updateMany({
      where: { id: job.id, status: "pending" },
      data: { status: "applied", appliedAt: new Date() },
    });
    if (claimed.count === 0) {
      return { conflict: true as const };
    }

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

    // Cache of existing bonus.originalBonusType per existing listing,
    // used by the globalEarlyBooking fan-out below to skip rows that
    // would duplicate an existing bonus on a matched listing.
    // Freshly-inserted listings (created later in this tx) are
    // intentionally absent from the cache — they have no existing
    // bonuses to clash with.
    const existingBonusTypesByListingId = new Map<string, Set<string>>();
    for (const e of existing) {
      existingBonusTypesByListingId.set(
        e.id,
        new Set(e.bonuses.map((b) => b.originalBonusType)),
      );
    }

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
        // Listing inserts use nested `translations.create` rather than
        // a separate createMany — already one create per listing (we
        // need the returned id for the bonus-loop's listingIdByIdx),
        // so the nested syntax adds no round-trips. Bonus translations
        // can't use the same trick because bonuses go through
        // createMany (no nested writes), see the bonus loop below.
        const candTranslations = normalizeListingTranslations(cand.translations);
        const created = await tx.albumStoreListing.create({
          data: {
            albumId: job.albumId!,
            originalStoreName: cand.originalStoreName,
            originalEditionLabel: cand.originalEditionLabel,
            originalLanguage: "ja",
            productUrl: cand.productUrl,
            status: "unknown",
            sourceUrl: job.sourceUrl ?? undefined,
            translations: candTranslations.length
              ? { create: candTranslations }
              : undefined,
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

    // Collect all approved-insert bonus rows into one array, then
    // emit a single createMany. Sequential .create() inside the
    // loop would issue one round-trip per bonus (N+1) — for a
    // 10-store BD release with one bonus each, that's 10 extra
    // queries inside a transaction holding row locks. Batch it.
    //
    // Translations need a parallel pre-generated id pattern because
    // createMany doesn't accept nested writes: we explicitly assign
    // `id: randomUUID()` per bonus row (overriding @default(uuid())
    // at the column), then build the translation rows keyed by the
    // same uuid, and emit them as a SECOND createMany after the
    // bonuses land. Two round-trips total, no matter how many
    // bonuses or translations.
    const bonusInserts: Array<Prisma.AlbumStoreBonusCreateManyInput> = [];
    const bonusTranslationInserts: Array<Prisma.AlbumStoreBonusTranslationCreateManyInput> =
      [];

    for (const bc of classifications.bonuses) {
      const decision = decisions.bonuses[`${bc.listingIdx}:${bc.bonusIdx}`];
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
      const bonusId = randomUUID();
      bonusInserts.push({
        id: bonusId,
        listingId,
        originalBonusType: bonus.originalBonusType,
        originalBonusDescription: bonus.originalBonusDescription,
        originalLanguage: "ja",
        bonusImageUrl: bonus.bonusImageUrl,
      });
      for (const t of normalizeBonusTranslations(bonus.translations)) {
        bonusTranslationInserts.push({
          bonusId,
          locale: t.locale,
          bonusType: t.bonusType,
          bonusDescription: t.bonusDescription,
        });
      }
    }

    // Global early-booking fan-out — flatten the (attachTo × items)
    // cartesian product into the same insert batch for one round-trip.
    //
    // Unlike the regular bonus loop above (where reconcile classifies
    // each candidate against existing rows), globalEarlyBooking
    // candidates have no per-row classification — the parser emits
    // them as "unattached" and the operator picks the attach targets
    // at review time. So we dedupe here against the existing-bonus
    // cache: if the target listing already has a bonus with the same
    // originalBonusType, skip the insert rather than creating a dup.
    if (
      decisions.globalEarlyBooking?.approved &&
      candidates.globalEarlyBooking?.bonuses?.length
    ) {
      // Dedupe attachToListings before the fan-out. The
      // existingBonusTypesByListingId cache only holds listings that
      // existed at tx start — so for a freshly-inserted target listing
      // (idx not in the cache, existingTypes resolves to null), the
      // per-item dedup branch is skipped and the bonus would be
      // pushed once per duplicate entry in attachToListings. The UI
      // currently doesn't prevent the operator from selecting the
      // same listing twice; collapsing here is the safe belt-suspenders.
      const attachTo = [
        ...new Set(decisions.globalEarlyBooking.attachToListings ?? []),
      ];
      for (const targetIdx of attachTo) {
        const targetListingId = listingIdByIdx.get(targetIdx);
        if (!targetListingId) continue;
        const existingTypes =
          existingBonusTypesByListingId.get(targetListingId) ?? null;
        for (const item of candidates.globalEarlyBooking.bonuses) {
          if (existingTypes && existingTypes.has(item.originalBonusType)) {
            // Already exists on this listing — skip to keep the
            // schema-level "variants are intentional duplicates"
            // contract from spreading to early-booking accidentally.
            continue;
          }
          const bonusId = randomUUID();
          bonusInserts.push({
            id: bonusId,
            listingId: targetListingId,
            originalBonusType: item.originalBonusType,
            originalBonusDescription: item.originalBonusDescription,
            originalLanguage: "ja",
            bonusImageUrl: item.bonusImageUrl,
          });
          for (const t of normalizeBonusTranslations(item.translations)) {
            bonusTranslationInserts.push({
              bonusId,
              locale: t.locale,
              bonusType: t.bonusType,
              bonusDescription: t.bonusDescription,
            });
          }
        }
      }
    }

    if (bonusInserts.length > 0) {
      await tx.albumStoreBonus.createMany({ data: bonusInserts });
      bonusesInserted = bonusInserts.length;
    }
    if (bonusTranslationInserts.length > 0) {
      await tx.albumStoreBonusTranslation.createMany({
        data: bonusTranslationInserts,
      });
    }

    // Job status flip happened at the top of the tx via the atomic
    // claim. Don't update again — would just rewrite appliedAt.

    return { listingsInserted, listingsUpdated, bonusesInserted };
  });

  if ("conflict" in result) {
    return NextResponse.json(
      { error: "이 작업은 이미 처리되었습니다." },
      { status: 409 },
    );
  }

  return NextResponse.json({ applied: serializeBigInt(result) });
}
