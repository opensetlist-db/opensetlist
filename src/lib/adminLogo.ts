import { Prisma } from "@/generated/prisma/client";
import type { LogoDisplayMode } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  LOGO_SERIES_SELECT,
  buildLogoSeriesGraph,
  explainSeriesLogo,
  type LogoDecision,
  type LogoSeriesNode,
} from "@/lib/logoResolution";
import { ACCEPTED_IMAGE_FORMATS } from "@/lib/imageUpload/limits";
import { buildObjectKey } from "@/lib/imageUpload/keys";

// Admin read model of a series' logo card: the local assignment, its
// asset (WITH admin-only provenance), what the public resolver makes of
// it, what it would make of the two draft modes, and — after a lost
// upload response — the evidence the form needs to classify its attempt.
//
// Everything is read in ONE repeatable-read transaction. The attempt
// evidence and the current assignment must come from the same snapshot:
// "my asset row exists" and "the series does not hold it" read at two
// different moments could pair a row committed after the first read with
// an assignment read before it, and the form would report a supersede
// that never happened (or miss one). The graph rows ride along in the
// same snapshot so the card never shows a current setting next to an
// applied result computed from an older graph. Uncached on purpose — the
// public graph cache can be up to an hour stale; the card must not be.
//
// Previews are computed by the same resolver as the public pages, on the
// graph with ONLY this series' node replaced by the draft mode. Copying
// the parent's resolved result instead would be wrong in two ways: a
// cycle through this series would surface its saved custom logo under an
// "inherit" draft (the real result is broken-chain), and the depth bound
// depends on where the walk starts.
//
// This module is server-only (it reads provenance); the route returns its
// result to the admin form only.

export type AdminLogoAssignment = { mode: LogoDisplayMode; assetId: string | null };

export type AdminLogoAsset = {
  id: string;
  publicUrl: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  sourceUrl: string | null;
  usageNote: string | null;
  createdAt: string;
};

export type AdminLogoReason =
  | "custom" // a node's own custom logo applies
  | Extract<LogoDecision, { kind: "typography" }>["reason"];

export type AdminLogoPreview = {
  /** Usable logo URL, or null = typography. */
  imageUrl: string | null;
  reason: AdminLogoReason;
  /** The series that decided (null for exhausted / broken chain). */
  source: { id: string; name: string; isSelf: boolean } | null;
};

/**
 * What a re-read found out about one upload attempt (same vocabulary as
 * the album cover card):
 *   committed   — its ImageAsset row exists (asset and assignment commit
 *                 together, so the row proves the commit); `held` says
 *                 whether the series still holds it;
 *   not-observed — no row at read time. NOT proof of failure: a request
 *                 still in flight may commit later;
 *   ambiguous   — more than one row for the attempt (only objectKey is
 *                 unique, so two extensions of one attempt are not ruled
 *                 out by the schema); the form keeps the outcome unknown;
 *   unavailable — the storage namespace is not configured (or is
 *                 misconfigured) here, so the attempt's keys cannot be
 *                 rebuilt. NOT "could not have committed": an earlier
 *                 deployment, or the request itself, may have read a
 *                 working configuration.
 */
export type AdminAttemptEvidence =
  | { state: "committed"; assetId: string; held: boolean }
  | { state: "not-observed" }
  | { state: "ambiguous" }
  | { state: "unavailable" };

export type AdminSeriesLogoState = {
  seriesId: string;
  assignment: AdminLogoAssignment;
  asset: AdminLogoAsset | null;
  applied: AdminLogoPreview;
  previews: { inherit: AdminLogoPreview; typography: AdminLogoPreview };
  attempt: AdminAttemptEvidence | null;
};

const ADMIN_ASSET_SELECT = {
  id: true,
  publicUrl: true,
  mimeType: true,
  byteSize: true,
  width: true,
  height: true,
  sourceUrl: true,
  usageNote: true,
  createdAt: true,
} as const;

