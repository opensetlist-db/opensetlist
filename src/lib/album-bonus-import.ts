// Shared types + reconciliation logic for b10 (Bonus scrape automation).
//
// Three actors share these definitions:
//
// 1. `wiki/scrape/bonus/fetch-bonus.mjs` — emits ParsedCandidates JSON.
//    The vault script is dependency-free, so the TS types here are NOT
//    imported there; treat the on-disk shape as the contract and keep
//    these types in sync manually (covered by the Step-5 snapshot test).
// 2. POST /api/admin/album-bonuses/import — stores ParsedCandidates
//    verbatim in AlbumBonusImportJob.candidates; computes initial
//    classifications for the response but does NOT persist them.
// 3. GET /api/admin/album-bonuses/import/[jobId] — recomputes
//    classifications fresh against current DB state before serving
//    the review UI, so a long-deferred review reflects today's data.
//
// `Decisions` is the only mutable per-job state. The operator's
// approve/reject choices live on AlbumBonusImportJob.decisions, keyed
// by stable array indices into the frozen `candidates` document.

import type { Prisma } from "@/generated/prisma/client";

// ── Parsed candidates (matches wiki/scrape/bonus/pattern-notes.md §12)

export type ParsedBonus = {
  originalBonusType: string;
  originalBonusDescription: string | null;
  bonusImageUrl: string | null;
};

export type ParsedListing = {
  originalStoreName: string;
  originalEditionLabel: string | null;
  productUrl: string | null;
  bonuses: ParsedBonus[];
};

export type ParsedGlobalEarlyBookingItem = {
  originalBonusType: string;
  originalBonusDescription: string | null;
  bonusImageUrl: string | null;
  storeNameHint: string | null;
};

export type ParsedCandidates = {
  sourceUrl: string | null;
  parsedAt: string;
  albumTitleGuess: string | null;
  releaseDateGuess: string | null;
  listings: ParsedListing[];
  globalEarlyBooking: { bonuses: ParsedGlobalEarlyBookingItem[] } | null;
  warnings: string[];
};

// ── Decisions (persisted on the job row)

export type ListingDecisionKey = number; // listing index in candidates.listings
export type BonusDecisionKey = `${number}:${number}`; // `${listingIdx}:${bonusIdx}`

export type Decisions = {
  // Operator approval per-listing. true = include this listing+its
  // approved bonuses on apply; false = skip the whole listing.
  // Missing key = pending (treated as not-yet-decided in UI; apply
  // refuses to run while any required decision is missing).
  listings: Record<ListingDecisionKey, { approved: boolean }>;
  bonuses: Record<BonusDecisionKey, { approved: boolean }>;
  // Global early-booking block (when present) gets a single shared
  // decision; the operator can either reject or attach it to one or
  // more listings via `attachToListings`. MVP supports attach-to-one
  // only; multi-listing attachment can come later.
  globalEarlyBooking: {
    approved: boolean;
    attachToListings: ListingDecisionKey[]; // indices to fan out under
  } | null;
};

export const EMPTY_DECISIONS: Decisions = {
  listings: {},
  bonuses: {},
  globalEarlyBooking: null,
};

// ── Classification (computed fresh; never persisted)

export type ListingClassificationKind =
  | "insert" // no existing listing matches; create
  | "update-changed" // existing listing matches, at least one field differs
  | "update-noop"; // existing listing matches and all surfaced fields equal

export type BonusClassificationKind =
  | "insert"
  | "update-noop";
// Bonuses can match-update only on (listingId, originalBonusType)
// EXACT — anything else is treated as a fresh variant insert (per
// pattern-notes §5). So there is no `update-changed` for bonuses:
// an exact match is by definition a noop, and a non-match inserts.

export type ListingClassification = {
  listingIdx: number;
  kind: ListingClassificationKind;
  matchedListingId: string | null;
  // What's different between candidate and existing. Empty array on
  // insert + update-noop; populated on update-changed.
  diffs: Array<{ field: "productUrl"; from: string | null; to: string | null }>;
};

export type BonusClassification = {
  listingIdx: number;
  bonusIdx: number;
  kind: BonusClassificationKind;
  matchedBonusId: string | null;
};

export type Classifications = {
  listings: ListingClassification[];
  bonuses: BonusClassification[];
  // Listings on the album that aren't referenced by this candidate set.
  // Surfaced for operator awareness only — apply does NOT touch them
  // (the news page can't speak to a listing it doesn't mention; that's
  // a different signal than "this listing ended").
  unreferencedListings: Array<{ listingId: string; originalStoreName: string }>;
};

