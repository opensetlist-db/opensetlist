"use client";

import { useTranslations } from "next-intl";
import { colors, radius } from "@/styles/tokens";

export interface TrendingSong {
  setlistItemId: string;
  songTitle: string;
  totalReactions: number;
  topReaction: { type: string; emoji: string; count: number };
}

const MEDALS = ["🥇", "🥈", "🥉"];

interface Props {
  songs: TrendingSong[];
}

// Trending TOP3 card per shared-components-handoff §3-4. Mobile renders
// medal/title/top-reaction stacked vertically; desktop spreads them
// across three flex columns. Preserves `null` on empty so the card
// disappears when an event has no reactions yet.
export function TrendingSongs({ songs }: Props) {
  const t = useTranslations("Reaction");

  if (songs.length === 0) return null;

  return (
    <section
      className="mb-6 px-4 py-3"
      style={{
        background: colors.trendingBg,
        border: `1px solid ${colors.trendingBorder}`,
        borderRadius: radius.card,
      }}
    >
      <h3
        className="mb-2 text-sm font-semibold"
        style={{ color: colors.trendingText }}
      >
        {t("trending")}
      </h3>
      <ul className="space-y-1.5 lg:flex lg:gap-4 lg:space-y-0">
        {songs.map((song, i) => (
          <li
            key={song.setlistItemId}
            className="flex items-center gap-2 text-sm lg:flex-1 lg:min-w-0"
          >
            <span aria-hidden="true">{MEDALS[i]}</span>
            <span
              className="font-medium truncate"
              style={{ color: colors.textPrimary }}
            >
              {song.songTitle}
            </span>
            <span
              className="ml-auto whitespace-nowrap"
              style={{ color: colors.textSecondary }}
            >
              {song.topReaction.emoji}
              {song.topReaction.count}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
