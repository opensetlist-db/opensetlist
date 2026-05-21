/**
 * Types for the Predicted Setlist song-picker UI introduced after PR
 * #397's "copy from past show" trigger. The picker replaces the inline
 * `<SongSearch>` autocomplete in `<PredictedSetlist>` with a catalog-
 * driven multi-select shell (mobile bottom sheet via vaul / desktop
 * inline side panel).
 *
 * Server-side shape (`AvailableSong[]`) is built from the event's
 * primary artist + its sub-units; the picker filters this list
 * client-side by search + unit chip. `UnitFilter[]` is also server-
 * derived so the chip set adapts to whichever artist the event
 * belongs to (Hasunosora today; any future artist later).
 *
 * Mockup of record:
 *   `F:\work\vaults\opensetlist\raw\mockups\event-page-mobile-predict-mockup.jsx`
 *   `F:\work\vaults\opensetlist\raw\mockups\event-page-desktop-v2-mockup.jsx`
 * Task spec:
 *   `F:\work\vaults\opensetlist\raw\task-song-picker-predict-mode.md`
 */

/** Per-song payload the server emits for the picker. */
export interface AvailableSong {
  /** Boundary-guarded via `safeBigIntToNumber` server-side — unsafe
   *  ids are dropped before reaching the client, so consumers can
   *  treat this as a plain JS number without re-validating. */
  songId: number;
  originalTitle: string;
  originalLanguage: string;
  variantLabel: string | null;
  baseVersionId: number | null;
  /** Translation rows shipped raw so `displayOriginalTitle` can
   *  render locale-aware titles client-side without a refetch on
   *  locale change. Strict locale filter (`[locale, "ja"]`) applied
   *  server-side mirrors `getEvent`'s policy — keeps the payload
   *  small without losing the original-language fallback. */
  translations: Array<{
    locale: string;
    title: string;
    variantLabel: string | null;
  }>;
  /** Unit identity used for the filter chip + section header
   *  routing. Picked server-side from the song's `SongArtist`
   *  rows. Routing preference (highest → lowest):
   *    1. Main sub-unit (`isMainUnit === true`) — wins over solos
   *    2. Single non-main sub-unit / solo — that artist
   *    3. Multiple non-main sub-units / solos — first one (for
   *       display), but `isMultiArtist` is set so routing skips
   *       any individual chip and goes to `others` instead
   *    4. Group-direct fallback — when no sub-unit credit exists
   */
  unit: AvailableSongUnit;
  /** True when the song is credited to ≥2 non-main sub-unit / solo
   *  artists (no main unit wins). These multi-solo collab songs
   *  ("Hanamusubi" credited to all 5 Hasunosora members as solo
   *  artists) shouldn't be attributed to any single solo's chip —
   *  picker routes them to the `others` composite chip only. The
   *  `unit` field still points at the first sub-unit row for
   *  fallback display purposes (badge / section header), but
   *  routing predicates in `<SongPickerContent>` consult this
   *  flag before `unit.artistId`. */
  isMultiArtist: boolean;
  /** ALL credited unit artistIds (group + sub-units + solos), not
   *  just the canonical `unit.artistId`. Used by the `group` /
   *  `individual` filter predicates so a multi-unit collab song
   *  (e.g. credited to Cerise + DOLLCHESTRA + Mira-Cra Park!)
   *  appears under EVERY credited unit's chip, not just the first
   *  one that won the canonical-unit routing.
   *
   *  Set contract: includes the primary group's artistId when the
   *  song has a group-direct credit; otherwise includes one entry
   *  per credited sub-unit / solo. Dedup'd via Set on the server.
   *  Excludes credits whose artist isn't a sub-unit of the primary
   *  group (cover artists, guests, etc. — same filter the canonical
   *  `unit` selection applies).
   *
   *  `isMultiArtist` short-circuits still take precedence — multi-
   *  solo collabs (no main unit winner) route to `others` only
   *  regardless of `creditedArtistIds`. */
  creditedArtistIds: number[];
}

export interface AvailableSongUnit {
  artistId: number;
  slug: string;
  /** Localized display name (`displayNameWithFallback(...)`-cascaded
   *  server-side at fetch time using the request locale). */
  label: string;
  /** Resolved via `resolveUnitColor(artist)` — uses `Artist.color`
   *  when set, otherwise the slug-hashed palette fallback. Never
   *  null on the wire. */
  color: string;
  /** True iff the artist's `parentArtistId` is the event's primary
   *  artist (i.e. a sub-unit / solo of the group). */
  isSubUnit: boolean;
  /** Schema's `Artist.isMainUnit` — operator-flagged canonical /
   *  headline unit (e.g. DOLLCHESTRA). Drives the filter chip
   *  policy: main units always get their own chip, non-main units
   *  + solos fall back to the song-count threshold (see
   *  `deriveUnitFilters`). */
  isMainUnit: boolean;
}

/**
 * Filter chip kind. Drives the routing predicate in
 * `<SongPickerContent>`:
 *   - `all`         → no filter
 *   - `group`       → `song.creditedArtistIds.includes(filter.artistId)`
 *   - `individual`  → `song.creditedArtistIds.includes(filter.artistId)`
 *   - `others`      → none of `song.creditedArtistIds` is covered by
 *                     any `group` or `individual` chip in the same
 *                     `UnitFilter[]` (composite catch-all)
 *
 * `creditedArtistIds` carries every credited group / sub-unit / solo
 * artistId from the server, so a multi-main-unit collab routes under
 * every credited unit's chip — not just the canonical one. PR #425
 * widened this from the earlier `song.unit.artistId === filter.artistId`
 * contract; `unit` still exists on the row for display fallback +
 * group-routing preference but is no longer the routing predicate.
 *
 * `group` + `individual` use the same predicate but the kind is kept
 * distinct because their `label` source differs (`group` uses the
 * artist's display name; `individual` uses the sub-unit's display
 * name) and so the picker can prefer the group chip for routing
 * preference when both exist.
 */
export type UnitFilterKind = "all" | "group" | "individual" | "others";

export interface UnitFilter {
  /** Stable React key + active-filter state value. `all` / `others`
   *  for the composites; the artist's `slug` for `group` + `individual`. */
  key: string;
  label: string;
  /** Used for the active-chip border + tint. `null` for the "all"
   *  filter (active state falls back to the neutral primary). */
  color: string | null;
  kind: UnitFilterKind;
  /** Filled for `kind: "group"` + `"individual"`. Null for the
   *  composite `"all"` + `"others"` filters. */
  artistId: number | null;
}
