export const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ?? "https://opensetlist.vercel.app";

export const CONTACT_EMAIL = "help@opensetlist.com";

export const REPORT_HIDE_THRESHOLD = 3;
export const IMPRESSION_EDIT_COOLDOWN_MS = 60_000;
export const IMPRESSION_MAX_CHARS = 200;
export const IMPRESSION_LOCALES = ["ko", "ja", "en"] as const;
export type ImpressionLocale = (typeof IMPRESSION_LOCALES)[number];
