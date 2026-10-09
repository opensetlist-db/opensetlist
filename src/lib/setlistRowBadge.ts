import type { ArtistRef, LiveSetlistItem } from "@/lib/types/setlist";

/**
 * Decide which Artist(s) a public setlist row credits with a badge
 * under the title — the row's "who is performing this?" answer.
 * Returns the badge artists in credit order (possibly empty); the row
 * renders the first `MAX_ROW_BADGES` as chips and folds the rest into
 * a `+N` chip.
 *
 * Rules, in order:
 *
 *   1. No `SetlistItemArtist` credit → no badge (the caller falls back
 *      to the generic stageType label for non-full_group rows).
 *   2. F18 solo misfire — a solo-type Artist credited on a non-solo
 *      stage (an ad-hoc unit row where the operator credited one
 *      member's solo Artist) is never badged. The row would otherwise
 *      show a single performer's name tinted with a slug-hashed color.
 *      Applied per credit: on a unit row credited [unit, solo] the unit
 *      still badges; on a row credited only [solo] nothing does (the
 *      single-credit case behaves exactly as before).
 *   3. Non-`full_group` rows (unit / solo / special) → badge the
 *      remaining credits.
 *   4. `full_group` rows → badge ONLY when some credit differs from
 *      the event's primary artist. On a single-artist event
 *      (Hasunosora tour, primary = 蓮ノ空) every full_group row would
 *      otherwise say "蓮ノ空", which is noise. On a multi-group event
 *      (LL 15th Fes, primary = the `lovelive-series` umbrella artist,
 *      rows credited `aqours` / `nijigasaki` / …) the credit never
 *      matches the umbrella, so every row gets its group badge — at a
 *      festival "which group is this?" is the first question a viewer
 *      has, before "which song?". An event with no primary artist at
 *      all (legacy multi-artist festival, `artistId = null` +
 *      `organizerName`) takes the same branch: nothing to match against,
 *      so every credited row is badged.
 *      When it does badge, it badges ALL credits including the event
 *      artist: a 蓮ノ空 × Aqours collab on a Hasunosora event would read
 *      wrong as just "Aqours".
 *
 * `eventArtistId` is tri-state on purpose:
 *   - `string` — the event's primary artist id (stringified BigInt,
 *     same shape `<EventHeader>` receives).
 *   - `null`   — the event is known to have no primary artist.
 *   - `undefined` — the caller didn't supply event context; keep the
 *     pre-festival behavior (full_group rows never badged) rather than
 *     guessing, so a caller that forgets to thread the prop degrades to
 *     "fewer badges", never to "every Hasunosora row says 蓮ノ空".
 */
export function pickRowArtistBadges(
  item: Pick<LiveSetlistItem, "stageType" | "artists">,
  eventArtistId: string | null | undefined,
): ArtistRef[] {
  const credited = (item.artists ?? [])
    .map((a) => a.artist)
    .filter((a) => !(a.type === "solo" && item.stageType !== "solo"));
  if (credited.length === 0) return [];
  if (item.stageType !== "full_group") return credited;
  if (eventArtistId === undefined) return [];
  return credited.some((a) => String(a.id) !== eventArtistId) ? credited : [];
}

/**
 * Chips shown before the rest fold into `+N`. Two covers every real
 * multi-group case so far (a two-group collab) while keeping the badge
 * line to one row in the narrow title column on mobile.
 */
export const MAX_ROW_BADGES = 2;

/**
 * Label for a group-type row badge. Groups need a guaranteed SHORT
 * form (「蓮ノ空」, 「虹ヶ咲」) — the badge sits in a narrow column and
 * a full group name ("虹ヶ咲学園スクールアイドル同好会") clips.
 * `displayNameWithFallback(..., "short")` falls back from the locale's
 * missing `shortName` to the locale's long `name` before it ever
 * reaches `originalShortName`, so a group with only a long ko
 * translation would render long. Here the original short name wins
 * over any long name: a short original-script label is still the
 * name fans use for the group, while a long localized one defeats the
 * badge's purpose.
 *
 * Cascade: locale shortName → originalShortName → locale name →
 * originalName → "".
 */
export function groupBadgeLabel(
  artist: Pick<ArtistRef, "originalName" | "originalShortName" | "translations">,
  locale: string,
): string {
  const t = artist.translations.find((tr) => tr.locale === locale);
  return (
    t?.shortName ||
    artist.originalShortName ||
    t?.name ||
    artist.originalName ||
    ""
  );
}
