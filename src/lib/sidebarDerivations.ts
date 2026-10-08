import { displayNameWithFallback } from "@/lib/display";
import { resolveUnitColor } from "@/lib/artistColor";
import type {
  ReactionCountsMap,
  LiveSetlistItem,
  UnitsCardItem,
  PerformersCardItem,
  EventPerformerSummary,
  EventRosterEntry,
  RosterArtist,
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

/** A top-level group in the pre-show lineup (also feeds JSON-LD `performer`). */
export interface LineupGroup {
  id: string;
  slug: string;
  name: string;
  isGuest: boolean;
}

export interface Lineup {
  units: UnitsCardItem[];
  performers: PerformersCardItem[];
  groups: LineupGroup[];
}

/**
 * Pre-show sidebar lineup, built from the event's own roster
 * (`EventPerformer` + each stage identity's `artistLinks`) instead of
 * from setlist items. Upcoming pages have no items, so the item-derived
 * sidebar is empty — which (together with the zero counters) is what
 * made Google classify them as Soft 404. Once the first item lands the
 * caller switches back to `deriveSidebarUnitsAndPerformers`, so the
 * live/post-show sidebar keeps reflecting who actually performed.
 *
 * Grouping rules — tuned against the real Fes roster, whose links are
 * noisier than a single-group event suggests:
 *
 *   - **Section group** per performer = their top-level (no parent,
 *     non-unit, non-solo) group with the MOST roster members.
 *     Cross-group collab groups (AiScReam: one member each from four
 *     groups; GKSS) also sit at the top level, so "first group link"
 *     would misfile anyone in one; the headcount makes the home group
 *     win.
 *   - **Units** = `type === "unit"` links whose parent is the
 *     performer's section group. When any of a group's roster units is
 *     `isMainUnit`, only main units are shown (蓮ノ空 → Cerise /
 *     DOLLCHESTRA / Mira-Cra / Edel Note, not derivative pairs like
 *     かほめぐ♡じぇらーと); a group with no main unit flagged
 *     (いきづらい部！ today) shows all of its units rather than none.
 *     Solo "artists" never show.
 *   - Guests mirror the live sidebar (D10a/D9): a pill with the guest
 *     suffix, never counted into a group/unit member list; a group or
 *     unit with no host member is itself marked guest and sorts last.
 *
 * Order follows the roster's input order (first appearance). The page
 * fetches the roster by stage-identity creation order — seed order —
 * so groups and members read in their canonical sequence.
 */
export function deriveLineupFromRoster(
  roster: EventRosterEntry[],
  locale: string,
  unknownArtistLabel: string,
  unknownPerformerLabel: string,
): Lineup {
  const isTopLevelGroup = (a: RosterArtist) =>
    a.type === "group" && a.parentArtistId === null;
  const liveLinks = (e: EventRosterEntry) =>
    e.stageIdentity.artistLinks
      .map((l) => l.artist)
      .filter((a) => !a.isDeleted);

  // Roster headcount per top-level group — the tiebreaker that keeps a
  // collab group from stealing anyone's section.
  const groupHeadcount = new Map<number, number>();
  for (const e of roster) {
    for (const a of liveLinks(e)) {
      if (!isTopLevelGroup(a)) continue;
      groupHeadcount.set(a.id, (groupHeadcount.get(a.id) ?? 0) + 1);
    }
  }
  const sectionGroupOf = (e: EventRosterEntry): RosterArtist | null => {
    let best: RosterArtist | null = null;
    for (const a of liveLinks(e)) {
      if (!isTopLevelGroup(a)) continue;
      // Strict `>` keeps the first-listed group on a tie.
      if (!best || groupHeadcount.get(a.id)! > groupHeadcount.get(best.id)!) {
        best = a;
      }
    }
    return best;
  };

  const performerName = (e: EventRosterEntry) =>
    displayNameWithFallback(
      e.stageIdentity,
      e.stageIdentity.translations,
      locale,
      "full",
    ) || unknownPerformerLabel;
  const artistName = (a: RosterArtist) =>
    displayNameWithFallback(a, a.translations, locale, "full") ||
    unknownArtistLabel;

  type Bucket = {
    artist: RosterArtist;
    members: string[];
    memberIds: Set<string>;
    hasHost: boolean;
  };
  type GroupBucket = Bucket & { units: Map<number, Bucket> };
  const newBucket = (artist: RosterArtist): Bucket => ({
    artist,
    members: [],
    memberIds: new Set(),
    hasHost: false,
  });
  const addMember = (b: Bucket, e: EventRosterEntry) => {
    if (e.isGuest) return;
    b.hasHost = true;
    if (b.memberIds.has(e.stageIdentity.id)) return;
    b.memberIds.add(e.stageIdentity.id);
    b.members.push(performerName(e));
  };

  const groups = new Map<number, GroupBucket>();
  const sectionOf = new Map<string, RosterArtist | null>();
  for (const e of roster) {
    const section = sectionGroupOf(e);
    sectionOf.set(e.stageIdentity.id, section);
    if (!section) continue;
    let g = groups.get(section.id);
    if (!g) {
      g = { ...newBucket(section), units: new Map() };
      groups.set(section.id, g);
    }
    addMember(g, e);
    for (const a of liveLinks(e)) {
      if (a.type !== "unit" || a.parentArtistId !== section.id) continue;
      let u = g.units.get(a.id);
      if (!u) {
        u = newBucket(a);
        g.units.set(a.id, u);
      }
      addMember(u, e);
    }
  }

  const hostsFirst = <T extends { isGuest?: boolean }>(xs: T[]): T[] => [
    ...xs.filter((x) => !x.isGuest),
    ...xs.filter((x) => x.isGuest),
  ];
  const toRow = (b: Bucket, kind: "group" | "unit"): UnitsCardItem => ({
    id: String(b.artist.id),
    slug: b.artist.slug,
    name: artistName(b.artist),
    color: b.artist.color ?? null,
    members: b.members,
    isGuest: !b.hasHost,
    kind,
  });

  const orderedGroups = hostsFirst(
    [...groups.values()].map((g) => ({ g, isGuest: !g.hasHost })),
  ).map(({ g }) => g);

  // Units actually shown per group (main-unit filter applied). Kept for
  // the pill-tint lookup below so a pill is never tinted by a unit the
  // card doesn't list.
  const shownUnitIdsByGroup = new Map<number, Set<number>>();
  const units: UnitsCardItem[] = [];
  for (const g of orderedGroups) {
    const all = [...g.units.values()];
    const shown = all.some((u) => u.artist.isMainUnit)
      ? all.filter((u) => u.artist.isMainUnit)
      : all;
    shownUnitIdsByGroup.set(
      g.artist.id,
      new Set(shown.map((u) => u.artist.id)),
    );
    units.push(toRow(g, "group"));
    units.push(...hostsFirst(shown.map((u) => toRow(u, "unit"))));
  }

  // Pills: section order first, roster order within a section; a
  // performer with no section group (data gap) goes after every section.
  const sectionRank = new Map(orderedGroups.map((g, i) => [g.artist.id, i]));
  const performerRows = roster.map((e, inputIdx) => {
    const section = sectionOf.get(e.stageIdentity.id) ?? null;
    const shownIds = section ? shownUnitIdsByGroup.get(section.id) : undefined;
    const primaryUnit = shownIds
      ? liveLinks(e).find((a) => shownIds.has(a.id))
      : undefined;
    const item: PerformersCardItem = {
      id: e.stageIdentity.id,
      slug: e.stageIdentity.slug,
      name: performerName(e),
      color: resolveUnitColor(primaryUnit ?? section ?? { color: null }),
      isGuest: e.isGuest,
    };
    const rank = section
      ? (sectionRank.get(section.id) ?? Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;
    return { item, rank, inputIdx };
  });
  performerRows.sort((a, b) => a.rank - b.rank || a.inputIdx - b.inputIdx);

  return {
    units,
    performers: hostsFirst(performerRows.map((r) => r.item)),
    groups: orderedGroups.map((g) => ({
      id: String(g.artist.id),
      slug: g.artist.slug,
      name: artistName(g.artist),
      isGuest: !g.hasHost,
    })),
  };
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
 * the EventHeader card, or `null` when there are no reactions at all —
 * the card hides the row then. A row of zero-stats on an otherwise
 * empty pre-show page is half of what Google reads as Soft 404, and
 * "💬 0" tells a human nothing either. Sums every reaction across every setlist item
 * and runs the result through `Intl.NumberFormat(locale, { notation:
 * "compact", maximumFractionDigits: 1 })` — passing a string instead
 * of a raw number to the card avoids any SSR-vs-client `Intl`
 * divergence (different ICU versions could produce slightly different
 * output for the same input).
 */
export function deriveReactionsValue(
  reactionCounts: ReactionCountsMap,
  locale: string,
): string | null {
  const total = Object.values(reactionCounts).reduce(
    (sum, perItem) =>
      sum + Object.values(perItem).reduce((s, n) => s + n, 0),
    0,
  );
  if (total === 0) return null;
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(total);
}
