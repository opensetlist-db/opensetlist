/**
 * Derives the unit-filter chip set for the Predicted Setlist song
 * picker. Pure — extracted from `page.tsx`'s server fetch so the
 * routing logic is unit-testable in isolation (same split as
 * `deriveSidebarUnitsAndPerformers` in `src/lib/sidebarDerivations.ts`).
 *
 * Rule (set per `task-song-picker-predict-mode.md` follow-up,
 * 2026-05-19):
 *
 *   1. `all` — always emitted first.
 *   2. `group` — when `primaryArtistId !== null`. The event's group
 *      artist (e.g. Hasunosora). Filters to songs credited directly
 *      to the group (not a sub-unit).
 *   3. For every OTHER artistId that appears in the catalog
 *      (sub-units + solos):
 *      - If `Artist.isMainUnit === true` → own `individual` chip.
 *        Operator-flagged canonical/headline units always get their
 *        own chip regardless of song count (Hasunosora's Cerise /
 *        DOLLCHESTRA / Mira-Cra Park! / Edel Note).
 *      - Else if `count > OTHERS_THRESHOLD` (10) → own `individual`
 *        chip. High-count solos / non-main sub-units earn their own
 *        chip (future Nijigasaki member solos with 10+ entries
 *        each).
 *      - Otherwise → bucketed into the `others` composite. Low-count
 *        solos / one-off sub-unit collabs end up here so they don't
 *        clutter the chip row.
 *   4. `others` — emitted only when at least one song falls under
 *      it. Catch-all routing predicate is "artistId not covered by
 *      any `group` or `individual` chip in this filter set".
 *
 * Inputs:
 *   - `songs`              — the loaded `AvailableSong[]`.
 *   - `primaryArtistId`    — `Event.eventSeries.artistId`. `null` on
 *     multi-artist festivals (picker hidden anyway, but we still
 *     return a valid `UnitFilter[]` for type safety).
 *   - `primaryArtistLabel` — pre-cascaded localized name for the
 *     primary artist. Used as the `group` chip label.
 *   - `filterAllLabel` / `filterOthersLabel` — pre-translated copies
 *     from `Predict.picker.filterAll` / `filterOthers`.
 *   - `primaryColor`       — `colors.primary` token forwarded as a
 *     parameter (this file is a pure data helper; no `@/styles`
 *     import).
 *
 * Output ordering:
 *   1. `all`
 *   2. `group` (when known)
 *   3. Individual chips: main units first (slug ASC), then high-
 *      count non-main (slug ASC). Sort key documented at the
 *      construction site below.
 *   4. `others` (when non-empty).
 */

import type { AvailableSong, UnitFilter } from "@/lib/types/predict";

/**
 * Song-count cutoff for "non-main" artists (sub-units that aren't
 * `isMainUnit` + solos): under this, the artist's songs are
 * absorbed into the `others` composite chip; over this, the artist
 * gets its own `individual` chip. Strictly greater than (`> 10`)
 * matches the operator's threshold ("10곡이 넘으면 고유 필터").
 *
 * Tuned for the Hasunosora vs Nijigasaki split — Hasunosora member
 * solos sit at ~1-3 songs each (→ "others"), Nijigasaki member
 * solos sit at ~10-25 (→ individual chips per member). Re-tune
 * when a future artist catalog falls between these regimes.
 */
const OTHERS_THRESHOLD = 10;

export function deriveUnitFilters(
  songs: readonly AvailableSong[],
  primaryArtistId: number | null,
  primaryArtistLabel: string,
  filterAllLabel: string,
  filterOthersLabel: string,
  primaryColor: string,
): UnitFilter[] {
  const out: UnitFilter[] = [
    { key: "all", label: filterAllLabel, color: null, kind: "all", artistId: null },
  ];

  if (primaryArtistId !== null) {
    // Color: prefer the first group-direct song's resolved color so
    // the group chip matches the section header tint in the picker.
    // Fall back to the brand primary when no group-direct song
    // exists yet (e.g. an artist with sub-units only).
    const groupSong = songs.find(
      (s) => s.unit.artistId === primaryArtistId && !s.unit.isSubUnit,
    );
    out.push({
      key: "group",
      label: primaryArtistLabel,
      color: groupSong?.unit.color ?? primaryColor,
      kind: "group",
      artistId: primaryArtistId,
    });
  }

  // Per-artist bucket walk — collapse same-unit songs into one
  // entry with a running count. Skip the primary artist (already
  // handled by the `group` chip above).
  //
  // **Multi-artist songs are EXCLUDED from per-artist counts.** A
  // song credited to multiple non-main solo artists ("Hanamusubi"
  // → all 5 members) has `isMultiArtist === true` and would
  // otherwise inflate whichever solo's `unit.artistId` happened to
  // sort first. We want the threshold check to consider only songs
  // a given solo "owns" exclusively (or with a main unit), so the
  // count reflects their real solo catalog. Multi-artist songs all
  // route to the `others` composite chip — picked up by
  // `othersSongCount` below.
  type Bucket = {
    slug: string;
    label: string;
    color: string;
    isMainUnit: boolean;
    count: number;
  };
  const buckets = new Map<number, Bucket>();
  // Multi-artist collab songs route to `others` regardless of the
  // per-artist threshold. We accumulate the count inline (instead
  // of a second pass over `songs`) so the loop visits each row
  // exactly once. Songs credited to the primary artist's group row
  // skip both — the `group` chip handles them above.
  let multiArtistCount = 0;
  for (const song of songs) {
    if (song.unit.artistId === primaryArtistId) continue;
    if (song.isMultiArtist) {
      multiArtistCount++;
      continue;
    }
    const existing = buckets.get(song.unit.artistId);
    if (existing) {
      existing.count++;
    } else {
      buckets.set(song.unit.artistId, {
        slug: song.unit.slug,
        label: song.unit.label,
        color: song.unit.color,
        isMainUnit: song.unit.isMainUnit,
        count: 1,
      });
    }
  }

  // Partition into individual-chip vs others-bucket. Multi-artist
  // collabs all route to `others` (see `multiArtistCount` above).
  const individuals: Array<{
    artistId: number;
    slug: string;
    label: string;
    color: string;
    isMainUnit: boolean;
  }> = [];
  let othersSongCount = multiArtistCount;
  for (const [artistId, info] of buckets) {
    if (info.isMainUnit || info.count > OTHERS_THRESHOLD) {
      individuals.push({
        artistId,
        slug: info.slug,
        label: info.label,
        color: info.color,
        isMainUnit: info.isMainUnit,
      });
    } else {
      othersSongCount += info.count;
    }
  }

  // Sort: main units first (slug ASC within), then non-main
  // (slug ASC within). Operator-flagged canonical units want
  // visual priority in the chip row.
  individuals.sort((a, b) => {
    if (a.isMainUnit !== b.isMainUnit) return a.isMainUnit ? -1 : 1;
    return a.slug.localeCompare(b.slug);
  });
  for (const ind of individuals) {
    out.push({
      key: ind.slug,
      label: ind.label,
      color: ind.color,
      kind: "individual",
      artistId: ind.artistId,
    });
  }

  if (othersSongCount > 0) {
    out.push({
      key: "others",
      label: filterOthersLabel,
      color: primaryColor,
      kind: "others",
      artistId: null,
    });
  }

  return out;
}
