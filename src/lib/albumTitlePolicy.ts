import { locales } from "@/i18n/routing";
import { resolveDisplayPair } from "@/lib/display";

type TitleTranslation = { locale: string; title: string; sameSource?: string };
type AlbumTitle = {
  originalTitle: string;
  originalLanguage: string;
  translations: readonly TitleTranslation[];
};

export function albumTitleIssues(
  { originalTitle, originalLanguage, translations }: AlbumTitle,
  edit?: { previous: AlbumTitle; submitted: readonly TitleTranslation[] },
) {
  const sourceChanged = edit && (edit.previous.originalTitle !== originalTitle ||
    edit.previous.originalLanguage !== originalLanguage);
  return locales.flatMap((locale) => {
    if (locale === "ko" && translations.some((row) => row.locale === locale && /\p{Script=Han}/u.test(row.title))) {
      return ["ko 표기의 한자를 한글로 적어 주세요."];
    }
    const sameSource = translations.find((row) => row.locale === locale)?.sameSource;
    const { status } = resolveDisplayPair(
      { original: originalTitle, originalLanguage },
      translations, locale, "title", {
        kind: "title",
        sameValueConfirmed: Boolean(sameSource && /^https?:\/\//i.test(sameSource) && URL.canParse(sameSource)),
      },
    );
    if (status === "unconfirmed-same") {
      // A partial edit can preserve the same spelling already stored for this locale.
      const stored = edit?.previous.translations.find((row) => row.locale === locale);
      return !sourceChanged && !sameSource && stored?.title === originalTitle
        ? []
        : [`${locale} 원문 동일 표기 검수 필요`];
    }
    if (status === "title-review") return [`${locale} 기호 제목 검수 필요`];
    if (status === "missing") return [`${locale} 표기 누락`];
    if ((status === "present" || status === "confirmed-same") && originalLanguage !== locale &&
        sourceChanged && !edit.submitted.some((row) => row.locale === locale && row.title)) {
      return [`${locale} 기존 표기 재검수 및 입력 필요`];
    }
    return [];
  });
}

export function albumTitleChanged(previous: AlbumTitle, next: AlbumTitle) {
  return previous.originalTitle !== next.originalTitle ||
    previous.originalLanguage !== next.originalLanguage ||
    previous.translations.length !== next.translations.length ||
    next.translations.some(({ locale, title }) =>
      !previous.translations.some((row) => row.locale === locale && row.title === title),
    );
}
