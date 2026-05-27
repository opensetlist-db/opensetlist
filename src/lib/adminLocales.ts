// Locale catalog for admin forms. Three components (AlbumForm,
// AlbumListingFormModal, AlbumBonusFormModal) previously declared
// identical copies; a new locale landing in any one of them would
// have silently failed to appear in the others. Centralizing here
// puts that decision in one place.
//
// `ADMIN_LOCALES` is the set of <option> values for per-locale rows
// in admin forms — i18n-aware admin surfaces only target user-facing
// languages we publish translations for.
// `ADMIN_LANGUAGES` is the parallel set of `originalLanguage` choices
// (where the source string was authored). Identical to ADMIN_LOCALES
// today; kept separate in case the two sets diverge later (e.g.
// allowing a Mandarin original where the published locales narrow to
// zh-CN only).

export const ADMIN_LOCALES = ["ko", "ja", "en", "zh-CN"] as const;
export type AdminLocale = (typeof ADMIN_LOCALES)[number];

export const ADMIN_LANGUAGES: ReadonlyArray<{
  value: AdminLocale;
  label: string;
}> = [
  { value: "ja", label: "일본어 (ja)" },
  { value: "en", label: "영어 (en)" },
  { value: "ko", label: "한국어 (ko)" },
  { value: "zh-CN", label: "중국어 (zh-CN)" },
];
