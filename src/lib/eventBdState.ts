// EventBdSection state machine + bonus selector.
//
// The component renders one of five visual variants on the Event
// detail page (between Setlist and Impressions). Which variant fires
// depends on (a) whether `Event.bdAlbumId` resolves to an Album row,
// (b) the time delta from `event.startTime` (D+N bucketing), and
// (c) the lifecycle of the linked Album's listings/bonuses.
//
// Six states total — 3 are pre-link buckets keyed purely on time,
// 3 are post-link buckets keyed on the album's release/bonus state:
//
//   pre              event hasn't happened / ongoing  → render nothing
//   immediate_post   event done, < D+60               → render nothing
//   long_mid         event done, >= D+60, no album    → light teaser
//   bd_announced     album linked, no active bonus,   → album card +
//                    not yet released                    "details" CTA
//   bd_preorder      album linked, has active bonus,  → album card +
//                    not yet released                    bonus preview +
//                                                        "compare" CTA
//   bd_released      album.releaseDate ≤ now           → album card +
//                                                        bonus preview
//                                                        (may be empty) +
//                                                        "purchase" CTA
//
// `bd_released` also absorbs the spec's old `bd_postrelease` case
// (released + all bonuses ended): the variant collapses its bonus
// block when `selectTopBonuses` returns empty, so the same enum
// covers both lifecycles without forcing a 7th state.
//
// State machine references:
//   - wiki/output/task-b07-event-bd-section.md
//   - wiki/output/task-event-bd-section.md
//   - F:/work/vaults/opensetlist/raw/mockups/event-page-v2-mockup.jsx
//     (mockup is the authoritative visual reference)
import type {
  AlbumStoreListingStatus,
  EventStatus,
} from "@/generated/prisma/enums";

export type EventBdState =
  | "pre"
  | "immediate_post"
  | "long_mid"
  | "bd_announced"
  | "bd_preorder"
  | "bd_released";

// D+60 = the boundary between "the event just happened, don't push
// commerce" (immediate_post → hide entirely) and "enough time has
// passed that BD release info is plausibly imminent" (long_mid →
// show light teaser banner). Picked by the visual designer in the
// v2 mockup; no firm research backing — operator override later if
// real data shows BD announcements clustering at a different lag.
const IMMEDIATE_POST_DAYS = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const IMMEDIATE_POST_MS = IMMEDIATE_POST_DAYS * MS_PER_DAY;

// Regex-based store priority. The schema's `originalStoreName` is
// free-text (operator can type "Amazon JP" / "amazon_jp" / "アマゾン"
// — see schema comment on AlbumStoreListing); no normalized storeKey
// column to match against. Order matters: first regex to match wins.
// Stores not matching any regex sort to the end (Number.MAX_SAFE_INTEGER).
//
// Affiliate-revenue stores (Amazon, Rakuten) lead so they appear
// in the 3-row preview when present. Visit-only stores (アニメイト,
// タワレコ, HMV, ヨドバシ) fill the rest of the priority order.
const STORE_PRIORITY: ReadonlyArray<RegExp> = [
  /amazon/i,
  /楽天|rakuten/i,
  /アニメイト|animate/i,
  /タワー|tower\s*record/i,
  /HMV/i,
  /ヨドバシ|yodobashi/i,
  /ソフマップ|sofmap/i,
  /ゲーマーズ|gamers/i,
];

// 4-state listing enum (active / sold_out / unknown / ended). The
// inline preview never shows `ended`; `sold_out` / `unknown` stay
// visible since both still inform the viewer (sold_out warns of
// supply tightness, unknown carries no stock confirmation but
// doesn't read as gone). Sort order makes `active` lead within the
// same store-priority bucket.
const STATUS_PRIORITY: Record<AlbumStoreListingStatus, number> = {
  active: 0,
  sold_out: 1,
  unknown: 2,
  ended: 3,
};

function storeRank(storeName: string): number {
  for (let i = 0; i < STORE_PRIORITY.length; i++) {
    if (STORE_PRIORITY[i].test(storeName)) return i;
  }
  return Number.MAX_SAFE_INTEGER;
}

// Minimal structural types — concrete Prisma types (with translations,
// BigInt id, etc.) are wider than what the resolver / selector need.
// Defining them in this module rather than importing Prisma's
// generated shapes (a) keeps the unit tests free of Prisma fixtures
// (plain object literals work), (b) survives the serializeBigInt JSON
// boundary the page passes the event through.
export type EventBdInput = {
  startTime: Date | string;
  status: EventStatus;
  bdAlbumId: bigint | string | number | null;
};

export type AlbumBdInput = {
  releaseDate: Date | string | null;
  listings: ReadonlyArray<AlbumStoreListingBdInput>;
};

export type AlbumStoreListingBdInput = {
  status: AlbumStoreListingStatus;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  bonuses: ReadonlyArray<AlbumStoreBonusBdInput>;
};

export type AlbumStoreBonusBdInput = {
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  bonusImageUrl: string | null;
};

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Compute the bonus's effective active window by composing its own
 * startsAt/endsAt overrides with the parent listing's lifecycle.
 * `null` on either side reads as "no boundary" (always active in
 * that direction).
 *
 * Schema rationale (see prisma/schema.prisma:1030–1033): bonus
 * lifecycle is opt-in; the common case is one listing-level window
 * shared by all its bonuses, so most bonus rows have both fields
 * NULL and inherit from listing.
 */
function bonusActiveWindow(
  bonus: AlbumStoreBonusBdInput,
  listing: AlbumStoreListingBdInput,
): { start: Date | null; end: Date | null } {
  const start = toDate(bonus.startsAt) ?? toDate(listing.startsAt);
  const end = toDate(bonus.endsAt) ?? toDate(listing.endsAt);
  return { start, end };
}

