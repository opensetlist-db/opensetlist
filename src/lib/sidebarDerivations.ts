import { displayNameWithFallback } from "@/lib/display";
import { resolveUnitColor } from "@/lib/artistColor";
import type {
  ReactionCountsMap,
  LiveSetlistItem,
  UnitsCardItem,
  PerformersCardItem,
  EventPerformerSummary,
} from "@/lib/types/setlist";

// Re-export so import sites that already use this module's name for
// the event-performer summary type don't need to switch to importing
// from `@/lib/types/setlist`. Original definition lives there to keep
// `lib/` strictly type-layer for cross-module shapes.
export type { EventPerformerSummary };

/**
 * Combined sidebar derivation for the live event page.
 *
 * Produces the two sidebar payloads that feed `<UnitsCard>` and
 * `<PerformersCard>`. A line-for-line port of the inline server-side
 * derivation that previously lived in
 * `src/app/[locale]/events/[id]/[[...slug]]/page.tsx:533-694`. Lifted
 * here so the same pure function runs:
 *
 *   1. Server-side at SSR (so first paint matches today's HTML byte-
 *      for-byte and SEO/static crawlers see the populated sidebar).
 *   2. Client-side inside `LiveEventLayout` whenever
 *      `useSetlistPolling` ticks, so the sidebar reflects new setlist
 *      items / performers without a page reload.
 *
 * The two cards share a single walk: building the unit map twice
 * (once per card) would walk `setlistItems[].artists` and
 * `setlistItems[].performers` 4× per derivation. Combined into one
 * call returning `{ units, performers }` keeps it at 3 walks
 * (Pass-1 collect units, Pass-2 fill members, Pass-3 collect
 * performers) and shares the unit-color resolution.
 *
 * Behavior must stay identical to the original page.tsx version —
 * any divergence would cause the sidebar to flash on first poll
 * (server-rendered shape ≠ client-derived shape). The unit tests in
 * `src/__tests__/unit/performers-card.test.tsx` and
 * `src/__tests__/unit/units-card.test.tsx` cover the cards
 * themselves; this helper's correctness is exercised end-to-end
 * by the page render.
 */