/** Every key the upload service could have written for this attempt. */
export function seriesLogoAttemptKeys(keyPrefix: string, seriesId: bigint, attemptId: string): string[] {
  // Built with the service's own key builder over the accepted formats'
  // extensions, so the lookup can never drift from what POST writes.
  return Object.values(ACCEPTED_IMAGE_FORMATS).map(({ ext }) =>
    buildObjectKey({ prefix: keyPrefix, segment: "series-logo", targetId: seriesId, attemptId, ext }),
  );
}

function withDraft(
  rows: LogoSeriesNode[],
  seriesId: bigint,
  mode: "inherit" | "typography",
): LogoSeriesNode[] {
  return rows.map((r) => (r.id === seriesId ? { ...r, logoMode: mode, logoAsset: null } : r));
}

/**
 * Current logo state of a live series, or null when it is absent or
 * soft-deleted. `attempt` (validated attempt id + the storage key prefix)
 * adds the attempt evidence; pass it only when reconciling.
 */
export async function getSeriesLogoAdminState(
  seriesId: bigint,
  attempt: { attemptId: string; keyPrefix: string | null } | null = null,
): Promise<AdminSeriesLogoState | null> {
  return prisma.$transaction(
    async (tx) => {
      const series = await tx.eventSeries.findFirst({
        where: { id: seriesId, isDeleted: false },
        select: { logoMode: true, logoAssetId: true, logoAsset: { select: ADMIN_ASSET_SELECT } },
      });
      if (!series) return null;

      let evidence: AdminAttemptEvidence | null = null;
      if (attempt) {
        if (!attempt.keyPrefix) {
          evidence = { state: "unavailable" };
        } else {
          const rows = await tx.imageAsset.findMany({
            where: { objectKey: { in: seriesLogoAttemptKeys(attempt.keyPrefix, seriesId, attempt.attemptId) } },
            select: { id: true },
          });
          evidence =
            rows.length === 0
              ? { state: "not-observed" }
              : rows.length === 1
                ? {
                    state: "committed",
                    assetId: rows[0].id,
                    held: series.logoMode === "custom" && series.logoAssetId === rows[0].id,
                  }
                : { state: "ambiguous" };
        }
      }

      const rows = await tx.eventSeries.findMany({ select: LOGO_SERIES_SELECT });
      const names = new Map<string, string>();
      const explain = async (graphRows: LogoSeriesNode[]): Promise<AdminLogoPreview> => {
        const { decision, sourceSeriesId } = explainSeriesLogo(seriesId, buildLogoSeriesGraph(graphRows));
        let source: AdminLogoPreview["source"] = null;
        if (sourceSeriesId !== null) {
          const key = sourceSeriesId.toString();
          if (!names.has(key)) names.set(key, await seriesAdminName(tx, sourceSeriesId));
          source = { id: key, name: names.get(key)!, isSelf: sourceSeriesId === seriesId };
        }
        return decision.kind === "custom"
          ? { imageUrl: decision.image.url, reason: "custom", source }
          : { imageUrl: null, reason: decision.reason, source };
      };

      const asset = series.logoAsset;
      return {
        seriesId: seriesId.toString(),
        assignment: { mode: series.logoMode, assetId: series.logoAssetId },
        asset: asset ? { ...asset, createdAt: asset.createdAt.toISOString() } : null,
        applied: await explain(rows),
        previews: {
          inherit: await explain(withDraft(rows, seriesId, "inherit")),
          typography: await explain(withDraft(rows, seriesId, "typography")),
        },
        attempt: evidence,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

/** Korean admin label of a series: ko translation, else the original. */
async function seriesAdminName(tx: Prisma.TransactionClient, id: bigint): Promise<string> {
  const row = await tx.eventSeries.findUnique({
    where: { id },
    select: { originalName: true, translations: { where: { locale: "ko" }, select: { name: true } } },
  });
  return row?.translations[0]?.name ?? row?.originalName ?? `#${id}`;
}