function isBonusActiveAt(
  bonus: AlbumStoreBonusBdInput,
  listing: AlbumStoreListingBdInput,
  now: Date,
): boolean {
  // Parent listing's status is the source of truth for whether the
  // bonus offer is still live (see schema comment on AlbumStoreBonus
  // — "Bonus has no status of its own"). `ended` listings hide all
  // their bonuses; sold_out / unknown / active all stay visible.
  if (listing.status === "ended") return false;
  const { start, end } = bonusActiveWindow(bonus, listing);
  if (start !== null && start > now) return false;
  if (end !== null && end <= now) return false;
  return true;
}

function albumHasActiveBonus(album: AlbumBdInput, now: Date): boolean {
  for (const listing of album.listings) {
    if (listing.status === "ended") continue;
    for (const bonus of listing.bonuses) {
      if (isBonusActiveAt(bonus, listing, now)) return true;
    }
  }
  return false;
}

/**
 * Resolve the EventBdSection state for one Event + its optionally-
 * linked BD Album.
 *
 *   - When `event.bdAlbumId` is null OR `album` is null, the
 *     section falls into a pre-link time bucket
 *     (`pre` / `immediate_post` / `long_mid`).
 *   - When both are set, the post-link buckets
 *     (`bd_announced` / `bd_preorder` / `bd_released`) take over
 *     irrespective of the time delta. Once a BD is linked, the
 *     section's job is to surface BD lifecycle; D+N matters only
 *     until the link is made.
 *
 * `event.status === 'cancelled'` collapses to `pre` (hide entirely)
 * — a cancelled event won't be releasing a BD and any pre-linked
 * album row is operator data-entry error.
 */
export function resolveEventBdState(
  event: EventBdInput,
  album: AlbumBdInput | null,
  referenceNow: Date = new Date(),
): EventBdState {
  // Live or upcoming or cancelled — never surface the section. The
  // ongoing case is the D+0 ad gate (operator: no commerce push
  // while the live is in progress); upcoming is identical (BD info
  // for events that haven't happened yet is nonsensical); cancelled
  // we hide unconditionally per the comment above.
  if (event.status === "ongoing" || event.status === "cancelled") {
    return "pre";
  }

  const startTime = toDate(event.startTime);
  if (startTime !== null && startTime > referenceNow) {
    return "pre";
  }

  const hasBdLink = event.bdAlbumId !== null && album !== null;

  if (hasBdLink && album !== null) {
    const releaseDate = toDate(album.releaseDate);
    const released = releaseDate !== null && releaseDate <= referenceNow;
    if (released) return "bd_released";
    return albumHasActiveBonus(album, referenceNow)
      ? "bd_preorder"
      : "bd_announced";
  }

  // No BD link — fall into the time-bucket scale. startTime missing
  // is unusual (schema allows nullable) but defensively treats as
  // immediate_post so the section stays hidden rather than leaping
  // straight to a teaser banner with no anchor date.
  if (startTime === null) return "immediate_post";
  const elapsedMs = referenceNow.getTime() - startTime.getTime();
  if (elapsedMs < IMMEDIATE_POST_MS) return "immediate_post";
  return "long_mid";
}

/**
 * Pick the top-N bonuses for the inline preview shown in
 * `bd_preorder` / `bd_released` variants.
 *
 * Selection rules, in priority order:
 *   1. Drop any bonus whose parent listing is `ended`, or whose
 *      effective active window has closed / not yet opened.
 *   2. Sort by parent listing's `storeRank(originalStoreName)`
 *      (Amazon → 楽天 → アニメイト → ...).
 *   3. Within the same store rank, sort by parent listing status
 *      (active → sold_out → unknown).
 *   4. Within the same status, prefer bonuses with an image (the
 *      preview is more compelling with art; image-less bonuses
 *      still surface, just later).
 *
 * Returns up to `limit` (default 3) bonuses, each paired with its
 * parent listing — the rendering side needs both (listing for
 * `resolveStoreName`, `productUrl`, status badge; bonus for
 * `resolveBonusType`, description, image).
 */
export function selectTopBonuses<
  L extends AlbumStoreListingBdInput & { originalStoreName: string },
  B extends AlbumStoreBonusBdInput,
>(
  listings: ReadonlyArray<L & { bonuses: ReadonlyArray<B> }>,
  referenceNow: Date = new Date(),
  limit: number = 3,
): Array<{ bonus: B; listing: L }> {
  const candidates: Array<{ bonus: B; listing: L }> = [];
  for (const listing of listings) {
    if (listing.status === "ended") continue;
    for (const bonus of listing.bonuses) {
      if (!isBonusActiveAt(bonus, listing, referenceNow)) continue;
      candidates.push({ bonus, listing });
    }
  }

  candidates.sort((a, b) => {
    const sa = storeRank(a.listing.originalStoreName);
    const sb = storeRank(b.listing.originalStoreName);
    if (sa !== sb) return sa - sb;
    const pa = STATUS_PRIORITY[a.listing.status] ?? 9;
    const pb = STATUS_PRIORITY[b.listing.status] ?? 9;
    if (pa !== pb) return pa - pb;
    // Image-richness tiebreaker — prefer rows with bonusImageUrl,
    // but only as a tertiary signal. A bonus with no image still
    // belongs in the preview when there are no richer alternatives.
    const ia = a.bonus.bonusImageUrl ? 0 : 1;
    const ib = b.bonus.bonusImageUrl ? 0 : 1;
    return ia - ib;
  });

  return candidates.slice(0, limit);
}
