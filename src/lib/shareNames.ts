import { resolveDisplayPair } from "./display";

export type ShareName = { main: string; sub: string | null; lang: string };
export type ShareNames = { event: ShareName; series: ShareName | null; venue: ShareName | null };

export function shareName(
  item: { originalName: string; originalLanguage: string; translations: readonly { locale: string; name: string }[] },
  locale: string,
  kind?: "title",
): ShareName {
  const { main, sub } = resolveDisplayPair(
    { original: item.originalName, originalLanguage: item.originalLanguage },
    item.translations, locale, "name", { kind },
  );
  return { main, sub, lang: item.originalLanguage };
}

export function shareNameText({ main, sub }: Pick<ShareName, "main" | "sub">) {
  return sub ? `${main} / ${sub}` : main;
}
