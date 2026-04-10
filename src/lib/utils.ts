/**
 * Generate a URL-friendly slug from a string.
 * Handles Korean, Japanese, Chinese characters by keeping them as-is (percent-encoded by browser).
 * Latin characters are lowercased and spaces become hyphens.
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "") // keep letters, numbers, spaces, hyphens
    .replace(/[\s]+/g, "-") // spaces → hyphens
    .replace(/-+/g, "-") // collapse multiple hyphens
    .replace(/^-|-$/g, ""); // trim leading/trailing hyphens
}

/**
 * Serialize BigInt values to numbers for JSON compatibility.
 * Prisma returns BigInt for @id @default(autoincrement()) fields.
 * At runtime, bigint fields become numbers after JSON round-trip.
 */
export function serializeBigInt<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) =>
      typeof value === "bigint" ? Number(value) : value
    )
  );
}

/**
 * Pick a locale-specific translation from a translations array.
 * Falls back to "ko" → "en" → first available.
 */
export function pickTranslation<T extends { locale: string }>(
  translations: T[],
  locale: string
): T | undefined {
  return (
    translations.find((t) => t.locale === locale) ??
    translations.find((t) => t.locale === "ko") ??
    translations.find((t) => t.locale === "en") ??
    translations[0]
  );
}

/**
 * Format a date for display. Returns locale-appropriate date string.
 */
export function formatDate(
  date: Date | string | null | undefined,
  locale: string
): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const localeMap: Record<string, string> = {
    ko: "ko-KR",
    ja: "ja-JP",
    en: "en-US",
    "zh-CN": "zh-CN",
  };
  return d.toLocaleDateString(localeMap[locale] ?? locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
