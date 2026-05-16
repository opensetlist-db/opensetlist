/**
 * Shared, UI-framework-free types for the live event surface.
 *
 * Lives in `src/lib/types/` (the project's convention for cross-layer
 * type modules — see `legal.ts` next door) so pure helpers under
 * `src/lib/` can describe their inputs and outputs without importing
 * from `src/components/` or `src/hooks/`. Layer rule: `lib/` depends
 * on `lib/`; UI modules depend on either. Re-exported from the
 * historical homes (`LiveSetlist.tsx`, `useSetlistPolling.ts`,
 * `UnitsCard.tsx`, `PerformersCard.tsx`) for back-compat with existing
 * import sites.
 */

/** Aggregated reaction counts per setlist item: `setlistItemId → reactionType → count`. */
export type ReactionCountsMap = Record<string, Record<string, number>>;

export type NameTranslation = {
  locale: string;
  name: string;
  shortName?: string | null;
};

export type SongTranslation = {
  locale: string;
  title: string;
  variantLabel?: string | null;
};

export type ArtistRef = {
  id: number;
  slug: string;
  parentArtistId?: number | null;
  // Required by `deriveSidebarUnitsAndPerformers` to filter the
  // setlist-item artist credits down to units only (Pass-1 of the
  // sidebar derivation). Carried on every polled `/api/setlist`
  // response — Prisma `findMany` returns it by default since `type`
  // is a scalar column on `Artist`.
  type: string;
  color: string | null;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  translations: NameTranslation[];
};

export type StageIdentityRef = {
  id: string;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  translations: NameTranslation[];
  // Per-StageIdentity unit memberships (StageIdentity → Artist via
  // StageIdentityArtist). Carried on every polled `/api/setlist`
  // response so the live sidebar's per-unit member sublist
  // (`UnitsCard`) can re-derive when a new performer joins the
  // polled setlist mid-show. Empty array when the StageIdentity
  // has no unit affiliations recorded yet.
  artistLinks: Array<{ artistId: number }>;
};

export type RealPersonRef = {
  id: string;
  originalName: string | null;
  originalStageName: string | null;
  originalLanguage: string;
  translations: NameTranslation[];
};

export type SongRef = {
  id: number;
  slug: string;
  originalTitle: string;
  originalLanguage: string;
  variantLabel: string | null;
  /**
   * Points at the canonical base song when this row is a variant
   * (e.g. "Dream Believers (105th Ver.)" → id of "Dream Believers"),
   * null otherwise. Returned by `/api/setlist` because Prisma's
   * default `include` carries every scalar; coerced to `number` by
   * `serializeBigInt`. Consumed by `isSongMatched` (src/lib/songMatch.ts)
   * so the wishlist + predicted-setlist match-highlight rules can
   * forward-match a wished base song against an actual-setlist
   * variant, per `raw/20260503-wish-song-ui-architecture.md` §"Variant 처리".
   */
  baseVersionId: number | null;
  translations: SongTranslation[];
  artists: Array<{ artist: ArtistRef }>;
};

/**
 * Per-event "fan TOP-3 wished songs" entry — what the wishlist UI
 * needs to render a single row in the fan TOP-3 column. Built
 * server-side by `getEventWishlistTop3` (page.tsx, SSR seed) and
 * `/api/setlist` (polled refresh) so the same shape flows from both
 * sources. The `count` is the number of distinct `SongWish` rows for
 * `(eventId, songId)`; the `song` slot carries enough data to call
 * `displayOriginalTitle` + `<SongMatchBadge>` (which checks
 * `baseVersionId`) without a follow-up fetch.
 */
export type FanTop3Entry = {
  count: number;
  song: Pick<
    SongRef,
    "id" | "originalTitle" | "originalLanguage" | "variantLabel" | "baseVersionId" | "translations"
  >;
};

