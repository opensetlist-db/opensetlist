import { locales } from "@/i18n/routing";
import { resolveDisplayPair } from "@/lib/display";

type TitleTranslation = { locale: string; title: string; sameSource?: string };
type AlbumTitle = {
  originalTitle: string;
  originalLanguage: string;
  translations: readonly TitleTranslation[];
};

/** Checks locale completeness and whether the submitted titles need fresh source evidence. */
export function albumTitleIssues(
  { originalTitle, originalLanguage, translations }: AlbumTitle,
  edit?: { previous: AlbumTitle; submitted: readonly TitleTranslation[] },
) {
  const sourceChanged = edit && (edit.previous.originalTitle !== originalTitle ||
    edit.previous.originalLanguage !== originalLanguage);
  return locales.flatMap((locale) => {
    const translation = translations.find((row) => row.locale === locale);
    if ((locale === "ko" || locale === "en") && translation &&
        /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(translation.title)) {
      return [`${locale} 표기에 히라가나·가타카나·한자가 포함되어 있습니다.`];
    }
    const sameSource = translation?.sameSource;
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

/** Compares stored titles without treating translation order or request evidence as a change. */
export function albumTitleChanged(previous: AlbumTitle, next: AlbumTitle) {
  return previous.originalTitle !== next.originalTitle ||
    previous.originalLanguage !== next.originalLanguage ||
    previous.translations.length !== next.translations.length ||
    next.translations.some(({ locale, title }) =>
      !previous.translations.some((row) => row.locale === locale && row.title === title),
    );
}
