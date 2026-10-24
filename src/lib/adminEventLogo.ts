import { prisma } from "@/lib/prisma";
import {
  ADMIN_ASSET_SELECT,
  ADMIN_LOGO_TX_OPTIONS,
  adminAssetJson,
  adminPreview,
  attemptEvidence,
  seriesAdminName,
  type AdminLogoPreview,
  type AdminSeriesLogoState,
} from "@/lib/adminLogo";
import {
  LOGO_EVENT_SELECT,
  LOGO_SERIES_SELECT,
  buildLogoSeriesGraph,
  explainEventLogo,
  type LogoEventInput,
  type LogoSeriesGraph,
} from "@/lib/logoResolution";
import { findAttemptAsset } from "@/lib/imageUpload/attemptLookup";

// Admin read model of an event's logo override card — the event
// counterpart of `getSeriesLogoAdminState` (adminLogo.ts), returning the
// same shape so the shared LogoAssignmentCard drives both. The rules
// carried over from there, for the same reasons:
//
// - ONE repeatable-read transaction: the attempt evidence, the event's
//   assignment and the series graph come from one snapshot, so "my asset
//   row exists" is never paired with an assignment read at another moment
//   (a phantom supersede), and the applied result is never computed from
//   an older graph than the setting shown next to it.
// - Uncached: the public graph cache can trail a series edit by up to its
//   TTL if an invalidation is ever lost; the admin card must show what is
//   stored now.
// - Previews run the public resolver on the event with ONLY its own mode
//   replaced by the draft. An event's "inherit" preview is therefore the
//   walk from its series — the same walk the public pages run for it —
//   never a copied series result.
//
// What differs from the series card: the deciding node can be the event
// itself (its own custom / typography), which the preview reports as an
// `isSelf` source named after the event; otherwise the source is the
// series that decided, named like on the series card.
//
// Server-only (reads provenance); the route returns it to the admin form.

export type AdminEventLogoState = Omit<AdminSeriesLogoState, "seriesId"> & {
  eventId: string;
};

/**
 * Current logo state of a live event, or null when it is absent or
 * soft-deleted. `attemptId` (validated) adds the attempt evidence; pass
 * it only when reconciling.
 */
export async function getEventLogoAdminState(
  eventId: bigint,
  attemptId: string | null = null,
): Promise<AdminEventLogoState | null> {
  return prisma.$transaction(
    async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: eventId, isDeleted: false },
        select: {
          ...LOGO_EVENT_SELECT,
          // Widened to the admin columns for the card. The resolver reads
          // only publicUrl/width/height from it, and `explain` below
          // returns only the URL, so provenance stays in `asset`.
          logoAsset: { select: ADMIN_ASSET_SELECT },
          logoAssetId: true,
          originalName: true,
        },
      });
      if (!event) return null;
      const assignment = { mode: event.logoMode, assetId: event.logoAssetId };
      const evidence = attemptId
        ? attemptEvidence(await findAttemptAsset(tx, "event-logo", eventId, attemptId), assignment)
        : null;

      const graph = buildLogoSeriesGraph(await tx.eventSeries.findMany({ select: LOGO_SERIES_SELECT }));
      const names = new Map<string, string>();
      const explain = async (input: LogoEventInput, g: LogoSeriesGraph): Promise<AdminLogoPreview> => {
        const { decision, source } = explainEventLogo(input, g);
        let named: AdminLogoPreview["source"] = null;
        if (source === "event") {
          named = { id: `event:${eventId}`, name: event.originalName ?? `#${eventId}`, isSelf: true };
        } else if (source) {
          const key = source.seriesId.toString();
          if (!names.has(key)) names.set(key, await seriesAdminName(tx, source.seriesId));
          named = { id: key, name: names.get(key)!, isSelf: false };
        }
        return adminPreview(decision, named);
      };

      return {
        eventId: eventId.toString(),
        assignment,
        asset: event.logoAsset ? adminAssetJson(event.logoAsset) : null,
        applied: await explain(event, graph),
        previews: {
          inherit: await explain({ ...event, logoMode: "inherit", logoAsset: null }, graph),
          typography: await explain({ ...event, logoMode: "typography", logoAsset: null }, graph),
        },
        attempt: evidence,
      };
    },
    ADMIN_LOGO_TX_OPTIONS,
  );
}
