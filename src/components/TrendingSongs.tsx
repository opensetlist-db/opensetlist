"use client";

import { useTranslations } from "next-intl";

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

export function TrendingSongs({ songs }: Props) {
  const t = useTranslations("Reaction");

  if (songs.length === 0) return null;

  return (
    <section className="mb-6 rounded-lg bg-amber-50 px-4 py-3">
      <h3 className="mb-2 text-sm font-semibold text-amber-800">
        {t("trending")}
      </h3>
      <ul className="space-y-1">
        {songs.map((song, i) => (
          <li
            key={song.setlistItemId}
            className="flex items-center gap-2 text-sm"
          >
            <span>{MEDALS[i]}</span>
            <span className="font-medium">{song.songTitle}</span>
            <span className="text-zinc-500">
              {song.topReaction.emoji}
              {song.topReaction.count}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
