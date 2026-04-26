import type { LiveSetlistItem } from "@/components/LiveSetlist";
import type { ReactionCountsMap } from "@/hooks/useSetlistPolling";
import type { TrendingSong } from "@/components/TrendingSongs";
import { pickLocaleTranslation } from "@/lib/utils";

const EMOJI_MAP: Record<string, string> = {
  waiting: "😭",
  best: "🔥",
  surprise: "😱",
  moved: "🩷",
};

// Mirrors the SSR `getTrendingSongs` (in src/app/[locale]/events/[id]/...)
// closely enough to produce equivalent rankings: items with no songs are
// excluded (server uses `songs: { some: {} }`); ties are stable-sorted in
// the order the server returns items (position asc), so two items with the
// same total reactions appear in setlist order. Items with zero reactions
// are dropped — server's groupBy + take(3) implicitly skips them.
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
    const sTr = song ? pickLocaleTranslation(song.translations, locale) : null;
    const songTitle = sTr?.title ?? song?.originalTitle ?? unknownSongLabel;
    const topEntry = Object.entries(types).sort((a, b) => b[1] - a[1])[0];
    return {
      setlistItemId: String(item.id),
      songTitle,
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
