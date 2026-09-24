import type { MetadataRoute } from "next";
import { locales } from "@/i18n/routing";
import {
  absoluteUrl,
  entityPath,
  languageAlternates,
  type EntityId,
  type EntityKind,
} from "@/lib/seo/entityUrl";

type ChangeFrequency = NonNullable<
  MetadataRoute.Sitemap[number]["changeFrequency"]
>;

export type SitemapEntity = {
  id: EntityId;
  slug: string;
  lastModified: Date;
};

export type SitemapInput = Record<EntityKind, SitemapEntity[]>;

/**
 * Per-kind crawl hints. Priorities follow the page's search value:
 * events are what people look up ("<live> セトリ"), series aggregate
 * them, artists/albums are hubs, songs/members are long-tail.
 */
const KIND_HINTS: Record<
  EntityKind,
  { priority: number; changeFrequency: ChangeFrequency }
> = {
  events: { priority: 0.9, changeFrequency: "weekly" },
  series: { priority: 0.8, changeFrequency: "weekly" },
  artists: { priority: 0.7, changeFrequency: "weekly" },
  albums: { priority: 0.7, changeFrequency: "monthly" },
  songs: { priority: 0.6, changeFrequency: "monthly" },
  members: { priority: 0.6, changeFrequency: "monthly" },
};

// Fixed dates, not `new Date()`: a lastModified that changes on every
// fetch teaches crawlers to ignore the field. Bump by hand when the
// page content actually changes.
const STATIC_PAGES: Array<{
  subpath: string;
  lastModified: Date;
  changeFrequency: ChangeFrequency;
  priority: number;
}> = [
  { subpath: "", lastModified: new Date("2026-09-24"), changeFrequency: "daily", priority: 1.0 },
  { subpath: "/events", lastModified: new Date("2026-09-24"), changeFrequency: "daily", priority: 0.8 },
  { subpath: "/artists", lastModified: new Date("2026-09-24"), changeFrequency: "weekly", priority: 0.6 },
  { subpath: "/albums", lastModified: new Date("2026-09-24"), changeFrequency: "weekly", priority: 0.6 },
  { subpath: "/privacy", lastModified: new Date("2026-04-15"), changeFrequency: "yearly", priority: 0.3 },
  { subpath: "/terms", lastModified: new Date("2026-04-15"), changeFrequency: "yearly", priority: 0.3 },
];

/**
 * Every page × every locale, each entry carrying the full hreflang set
 * (`<xhtml:link rel="alternate">`) so the sitemap itself tells Google
 * the ko/ja/en URLs are translations of one page rather than
 * duplicates. URLs come from the same `entityPath` the pages use for
 * their canonical, so the sitemap can never advertise a URL the page
 * would 308 away from.
 */
export function buildSitemap(input: SitemapInput): MetadataRoute.Sitemap {
  const out: MetadataRoute.Sitemap = [];

  for (const page of STATIC_PAGES) {
    const languages = languageAlternates((l) => `/${l}${page.subpath}`);
    for (const locale of locales) {
      out.push({
        url: absoluteUrl(`/${locale}${page.subpath}`),
        lastModified: page.lastModified,
        changeFrequency: page.changeFrequency,
        priority: page.priority,
        alternates: { languages },
      });
    }
  }

  for (const kind of Object.keys(KIND_HINTS) as EntityKind[]) {
    const hints = KIND_HINTS[kind];
    for (const entity of input[kind]) {
      const languages = languageAlternates((l) =>
        entityPath(kind, l, entity.id, entity.slug),
      );
      for (const locale of locales) {
        out.push({
          url: absoluteUrl(entityPath(kind, locale, entity.id, entity.slug)),
          lastModified: entity.lastModified,
          changeFrequency: hints.changeFrequency,
          priority: hints.priority,
          alternates: { languages },
        });
      }
    }
  }

  return out;
}
