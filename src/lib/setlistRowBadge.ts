import type { ArtistRef, LiveSetlistItem } from "@/lib/types/setlist";

/**
 * Decide which Artist (if any) a public setlist row credits with a
 * badge under the title — the row's "who is performing this?" answer.
 *
 * Rules, in order:
 *
 *   1. No `SetlistItemArtist` credit → no badge (the caller falls back
 *      to the generic stageType label for non-full_group rows).
 *   2. F18 solo misfire — a solo-type Artist credited on a non-solo
 *      stage (an ad-hoc unit row where the operator credited one
 *      member's solo Artist) → no badge. The row would otherwise show a
 *      single performer's name tinted with a slug-hashed color.
 *   3. Non-`full_group` rows (unit / solo / special) → badge the credit.
 *   4. `full_group` rows → badge ONLY when the credited artist differs
 *      from the event's primary artist. On a single-artist event
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
export function pickRowArtistBadge(
  item: Pick<LiveSetlistItem, "stageType" | "artists">,
  eventArtistId: string | null | undefined,
): ArtistRef | null {
  const firstArtist = item.artists?.[0]?.artist ?? null;
  if (!firstArtist) return null;
  if (firstArtist.type === "solo" && item.stageType !== "solo") return null;
  if (item.stageType !== "full_group") return firstArtist;
  if (eventArtistId === undefined) return null;
  return String(firstArtist.id) !== eventArtistId ? firstArtist : null;
}
