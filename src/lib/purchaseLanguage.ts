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

export function resolveStorePair(store: StoreText, locale: string, sameValueConfirmed = false) {
  return resolveDisplayPair(
    { original: store.originalStoreName, originalLanguage: store.originalLanguage },
    store.translations ?? [], locale, "storeName", { sameValueConfirmed },
  );
}

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

export function storeLanguageIssue(store: StoreText, confirmedSame = false) {
  if (!store.originalStoreName.trim()) return "매장 이름은 필수입니다.";
  for (const locale of locales) {
    const { status } = resolveStorePair(store, locale, confirmedSame);
    if (status === "missing") return `매장 이름의 ${locale} 표기를 입력해 주세요.`;
    if (status === "unconfirmed-same") return `매장 이름의 ${locale} 표기가 원문과 같은지 출처를 확인해 주세요.`;
  }
}

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

// Compare stored values rather than PATCH payload presence. Admin forms
// also send existing text on saves that only change dates, links or images.
export function translationChanged<T extends { locale: string }>(
  before: readonly T[], after: readonly T[], fields: readonly (keyof T)[],
) {
  return [...before, ...after].some(({ locale }) => {
    const oldRow = before.find((row) => row.locale === locale);
    const newRow = after.find((row) => row.locale === locale);
    return fields.some((field) => (oldRow?.[field] ?? null) !== (newRow?.[field] ?? null));
  });
}

export function requireReviewedText(sourceChanged: boolean, reviewed: unknown, issue?: string) {
  if (issue) throw new PurchaseInputError(issue);
  if (sourceChanged && reviewed !== true) {
    throw new PurchaseInputError("원문이 변경되었습니다. 번역의 의미를 다시 확인해 주세요.");
  }
}
