import { permanentRedirect } from "next/navigation";
import { BASE_URL } from "@/lib/config";
import { defaultLocale, locales } from "@/i18n/routing";

/**
 * Single owner of every public entity URL, its canonical, and its
 * hreflang set.
 *
 * Policy (repo CLAUDE.md "URL Strategy"):
 *   - Canonical = `/{locale}/{kind}/{id}/{db-slug}`. The slug is the
 *     entity's `slug` column — ASCII, unique, locale-neutral — so every
 *     locale shares the same path shape and no CJK ever lands in a URL.
 *   - Any other form (bare id, a wrong / renamed / localized slug, extra
 *     segments) 308s to the canonical. Before this module existed the
 *     site served 3–5 variants of every entity with 200s, and Search
 *     Console flagged dozens of "Duplicate without user-selected
 *     canonical" pages.
 *   - `x-default` points at the default-locale (`ja`) URL, never at the
 *     unprefixed path — the unprefixed path is a locale-detecting
 *     redirect, which Google treats as a poor x-default target.
 *
 * Swapping the canonical form (e.g. back to bare-id) is a one-line
 * change in `entityPath` — every page, link builder, redirect and the
 * sitemap route through it.
 */

export type EntityKind =
  | "events"
  | "songs"
  | "artists"
  | "members"
  | "series"
  | "albums";

// `number` is the post-`serializeBigInt` shape, `bigint` the raw Prisma
// row, `string` the precision-safe form (album ids, UUID member ids).
// Template-literal interpolation yields the exact digit string for all.
export type EntityId = bigint | number | string;

/**
 * Narrower than `Metadata["alternates"]` (whose canonical may be a URL
 * or descriptor object) so pages can reuse `canonical` verbatim as
 * `openGraph.url` — og:url and the canonical must never disagree.
 * Still assignable to `Metadata["alternates"]`.
 */
export type PageAlternates = {
  canonical: string;
  languages: Record<string, string>;
};

export function entityPath(
  kind: EntityKind,
  locale: string,
  id: EntityId,
  slug: string,
): string {
  // The schema doesn't forbid `slug = ""`. Emitting `/…/{id}/` for it
  // would be normalized to `/…/{id}` by Next (trailing slash stripped),
  // which `enforceCanonicalSlug` would then redirect straight back to
  // itself — an infinite 308 loop. For an empty slug the id-only URL is
  // the canonical.
  const base = `/${locale}/${kind}/${id}`;
  return slug ? `${base}/${slug}` : base;
}

export function absoluteUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

/**
 * hreflang map for an arbitrary locale-prefixed path builder. Absolute
 * URLs because Google requires absolute hreflang targets; `metadataBase`
 * would resolve relative ones, but being explicit keeps the sitemap
 * (which has no metadataBase) and page metadata byte-identical.
 */
export function languageAlternates(
  pathFor: (locale: string) => string,
): Record<string, string> {
  const languages: Record<string, string> = Object.fromEntries(
    locales.map((l) => [l, absoluteUrl(pathFor(l))]),
  );
  languages["x-default"] = languages[defaultLocale];
  return languages;
}

/** `alternates` block (canonical + hreflang) for an entity page. */
export function entityAlternates(
  kind: EntityKind,
  locale: string,
  id: EntityId,
  slug: string,
): PageAlternates {
  return {
    canonical: absoluteUrl(entityPath(kind, locale, id, slug)),
    languages: languageAlternates((l) => entityPath(kind, l, id, slug)),
  };
}

/**
 * `alternates` block for a non-entity page (home, list pages, legal).
 * `subpath` is locale-free: "" for home, "/events" for the list, etc.
 */
export function staticAlternates(
  locale: string,
  subpath: string,
): PageAlternates {
  return {
    canonical: absoluteUrl(`/${locale}${subpath}`),
    languages: languageAlternates((l) => `/${l}${subpath}`),
  };
}

/**
 * Call in an entity page body once the entity has loaded. 308s to the
 * canonical URL unless the incoming optional-catch-all segments are
 * exactly `[slug]`. Covers bare id (`/events/8`), wrong or legacy
 * localized slugs (`/events/8/도쿄-공연-day1`), and extra segments
 * (`/events/8/slug/extra`).
 *
 * The query string is carried over so a shared `?tab=history` link
 * survives the hop. `permanentRedirect` throws, so this never returns
 * when it redirects.
 */
export function enforceCanonicalSlug(
  kind: EntityKind,
  locale: string,
  id: EntityId,
  slug: string,
  incoming: string[] | undefined,
  searchParams?: Record<string, string | string[] | undefined>,
): void {
  // Next hands dynamic segments over URL-decoded, and DB slugs are
  // ASCII-only (`generateSlug`), so a plain string compare is exact.
  const isCanonical = slug
    ? incoming?.length === 1 && incoming[0] === slug
    : !incoming || incoming.length === 0;
  if (isCanonical) return;
  permanentRedirect(
    entityPath(kind, locale, id, slug) + toQueryString(searchParams),
  );
}

function toQueryString(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): string {
  if (!searchParams) return "";
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) qs.append(key, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}
