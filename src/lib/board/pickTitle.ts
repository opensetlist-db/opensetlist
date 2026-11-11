import { participationSongDisplay } from "@/lib/participationSongDisplay";
import type { BoardSongRef } from "@/lib/board/types";
import type { WishSongDisplay } from "@/lib/wishStorage";

export function boardSongRef(songId: string, song: WishSongDisplay): BoardSongRef {
  const { originalTitle, originalLanguage, variantLabel, baseVersionId, translations } = song;
  return {
    songId,
    title: originalTitle,
    song: { originalTitle, originalLanguage, variantLabel, baseVersionId, translations },
  };
}

export function boardSongText(ref: BoardSongRef, locale: string): string {
  if (!ref.song) return ref.title;
  const { main, sub, variant, variantSub } = participationSongDisplay(ref.song, locale);
  const original = variant ? `${main} (${variant})` : main;
  const localized = [sub, variantSub && `(${variantSub})`].filter(Boolean).join(" ");
  return localized ? `${original} / ${localized}` : original;
}
