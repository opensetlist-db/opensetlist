import { descendantsOf, type ArtistHierarchy } from "@/lib/artistHierarchyTree";

/**
 * SetlistBuilder's pure row rules: credit after an artist pick, the
 * stage type a credit implies, and the default performer roster.
 *
 * A plain module, not part of `SetlistBuilder.tsx`: that file is a
 * "use client" component, and a "use client" module may export only
 * components and hooks (`local/use-client-exports` in eslint-rules/) —
 * anything else can resolve to `undefined` when a server component
 * imports it. The unit tests import these from here.
 */

/** The slice of an event performer the roster derivation reads. */
export type PerformerLinks = {
  id: string;
  artistLinks: readonly { artist: { id: number } }[];
};

/**
 * Credit list after the operator picks `artist` in the artist search.
 *
 * Group picks REPLACE the whole credit: on a multi-group night the
 * sticky credit carries the previous block's group (μ's), and the
 * operator starts the next block by picking the next group (Aqours).
 * Appending would save the row credited μ's + Aqours, and the public
 * badge — which reads the credits in order — would show μ's on an
 * Aqours song. Unit/solo credits go too: they belong to whatever
 * group the previous row was about, and a full_group stage doesn't
 * carry them anyway (see handleStageTypeChange).
 *
 * Unit/solo picks stay additive: a two-unit collab or a unit + solo
 * special stage is a legitimate multi-credit row, and the group credit
 * (if any) stays alongside — that pairing is how a unit row inside a
 * group block is normally credited.
 *
 * `addGroup` is the deliberate escape hatch for a genuine multi-group
 * collab (an anniversary song sung by several groups): the 「+ 그룹
 * 추가」 button in the dropdown passes it so the picked group is
 * appended instead of replacing. Unit/solo credits are still dropped
 * on that path, for the same reason as above.
 *
 * Pure.
 */
export function nextCreditOnPick<T extends { id: number; type?: string }>(
  selected: readonly T[],
  artist: T,
  opts: { addGroup?: boolean } = {},
): T[] {
  if (artist.type !== "group") return [...selected, artist];
  if (opts.addGroup) {
    return [...selected.filter((a) => a.type === "group"), artist];
  }
  return [artist];
}

/**
 * Stage type implied by a row's credit, applied whenever the operator
 * adds or removes an artist chip. Before this, only a GROUP pick set
 * the stage (→ full_group); a unit or solo pick left it alone, so on a
 * live night every unit/solo row was saved as full_group unless the
 * operator also flipped the select. That isn't cosmetic: the public
 * badge hides solo credits on a non-solo stage (the F18 guard in
 * `pickRowArtistBadges`), so those solo rows rendered with no badge at
 * all (2020 Fes rehearsal, D1 #3–6).
 *
 *   - `special` is never overridden — it's always a deliberate choice
 *     (medley-of-units, guest stage, …) the credit can't express.
 *   - any unit credited            → unit   (group + unit, unit collab;
 *                                            a solo alongside a unit
 *                                            stays a unit stage)
 *   - exactly one solo, no unit    → solo
 *   - several solos, no unit       → unchanged (ad-hoc trio vs. solo
 *                                            relay — can't tell)
 *   - only groups                  → full_group (also covers removing
 *                                            the last unit/solo chip)
 *   - no credit / untyped chips    → unchanged
 *
 * Pure.
 */
export function stageTypeForCredit(
  credits: readonly { type?: string }[],
  current: string,
): string {
  if (current === "special" || credits.length === 0) return current;
  if (credits.some((a) => a.type === "unit")) return "unit";
  const solos = credits.filter((a) => a.type === "solo").length;
  if (solos === 1) return "solo";
  if (solos > 1) return current;
  return credits.every((a) => a.type === "group") ? "full_group" : current;
}

/**
 * Which credited artists the default performer roster is derived from.
 *
 * On a unit / solo stage the roster is the unit's or soloist's members,
 * even when the parent group is credited alongside (「虹ヶ咲 + 歩夢」,
 * 「Aqours + CYaRon!」 — the normal way a unit row inside a group block
 * is credited). Passing the group id too would make
 * deriveDefaultPerformerIds expand it through the hierarchy and
 * pre-check the whole group (11 Nijigasaki members on a solo row).
 * So unit/solo stages drop group credits — unless only groups are
 * credited (e.g. the operator flipped the select by hand), in which
 * case the groups are all we have. full_group and special use every
 * credit as before.
 *
 * Pure.
 */
