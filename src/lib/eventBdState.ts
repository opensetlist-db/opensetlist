// Release status and analytics labels for a linked event BD.
import type { EventStatus } from "@/generated/prisma/enums";
import { projectPurchaseOptions, type PurchaseListing } from "@/lib/purchaseAvailability";

export type EventBdState =
  | "pre"
  | "immediate_post"
  | "long_mid"
  | "bd_announced"
  | "bd_preorder"
  | "bd_released";

// GA4 `bd_state` param values for the b10c `bd_section_view` event.
// Maps the three *rendering* states (the only ones that mount the BD
// section with a linked album) to the hyphenated values the analytics
// spec + downstream GA4 dashboard config expect. `bd-postrelease` is
// intentionally absent — b07 folded the post-release case into
// `bd_released` (the section renders compactly when no active bonus
// remains), so the funnel only ever sees these three. `pre` /
// `immediate_post` (render null) and `long_mid` (album-less teaser) do
// not fire bd_section_view, so they have no GA value here.
export const BD_STATE_GA_VALUE: Record<
  "bd_announced" | "bd_preorder" | "bd_released",
  string
> = {
  bd_announced: "bd-announce",
  bd_preorder: "bd-preorder-open",
  bd_released: "bd-released",
};

// The old time buckets distinguish unlinked events; neither renders a summary.
const IMMEDIATE_POST_DAYS = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const IMMEDIATE_POST_MS = IMMEDIATE_POST_DAYS * MS_PER_DAY;

export type EventBdInput = {
  startTime: Date | string;
  status: EventStatus;
  bdAlbumId: bigint | string | number | null;
};

export type AlbumBdInput = {
  releaseDate: Date | string | null;
  listings: readonly PurchaseListing[];
};

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
    return projectPurchaseOptions(album.listings, referenceNow, { performanceOnly: true }).bonusCount > 0
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
