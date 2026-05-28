import { defineRouting } from "next-intl/routing";

export const locales = ["ko", "ja", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "ko";

/**
 * Translation-row IN-filter fallback locale.
 *
 * Applied as `where: { locale: { in: [viewerLocale, FALLBACK_LOCALE] } }`
 * on every nested `translations` Prisma include in the SSR event-detail
 * query (`src/app/[locale]/events/[id]/[[...slug]]/page.tsx`) and the
 * `/api/setlist` polling route. See `src/lib/display.ts` —
 * `displayOriginalName` / `resolveOriginalShortLabel` cascade
 * viewer-locale → `originalLanguage` translation row → parent's
 * `originalName` / `originalShortName`, so the `originalLanguage` row
 * is load-bearing whenever the parent's `originalName` is null
 * (PR A transitional). All Phase 1 IPs are JP-origin
 * (Hasunosora / Niji / Umamusume), so `"ja"` is the universal
 * fallback. Phase 2+ non-JP IPs (K-POP, C-POP) will need to broaden
 * this filter — touches both call sites in sync, which is why it's
 * extracted as a named constant rather than inlined.
 */
export const FALLBACK_LOCALE: Locale = "ja";

export const routing = defineRouting({
  locales,
  defaultLocale,
  localeDetection: true,
});