export function performerSourceIds(
  credits: readonly { id: number; type?: string }[],
  stageType: string,
): number[] {
  if (stageType === "unit" || stageType === "solo") {
    const nonGroup = credits.filter((a) => a.type !== "group");
    if (nonGroup.length > 0) return nonGroup.map((a) => a.id);
  }
  return credits.map((a) => a.id);
}

/**
 * Compute the default performer roster for a setlist item from the
 * three structural choices the operator makes per row: `type`,
 * `stageType`, and the credited `Artist` ids. Hasunosora's catalog
 * is overwhelmingly three repeating patterns; encoding them as a
 * deterministic derivation removes the 5–9 unnecessary clicks per
 * row that the prior "always seed with the full non-guest roster"
 * default forced on the operator for unit/solo/mc rows.
 *
 * Rules:
 *   1. type ∈ {mc, video, interval}            → []  (no performer)
 *   2. type=song + stageType=full_group        → every non-guest
 *                                                 event performer —
 *                                                 or, when Artist(s)
 *                                                 are credited, only
 *                                                 their linked members
 *   3. type=song + stageType ∈ {unit, solo,    → members of the
 *                                special}        picked Artist(s)
 *                                                 ∩ event performers
 *
 * Rule (2)'s narrowing is for multi-group events (LL Fes): the
 * roster holds every cast member of six groups, so "all performers"
 * would pre-check ~60 chips on an Aqours row. With a group credited,
 * members linked to that group are the right default.
 *
 * Matching goes through the artist hierarchy: each credited id is
 * expanded to itself + all its descendants (`descendantsOf`), so a
 * 蓮ノ空 credit matches members whose StageIdentities link only to
 * their sub-units (Cerise Bouquet / DOLLCHESTRA / …) — the normal
 * Hasunosora data shape. Without a hierarchy (prop missing) matching
 * is direct-link only.
 *
 * A credit that still matches NOBODY yields [] for every stage type.
 * The old fallback to the full roster turned an unmatched credit into
 * "all ~54 Fes performers pre-checked", which is worse than an empty
 * checklist: the operator has to uncheck 50 chips instead of checking
 * 4, and a hurried save credits the whole festival. An empty list is
 * also the right answer for credits with no member rows at all (the
 * School Idol Musical). Only the NO-credit full_group case keeps the
 * whole-roster default — that's the single-artist tour, where every
 * performer really is on stage.
 *
 * `selectedUnitArtistIds.length === 0` under rule (3) returns [] —
 * the operator hasn't picked a unit yet, so we can't infer members.
 * The next selectArtist call re-fires derivation and fills the chips.
 *
 * Manual edits via selectPerformer / removePerformer are the escape
 * hatch for any future exception (one-off guest swap, etc.); those
 * paths do NOT call this helper. Operators applying manual tweaks
 * should do so after the structural choices, because any subsequent
 * type/stageType/artist change re-derives and replaces the roster.
 *
 * Pure function (no React, no DB).
 */
export function deriveDefaultPerformerIds(
  type: string,
  stageType: string,
  selectedUnitArtistIds: readonly number[],
  eventPerformers: readonly PerformerLinks[],
  hierarchy?: ArtistHierarchy,
): string[] {
  if (type !== "song") return [];
  if (stageType === "full_group" && selectedUnitArtistIds.length === 0) {
    return eventPerformers.map((p) => p.id);
  }
  // String keys: hierarchy ids are strings, artistLinks ids are
  // numbers (see the artistHierarchy docstring on `1n === 1`).
  const creditSet = new Set<string>();
  for (const id of selectedUnitArtistIds) {
    if (hierarchy) {
      for (const d of descendantsOf(hierarchy, id)) creditSet.add(d);
    } else {
      creditSet.add(String(id));
    }
  }
  return eventPerformers
    .filter((p) => p.artistLinks.some((l) => creditSet.has(String(l.artist.id))))
    .map((p) => p.id);
}
