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
   *  rows: sub-unit row wins over the group-direct row when both
   *  match (a song credited to both group + sub-unit routes to the
   *  sub-unit chip rather than the group chip — section headers
   *  stay organised by the smaller scope). */
  unit: AvailableSongUnit;
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
   *  artist. Drives the `kind: "sub"` composite filter. */
  isSubUnit: boolean;
}

/**
 * Filter chip kind. Drives the routing predicate in
 * `<SongPickerContent>`:
 *   - `all`         → no filter
 *   - `group`       → `song.unit.artistId === filter.artistId`
 *   - `sub`         → `song.unit.isSubUnit === true`
 *   - `individual`  → `song.unit.artistId === filter.artistId`
 *
 * `group` + `individual` use the same predicate but the kind is kept
 * distinct because their `label` source differs (`group` uses the
 * artist's display name; `individual` uses the sub-unit's display
 * name).
 */
export type UnitFilterKind = "all" | "group" | "sub" | "individual";

export interface UnitFilter {
  /** Stable React key + active-filter state value. `all` / `sub` for
   *  the composites; the artist's `slug` for `group` + `individual`. */
  key: string;
  label: string;
  /** Used for the active-chip border + tint. `null` for the "all"
   *  filter (active state falls back to the neutral primary). */
  color: string | null;
  kind: UnitFilterKind;
  /** Filled for `kind: "group"` + `"individual"`. Null for the
   *  composite `"all"` + `"sub"` filters. */
  artistId: number | null;
}
