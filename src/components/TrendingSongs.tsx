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
  // Defensive slice: deriveTrendingSongs() already takes top 3, but the
  // medal-strip rendering depends on `MEDALS[i]` resolving — a future
  // caller passing more than 3 would render `undefined` past index 2.
  const rankedSongs = songs.slice(0, MEDALS.length);

  return (
    <section
      className="mb-6"
      style={{
        background: colors.trendingBg,
        border: `1px solid ${colors.trendingBorder}`,
        borderRadius: radius.card,
        // Mockup `event-page-desktop-mockup-v2.jsx:620` —
        // `padding: "18px 24px"` (matches the desktop mockup's
        // value verbatim; mobile keeps the same shape per
        // `event-page-mockup.jsx:239`).
        padding: "18px 24px",
      }}
    >
      <h3
        // Mockup `:623` — `fontSize: 13, fontWeight: 700` (was
        // text-sm/font-semibold = 14px/600 before this fix).
        style={{
          color: colors.trendingText,
          fontSize: 13,
          fontWeight: 700,
          margin: 0,
          marginBottom: 14,
        }}
      >
        {t("trending")}
      </h3>
      <ul
        // Mobile (default): column flex with `9px` row gap (mockup
        // `event-page-desktop-mockup-v2.jsx:300`'s
        // `marginBottom: 9`). Desktop (≥ lg): row flex with 32px
        // column gap (mockup `:631`'s `gap: 32` = `lg:gap-8`).
        className="flex flex-col gap-y-[9px] lg:flex-row lg:gap-y-0 lg:gap-x-8"
        style={{ margin: 0, padding: 0, listStyle: "none" }}
      >
        {rankedSongs.map((song, i) => (
          <li
            key={song.setlistItemId}
            className="flex items-center gap-2 lg:flex-1 lg:min-w-0"
          >
            {/* Mockup `:634` — `fontSize: 20` for the medal emoji. */}
            <span aria-hidden="true" style={{ fontSize: 20 }}>
              {MEDALS[i]}
            </span>
            <span
              className="truncate"
              style={{
                color: colors.textPrimary,
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {song.songTitle}
            </span>
            <span
              className="ml-auto whitespace-nowrap"
              style={{
                color: colors.textSecondary,
                fontSize: 12,
                fontWeight: 700,
              }}
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
