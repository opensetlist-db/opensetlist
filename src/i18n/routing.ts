import { defineRouting } from "next-intl/routing";

export const locales = ["ko", "ja", "en"] as const;
export type Locale = (typeof locales)[number];

/**
 * Locale for unprefixed URLs when the client sends no usable
 * `Accept-Language` — which is every search/social crawler (Googlebot,
 * X, Discord). Those bots see the Japanese page, and hreflang
 * `x-default` points at it (`src/lib/seo/entityUrl.ts`). JP is the
 * primary audience; Korean browsers still land on `/ko` through
 * `localeDetection` below.
 */
export const defaultLocale: Locale = "ja";

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
  // next-intl's middleware would otherwise emit an hreflang `Link`
  // response header that mirrors whatever path was requested (including
  // non-canonical slug variants) and points x-default at the
  // redirecting unprefixed path. Page metadata owns hreflang instead
  // (`entityAlternates` / `staticAlternates`), so there is exactly one
  // hreflang set per page and it always agrees with the canonical.
  alternateLinks: false,
});
