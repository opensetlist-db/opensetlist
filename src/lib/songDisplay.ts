import { displayOriginalTitle, resolveDisplayPair } from "@/lib/display";

export type SongDetailPair = { main: string; sub: string | null; lang: string };

export function songDisplay(
  song: { originalTitle: string; originalLanguage: string; variantLabel: string | null },
  translations: readonly { locale: string; title: string; variantLabel?: string | null }[],
  locale: string,
) {
  const title = displayOriginalTitle(song, translations, locale, "paired");
  const variant = song.variantLabel?.trim()
    ? resolveDisplayPair(
        { original: song.variantLabel, originalLanguage: song.originalLanguage },
        translations, locale, "variantLabel",
      )
    : title.variant?.trim() ? { main: title.variant, sub: null } : null;
  return {
    main: title.main, sub: title.sub, lang: song.originalLanguage,
    variant: variant && { ...variant, lang: song.variantLabel?.trim() ? song.originalLanguage : locale },
  };
}

export function songDetailName(
  item: { originalName: string | null; originalLanguage: string },
  translations: readonly { locale: string; name: string }[],
  locale: string,
  kind?: "title",
) {
  if (!item.originalName) {
    const localName = translations.find((row) => row.locale === locale)?.name;
    return { main: localName || "", sub: null, lang: locale };
  }
  return {
    ...resolveDisplayPair(
      { original: item.originalName, originalLanguage: item.originalLanguage },
      translations, locale, "name", { kind },
    ),
    lang: item.originalLanguage,
  };
}

export function pairText({ main, sub }: Pick<SongDetailPair, "main" | "sub">) {
  return sub ? `${main} / ${sub}` : main;
}