export function deriveSidebarUnitsAndPerformers(
  items: LiveSetlistItem[],
  eventPerformers: EventPerformerSummary[],
  locale: string,
  unknownArtistLabel: string,
  unknownPerformerLabel: string,
): { units: UnitsCardItem[]; performers: PerformersCardItem[] } {
  // Guest set (D10a + D9 source). Sourced from `EventPerformer`
  // (a different relation from `setlistItems[].performers`, which
  // is the per-song `SetlistItemMember[]`). Built once and consulted
  // by Pass-2 (filter) and the performer-pill build (mark + sort).
  const guestStageIdentityIds = new Set<string>(
    eventPerformers.filter((p) => p.isGuest).map((p) => p.stageIdentityId),
  );

  // Internal extension: keep `resolvedColor` on the unit map so the
  // performer-pill walk can read it without re-running
  // `resolveUnitColor`. Stripped before returning the public
  // `UnitsCardItem` shape.
  type SidebarUnitInternal = UnitsCardItem & { resolvedColor: string };

  // Pass 1: collect unique units (deduped by Artist.id, type === "unit"
  // only, first-seen order preserved). Each unit's color is resolved
  // here so the Units card's color bar and the Performers card's pill
  // tint stay in lockstep.
  const unitsById = new Map<string, SidebarUnitInternal>();
  const memberSeen = new Map<string, Set<string>>();
  for (const item of items) {
    for (const a of item.artists) {
      if (a.artist.type !== "unit") continue;
      const id = String(a.artist.id);
      if (unitsById.has(id)) continue;
      // Full unit name (operator preference: the sidebar has the room
      // for the full title, and the short name reads as too compressed
      // for a label that also serves as the section header for its
      // members sublist).
      const name =
        displayNameWithFallback(
          a.artist,
          a.artist.translations,
          locale,
          "full",
        ) || unknownArtistLabel;
      unitsById.set(id, {
        id,
        slug: a.artist.slug,
        name,
        color: a.artist.color ?? null,
        resolvedColor: resolveUnitColor(a.artist),
        members: [],
      });
      memberSeen.set(id, new Set());
    }
  }

  // Helper: pick the primary unit for a performer's artist links —
  // first link that points at one of the event's units. Returns null
  // when no link resolves; caller then falls back to the global
  // default tint.
  const pickPrimaryUnit = (
    links: ReadonlyArray<{ artistId: number }>,
  ): SidebarUnitInternal | null => {
    for (const link of links) {
      const u = unitsById.get(String(link.artistId));
      if (u) return u;
    }
    return null;
  };

  // Pass 2: populate per-unit member lists.
  // Track per-unit `hasHostMember` (any non-guest performer with a
  // link to this unit at this event). A unit ending up with no host
  // member is marked `isGuest: true` for the sidebar suffix — covers
  // the case where a visiting unit is credited via SetlistItemArtist
  // (e.g. opener band) and only its own members performed under it.
  const unitHasHostMember = new Map<string, boolean>();
  for (const id of unitsById.keys()) unitHasHostMember.set(id, false);

  for (const item of items) {
    for (const p of item.performers) {
      // D10a: skip guests entirely from member-sublist building.
      // They still surface in the PerformersCard with the D9
      // "· 게스트" suffix; they just don't pollute host-unit sublists
      // when their `artistLinks` happen to match a host unit
      // (returning graduate, cross-affiliation).
      if (guestStageIdentityIds.has(p.stageIdentity.id)) continue;
      const links = p.stageIdentity.artistLinks ?? [];
      for (const link of links) {
        const unitId = String(link.artistId);
        const u = unitsById.get(unitId);
        if (!u) continue;
        unitHasHostMember.set(unitId, true);
        const members = memberSeen.get(unitId)!;
        if (members.has(p.stageIdentity.id)) continue;
        members.add(p.stageIdentity.id);
        u.members.push(
          displayNameWithFallback(
            p.stageIdentity,
            p.stageIdentity.translations,
            locale,
            "full",
          ) || unknownPerformerLabel,
        );
      }
    }
  }

  // Drop `resolvedColor` from the public Units payload — `UnitsCard`
  // recomputes its own per-row accent from `color` via `resolveUnitColor`.
  // Each unit is tagged `isGuest` (D9): guest = no non-guest performer
  // at this event linked to it. Hosts sort first, guests last; relative
  // first-appearance order preserved within each group.
  const allUnits: UnitsCardItem[] = [...unitsById.values()].map(
    ({ id, slug, name, color, members }) => ({
      id,
      slug,
      name,
      color,
      members,
      isGuest: !unitHasHostMember.get(id),
    }),
  );
  const sortedUnits: UnitsCardItem[] = [
    ...allUnits.filter((u) => !u.isGuest),
    ...allUnits.filter((u) => u.isGuest),
  ];

  // Performers card build — each pill tint is the primary unit's
  // resolved color (NOT the personal `StageIdentity.color`; operator
  // wants the lineup to read as "members of these units"). Names use
  // the FULL cascade per operator preference — sidebar pills have
  // room and the full form is unambiguous when scanning.
  const performerSeen = new Map<string, PerformersCardItem>();
  for (const item of items) {
    for (const p of item.performers) {
      const id = p.stageIdentity.id;
      if (performerSeen.has(id)) continue;
      const name =
        displayNameWithFallback(
          p.stageIdentity,
          p.stageIdentity.translations,
          locale,
          "full",
        ) || unknownPerformerLabel;
      const primaryUnit = pickPrimaryUnit(p.stageIdentity.artistLinks ?? []);
      performerSeen.set(id, {
        id,
        name,
        // Always set — `resolveUnitColor` covers the case where the
        // primary unit's own color is null, and a missing primary unit
        // (rare) falls through to the same fallback.
        color:
          primaryUnit?.resolvedColor ?? resolveUnitColor({ color: null }),
        isGuest: guestStageIdentityIds.has(id),
      });
    }
  }
  const allPerformers = [...performerSeen.values()];
  const sortedPerformers: PerformersCardItem[] = [
    ...allPerformers.filter((p) => !p.isGuest),
    ...allPerformers.filter((p) => p.isGuest),
  ];

  return { units: sortedUnits, performers: sortedPerformers };
}

/**
 * Total song-typed setlist items (excludes mc/video/interval, plus
 * placeholder song-typed items with no song row attached yet). The
 * predicate matches `<LiveSetlist>`'s subtitle filter exactly so the
 * sidebar pill (`X songs` in `EventHeader`) and the setlist card
 * subtitle (`X songs` next to `Y items`) stay in sync — an admin-
 * created song placeholder without a song picked yet must not inflate
 * one but not the other.
 */
export function deriveSongsCount(items: LiveSetlistItem[]): number {
  return items.filter((i) => i.type === "song" && i.songs.length > 0).length;
}

/**
 * Pre-formatted reaction count string (e.g. `"1.2K"` / `"1.2천"`) for
 * the EventHeader card. Sums every reaction across every setlist item
 * and runs the result through `Intl.NumberFormat(locale, { notation:
 * "compact", maximumFractionDigits: 1 })` — passing a string instead
 * of a raw number to the card avoids any SSR-vs-client `Intl`
 * divergence (different ICU versions could produce slightly different
 * output for the same input).
 */
export function deriveReactionsValue(
  reactionCounts: ReactionCountsMap,
  locale: string,
): string {
  const total = Object.values(reactionCounts).reduce(
    (sum, perItem) =>
      sum + Object.values(perItem).reduce((s, n) => s + n, 0),
    0,
  );
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(total);
}
