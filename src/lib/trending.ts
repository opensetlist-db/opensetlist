import type { LiveSetlistItem } from "@/components/LiveSetlist";
import type { ReactionCountsMap } from "@/hooks/useSetlistPolling";
import type { TrendingSong } from "@/components/TrendingSongs";
import { displayOriginalTitle } from "@/lib/display";
import { EMOJI_MAP } from "@/lib/reactions";

// Mirrors the SSR `getTrendingSongs` (in src/app/[locale]/events/[id]/...)
// closely enough to produce equivalent rankings: items with no songs are
// excluded (server uses `songs: { some: {} }`); ties are stable-sorted in
// the order the server returns items (position asc), so two items with the
// same total reactions appear in setlist order. Items with zero reactions
// are dropped — server's groupBy + take(3) implicitly skips them.
//
// Title shape mirrors `<SetlistRow>`: original-language title is primary
// (`mainTitle`), the localized title rides as `subTitle` when the viewer
// locale differs and a translation exists, and `variantLabel` resolves
// via the same locale-strict cascade. Keeps the trending card visually
// consistent with every other song listing on the surface.
export function deriveTrendingSongs(
  items: LiveSetlistItem[],
  reactionCounts: ReactionCountsMap,
  locale: string,
  unknownSongLabel: string,
): TrendingSong[] {
  const scored = items
    .filter((item) => item.songs.length > 0)
    .map((item) => {
      const itemKey = String(item.id);
      const types = reactionCounts[itemKey] ?? {};
      const total = Object.values(types).reduce((s, n) => s + n, 0);
      return { item, total, types };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  return scored.map(({ item, total, types }) => {
    const song = item.songs[0]?.song;
    const titleDisp = song
      ? displayOriginalTitle(song, song.translations, locale)
      : null;
    const topEntry = Object.entries(types).sort((a, b) => b[1] - a[1])[0];
    return {
      setlistItemId: String(item.id),
      mainTitle: titleDisp?.main ?? unknownSongLabel,
      subTitle: titleDisp?.sub ?? null,
      variantLabel: titleDisp?.variant ?? null,
      totalReactions: total,
      topReaction: topEntry
        ? {
            type: topEntry[0],
            emoji: EMOJI_MAP[topEntry[0]] ?? "",
            count: topEntry[1],
          }
        : { type: "best", emoji: "🔥", count: 0 },
    };
  });
}
