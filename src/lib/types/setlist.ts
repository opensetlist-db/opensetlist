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
  translations: SongTranslation[];
  artists: Array<{ artist: ArtistRef }>;
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