export type LiveSetlistItem = {
  id: number;
  position: number;
  isEncore: boolean;
  stageType: string;
  unitName: string | null;
  status: string;
  performanceType: string | null;
  type: string;
  /**
   * Row creation instant in UTC (ISO string after `serializeBigInt`).
   * Drives the 1-minute auto-promote rule for `rumoured` rows in
   * `getConfirmStatus` (`src/lib/confirmStatus.ts`) — late-arriving
   * viewers see rows past the 60s boundary already settled to
   * `confirmed`. Already returned by Prisma's default `findMany`
   * include on `SetlistItem.createdAt` and threaded through the
   * `/api/setlist` polling channel; this entry just makes the field
   * visible to TS consumers.
   */
  createdAt: string;
  /**
   * Count of `SetlistItemConfirm` rows associated with this item.
   * Sourced from Prisma's `_count: { confirms: true }` aggregation
   * on the polling endpoint, flattened to a top-level field server-
   * side so consumers don't need to know about Prisma's `_count`
   * convention.
   *
   * Consumed by:
   *   1. The conflict-group sort in `<ActualSetlist>` — sibling
   *      rumoured rows at the same position render top-down by
   *      `confirmCount DESC, createdAt ASC`.
   *   2. The `[count]` badge on the ConfirmButton (PR #283 surface).
   *   3. Eventually, the client-side trip-wire for showing "almost
   *      promoted" state when `confirmCount` approaches
   *      `CONFLICT_CONFIRMATION_THRESHOLD` — the server still owns
   *      the authoritative promotion decision via the /confirm
   *      route's transaction.
   *
   * Defaults to 0 on a row with no confirms (Prisma's `_count` gives
   * 0 when the relation has zero rows).
   */
  confirmCount: number;
  songs: Array<{ song: SongRef }>;
  performers: Array<{
    stageIdentity: StageIdentityRef;
    realPerson: RealPersonRef | null;
  }>;
  artists: Array<{ artist: ArtistRef }>;
};

/**
 * Sidebar `<UnitsCard>` payload row. Built by
 * `deriveSidebarUnitsAndPerformers` from `LiveSetlistItem[]` plus the
 * event-level guest roster.
 */
export interface UnitsCardItem {
  id: string;
  slug: string;
  name: string;
  /**
   * Unit color (e.g. `#e91e8c`). Null when the operator hasn't
   * backfilled the brand color yet — the card falls back to a brand-
   * tinted border so the row reads as "unit, color pending" rather
   * than "no unit".
   */
  color: string | null;
  /**
   * Member display names that performed in this unit during the
   * current event, joined with ` · ` at render time. Empty array if
   * no members resolved (data gap or unit had no specific-song
   * appearances on this event).
   */
  members: string[];
  /**
   * True when this unit is a "guest unit" at this event: it was
   * credited via `SetlistItemArtist` but no non-guest performer at
   * this event linked to it. Drives the muted "· 게스트" suffix
   * appended to the unit name. Optional for backward-compat —
   * treated as `false` when missing.
   */
  isGuest?: boolean;
}

/**
 * Sidebar `<PerformersCard>` pill payload. Built by
 * `deriveSidebarUnitsAndPerformers` (one walk shared with
 * `UnitsCardItem` so the unit-color resolution isn't duplicated).
 */
export interface PerformersCardItem {
  /** StageIdentity uuid — already a string, used directly as React key. */
  id: string;
  /** Resolved character name — `displayNameWithFallback(..., "full")`. */
  name: string;
  /**
   * Tint color for this character's pill — the resolved color of
   * their primary unit (`resolveUnitColor(unit)`, which substitutes a
   * deterministic palette pick keyed on the unit's slug when
   * `Artist.color` is null). Always set so every pill renders with a
   * visible accent.
   */
  color: string;
  /**
   * True when this character was flagged as a guest at this event
   * (`EventPerformer.isGuest === true`). Drives the muted "· 게스트"
   * suffix on the pill and the host/guest sort order. Optional for
   * backward-compat — treated as `false` when missing.
   */
  isGuest?: boolean;
}

/**
 * Event-level performer summary — the subset of `EventPerformer`
 * fields needed to mark host vs guest StageIdentities. Built once at
 * SSR (operators set the guest roster before the show; we don't poll
 * it during a live event), passed as a stable prop to
 * `<LiveEventLayout>`.
 */
export interface EventPerformerSummary {
  stageIdentityId: string;
  isGuest: boolean;
}
