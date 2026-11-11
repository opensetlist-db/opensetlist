import { locales } from "@/i18n/routing";
import { PurchaseInputError } from "@/lib/adminPurchaseFields";
import { resolveDisplayPair } from "@/lib/display";

type StoreText = {
  originalStoreName: string;
  originalLanguage: string;
  translations?: readonly { locale: string; storeName?: string | null }[];
};

type BonusText = {
  originalBonusType: string;
  originalBonusDescription?: string | null;
  originalLanguage: string;
  translations?: readonly {
    locale: string;
    bonusType?: string | null;
    bonusDescription?: string | null;
  }[];
};

/** Keep the source name while resolving only the viewer's store translation. */
export function resolveStorePair(store: StoreText, locale: string, sameValueConfirmed = false) {
  return resolveDisplayPair(
    { original: store.originalStoreName, originalLanguage: store.originalLanguage },
    store.translations ?? [], locale, "storeName", { sameValueConfirmed },
  );
}

/** Use the source in its own locale and suppress cross-language fallback for bonus copy. */
export function resolveBonusText(bonus: BonusText, locale: string) {
  if (bonus.originalLanguage === locale) {
    return {
      type: bonus.originalBonusType.trim(),
      description: bonus.originalBonusDescription?.trim() || null,
    };
  }
  const translation = bonus.translations?.find((row) => row.locale === locale);
  return {
    type: translation?.bonusType?.trim() || null,
    description: translation?.bonusDescription?.trim() || null,
  };
}

/** Report the first missing public name or unreviewed identical spelling. */
export function storeLanguageIssue(store: StoreText, confirmedSame = false) {
  if (!store.originalStoreName.trim()) return "매장 이름은 필수입니다.";
  for (const locale of locales) {
    const { status } = resolveStorePair(store, locale, confirmedSame);
    if (status === "missing") return `매장 이름의 ${locale} 표기를 입력해 주세요.`;
    if (status === "unconfirmed-same") return `매장 이름의 ${locale} 표기가 원문과 같은지 출처를 확인해 주세요.`;
  }
}

/** Require every public locale's bonus type and any description that has source text. */
export function bonusLanguageIssue(bonus: BonusText, confirmedSame = false) {
  if (!bonus.originalBonusType.trim()) return "특전 종류는 필수입니다.";
  for (const locale of locales) {
    if (locale === bonus.originalLanguage) continue;
    const { type, description } = resolveBonusText(bonus, locale);
    if (!type || (!confirmedSame && type === bonus.originalBonusType.trim())) {
      return `특전 종류의 ${locale} 번역을 입력해 주세요.`;
    }
    if (bonus.originalBonusDescription?.trim() &&
      (!description || (!confirmedSame && description === bonus.originalBonusDescription.trim()))) {
      return `특전 설명의 ${locale} 번역을 입력해 주세요.`;
    }
  }
}

/** Compare stored fields because unrelated form saves also resubmit existing translations. */
export function translationChanged<T extends { locale: string }>(
  before: readonly T[], after: readonly T[], fields: readonly (keyof T)[],
) {
  return [...before, ...after].some(({ locale }) => {
    const oldRow = before.find((row) => row.locale === locale);
    const newRow = after.find((row) => row.locale === locale);
    return fields.some((field) => (oldRow?.[field] ?? null) !== (newRow?.[field] ?? null));
  });
}

/** Reject incomplete text or a source edit that the operator has not rechecked. */
export function requireReviewedText(sourceChanged: boolean, reviewed: unknown, issue?: string) {
  if (issue) throw new PurchaseInputError(issue);
  if (sourceChanged && reviewed !== true) {
    throw new PurchaseInputError("원문이 변경되었습니다. 번역의 의미를 다시 확인해 주세요.");
  }
}
