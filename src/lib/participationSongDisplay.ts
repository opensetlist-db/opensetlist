import { displayOriginalTitle, resolveDisplayPair } from "@/lib/display";
import type { SongRef } from "@/lib/types/setlist";

type SongDisplaySource = Pick<SongRef, "originalTitle" | "originalLanguage" | "variantLabel" | "translations">;

export function selectedSongSource(
  base: SongDisplaySource,
  variant?: Omit<SongDisplaySource, "originalTitle" | "originalLanguage"> &
    Partial<Pick<SongDisplaySource, "originalTitle" | "originalLanguage">> | null,
): SongDisplaySource {
  return variant ? {
    ...variant,
    originalTitle: variant.originalTitle ?? base.originalTitle,
    originalLanguage: variant.originalLanguage ?? base.originalLanguage,
  } : base;
}

export function participationSongDisplay(song: SongDisplaySource, locale: string) {
  const { main, sub, variant } = displayOriginalTitle(song, song.translations, locale, "paired");
  const version = song.variantLabel?.trim() && resolveDisplayPair(
    { original: song.variantLabel, originalLanguage: song.originalLanguage },
    song.translations,
    locale,
    "variantLabel",
  );
  return {
    main,
    sub,
    mainLang: song.originalLanguage,
    variant: version ? version.main : variant?.trim() ? variant : null,
    variantSub: version ? version.sub : null,
    variantLang: version ? song.originalLanguage : locale,
  };
}