// Subset of AlbumStoreListing rows the reconciler needs. `sourceUrl`
// is optional — only the apply path reads it (to decide whether to
// propagate the job's sourceUrl onto an existing row that has none).
export type ExistingListingRow = {
  id: string;
  originalStoreName: string;
  originalEditionLabel: string | null;
  productUrl: string | null;
  sourceUrl?: string | null;
  bonuses: Array<{ id: string; originalBonusType: string }>;
};

// ── Reconciler

export function reconcile(
  candidates: ParsedCandidates,
  existing: ExistingListingRow[],
): Classifications {
  const listingsResult: ListingClassification[] = [];
  const bonusesResult: BonusClassification[] = [];
  const referencedListingIds = new Set<string>();

  // Index existing listings by their matching key.
  const existingByKey = new Map<string, ExistingListingRow>();
  for (const row of existing) {
    existingByKey.set(listingKey(row.originalStoreName, row.originalEditionLabel), row);
  }

  for (let listingIdx = 0; listingIdx < candidates.listings.length; listingIdx++) {
    const cand = candidates.listings[listingIdx];
    const key = listingKey(cand.originalStoreName, cand.originalEditionLabel);
    const match = existingByKey.get(key) ?? null;

    if (!match) {
      listingsResult.push({
        listingIdx,
        kind: "insert",
        matchedListingId: null,
        diffs: [],
      });
    } else {
      referencedListingIds.add(match.id);
      const diffs: ListingClassification["diffs"] = [];
      const candUrl = cand.productUrl ?? null;
      // productUrl is the only field the parser surfaces that we'd
      // want to update on an existing row. originalStoreName /
      // originalEditionLabel are the matching keys, so by definition
      // they don't differ between candidate and match.
      if (candUrl !== null && candUrl !== match.productUrl) {
        diffs.push({ field: "productUrl", from: match.productUrl, to: candUrl });
      }
      listingsResult.push({
        listingIdx,
        kind: diffs.length ? "update-changed" : "update-noop",
        matchedListingId: match.id,
        diffs,
      });
    }

    // Bonus reconciliation: match on (listingId, originalBonusType)
    // exact. No diff/update — schema design says variants are
    // intentional duplicates, so a near-miss is an insert candidate.
    const existingBonusesForListing = match?.bonuses ?? [];
    for (let bonusIdx = 0; bonusIdx < cand.bonuses.length; bonusIdx++) {
      const bonus = cand.bonuses[bonusIdx];
      const existingBonus = existingBonusesForListing.find(
        (b) => b.originalBonusType === bonus.originalBonusType,
      );
      bonusesResult.push({
        listingIdx,
        bonusIdx,
        kind: existingBonus ? "update-noop" : "insert",
        matchedBonusId: existingBonus?.id ?? null,
      });
    }
  }

  // Existing-but-unreferenced: surface as awareness only. The parser
  // can't speak to "did the bonus end" — that's a separate retailer-
  // side signal, intentionally out of scope (see pattern-notes §11).
  const unreferencedListings = existing
    .filter((row) => !referencedListingIds.has(row.id))
    .map((row) => ({ listingId: row.id, originalStoreName: row.originalStoreName }));

  return { listings: listingsResult, bonuses: bonusesResult, unreferencedListings };
}

function listingKey(storeName: string, editionLabel: string | null): string {
  return `${storeName} ${editionLabel ?? ""}`;
}

// ── Validation helpers used by API routes

/**
 * Shallow shape check for ParsedCandidates JSON received via POST.
 * Reject anything that doesn't match the contract — the parser is
 * trusted, but the endpoint accepts arbitrary JSON so a hand-crafted
 * malformed payload must fail loudly before it gets persisted.
 */
export function isParsedCandidates(v: unknown): v is ParsedCandidates {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.listings)) return false;
  if (!Array.isArray(o.warnings)) return false;
  for (const l of o.listings) {
    if (!l || typeof l !== "object") return false;
    const ll = l as Record<string, unknown>;
    if (typeof ll.originalStoreName !== "string") return false;
    if (ll.originalEditionLabel !== null && typeof ll.originalEditionLabel !== "string") return false;
    if (!Array.isArray(ll.bonuses)) return false;
    for (const b of ll.bonuses) {
      if (!b || typeof b !== "object") return false;
      const bb = b as Record<string, unknown>;
      if (typeof bb.originalBonusType !== "string") return false;
    }
  }
  return true;
}

/**
 * Cast-aware reader for the JSON column. Prisma types `Json` as
 * `Prisma.JsonValue` which is wide on purpose; callers know the
 * shape because POST validated it before write. This helper
 * centralizes the cast so route code stays clean.
 */
export function readCandidates(json: Prisma.JsonValue): ParsedCandidates {
  return json as unknown as ParsedCandidates;
}

export function readDecisions(json: Prisma.JsonValue | null): Decisions {
  if (!json) return { ...EMPTY_DECISIONS };
  return json as unknown as Decisions;
}
