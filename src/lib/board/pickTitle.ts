import { displayOriginalTitle } from "@/lib/display";
import type { AvailableSong } from "@/lib/types/predict";

/**
 * The title a fan board pick stores — the same `main` title the board
 * read renders (`src/lib/board/boardRead.ts`), so "my picks" and the
 * columns agree. A plain module, not the `"use client"` component that
 * uses it: shared helpers must be importable from server code too.
 */
export function pickTitle(song: AvailableSong, locale: string): string {
  return displayOriginalTitle(song, song.translations, locale).main;
}
