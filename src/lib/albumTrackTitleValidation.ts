import { locales } from "@/i18n/routing";
import { resolveDisplayPair } from "@/lib/display";

export function trackTitleSnapshot(track: {
  title: string | null;
  titleLanguage: string | null;
  translations: readonly { locale: string; title: string }[];
}): string {
  const translations = track.translations.map(({ locale, title }) => [locale, title]);
  translations.sort(([a], [b]) => a.localeCompare(b, "en"));
  return JSON.stringify([track.title, track.titleLanguage, translations]);
}

export function albumTrackTitleError(
  original: string,
  originalLanguage: string,
  translations: readonly { locale: string; title: string }[],
  confirmedSameLocales: unknown,
): string | null {
  const problems = locales.flatMap((locale) => {
    const { status } = resolveDisplayPair(
      { original, originalLanguage },
      translations,
      locale,
      "title",
      {
        kind: "title",
        sameValueConfirmed:
          Array.isArray(confirmedSameLocales) && confirmedSameLocales.includes(locale),
      },
    );
    switch (status) {
      case "missing":
        return [`${locale} 표기 누락`];
      case "unconfirmed-same":
        return [`${locale} 원문과 동일한 표기의 출처 확인 필요`];
      case "title-review":
        return [`${locale} 기호 제목의 출처 확인 필요`];
      default:
        return [];
    }
  });
  return problems.length ? `독립 트랙 제목을 확인해 주세요 (${problems.join(", ")}).` : null;
}
