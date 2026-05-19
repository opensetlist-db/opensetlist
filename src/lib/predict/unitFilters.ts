/**
 * Derives the unit-filter chip set for the Predicted Setlist song
 * picker. Pure — extracted from `page.tsx`'s server fetch so the
 * routing logic is unit-testable in isolation (same split as
 * `deriveSidebarUnitsAndPerformers` in `src/lib/sidebarDerivations.ts`).
 *
 * Inputs:
 *   - `songs`              — the loaded `AvailableSong[]`. Used to
 *     decide which sub-unit chips to emit (a sub-unit with zero songs
 *     in the loaded catalog produces no chip).
 *   - `primaryArtistId`    — `Event.eventSeries.artistId`. `null` on
 *     multi-artist festivals (the picker is hidden there anyway, but
 *     we still build a valid `UnitFilter[]` for type safety).
 *   - `primaryArtistLabel` — pre-cascaded localized name for the
 *     primary artist. Used as the `group` chip label.
 *   - `filterAllLabel` / `filterSubLabel` — pre-translated copies
 *     from `Predict.picker.filterAll` / `filterSub`. The composite
 *     chips don't depend on artist identity, so the labels come
 *     through next-intl rather than from the song catalog.
 *
 * Output ordering:
 *   1. `all`
 *   2. `group` (when `primaryArtistId !== null`)
 *   3. `sub` composite (when at least one sub-unit song exists)
 *   4. Individual sub-unit chips, slug ASC
 */

import { colors } from "@/styles/tokens";
import type { AvailableSong, UnitFilter } from "@/lib/types/predict";

export function deriveUnitFilters(
  songs: readonly AvailableSong[],
  primaryArtistId: number | null,
  primaryArtistLabel: string,
  filterAllLabel: string,
  filterSubLabel: string,
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
      color: groupSong?.unit.color ?? colors.primary,
      kind: "group",
      artistId: primaryArtistId,
    });
  }

  // Walk the catalog once; record each sub-unit by artistId so
  // duplicate-unit songs collapse to one chip. Map preserves
  // insertion order, but we sort by slug afterwards for stable
  // chip ordering across renders / regions.
  const subUnits = new Map<
    number,
    { slug: string; label: string; color: string }
  >();
  for (const song of songs) {
    if (!song.unit.isSubUnit) continue;
    if (subUnits.has(song.unit.artistId)) continue;
    subUnits.set(song.unit.artistId, {
      slug: song.unit.slug,
      label: song.unit.label,
      color: song.unit.color,
    });
  }

  if (subUnits.size > 0) {
    // `sub` composite chip color: the brand primary. We don't pick a
    // representative sub-unit's color because the composite isn't
    // routing to any one of them — a violet/purple ramp would also
    // be defensible (mockup uses #7B1FA2) but we'd lose the token
    // discipline. Sticking with the primary keeps the chip readable
    // and tokenised.
    out.push({
      key: "sub",
      label: filterSubLabel,
      color: colors.primary,
      kind: "sub",
      artistId: null,
    });
    const sortedSubs = [...subUnits.entries()].sort(([, a], [, b]) =>
      a.slug.localeCompare(b.slug),
    );
    for (const [artistId, info] of sortedSubs) {
      out.push({
        key: info.slug,
        label: info.label,
        color: info.color,
        kind: "individual",
        artistId,
      });
    }
  }

  return out;
}
