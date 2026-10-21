import { displayOriginalName, displayOriginalTitle, resolveLocalizedField } from "@/lib/display";
import { entityPath } from "@/lib/seo/entityUrl";
import { formatDate } from "@/lib/utils";
import { normalizeSearchText } from "./params";
import type { SearchHit } from "./service";

/*
 * SearchHit (DB projection) → what one result row shows. Pure, so the
 * display rules of the approved 12-v1.2 rows are unit-testable without
 * rendering:
 *
 *   concerts  date (+ "Day.N" chip when the shown name carries one) ·
 *             viewer-locale name · original name · venue
 *   artists   initial avatar · viewer-locale name · original name · type
 *   songs     original title · locale title · version chip
 *             (variant label, or "base version" when variants exist)
 *   albums    56px cover · original title · locale title · type · date
 *
 * Identity names (event, artist) are translation-primary and titles
 * (song, album) original-primary — the existing `displayOriginalName` /
 * `displayOriginalTitle` conventions. Every `lang` is the language of
 * the string it labels, so screen readers switch voice correctly.
 *
 * A "matched name" line appears only when the visible title does not
 * already contain the query and the match is not the subtitle — i.e. the
 * row was found through a name in another registered language.
 */

export type ResultRowView = {
  key: string;
  href: string;
  title: string;
  titleLang: string;
  sub: string | null;
  subLang: string;
  /** Concerts: formatted UTC date. */
  date: string | null;
  /** Concerts: "Day.1"-style chip lifted from the shown name. */
  day: string | null;
  meta: string | null;
  version: { label: string; lang: string; base: boolean } | null;
  matched: { name: string; lang: string } | null;
  /** Artists: single initial for the avatar. */
  initial: string | null;
  /** Albums: cover URL (may be null → fallback in CoverImage). */
  cover: string | null | undefined;
};

export type RowLabels = {
  artistType: (type: string) => string;
  albumType: (type: string) => string;
  base: string;
  variant: string;
};

// Event dates are calendar days stored at UTC midnight (`@db.Date`), so
// they are formatted in UTC: formatting in the viewer's zone would shift
// them a day west of UTC. Short month = the approved row density
// ("Apr 21, 2023" in en; ja/ko render the same either way).
const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
};

const DAY_PATTERN = /Day\.?\s*\d+/i;

function firstCodePoint(value: string): string {
  return [...value.trim()][0] ?? "?";
}

export function buildRowView(
  hit: SearchHit,
  locale: string,
  query: string,
  labels: RowLabels,
): ResultRowView {
  const normalizedQuery = normalizeSearchText(query);
  let view: Omit<ResultRowView, "matched">;

  switch (hit.type) {
    case "events": {
      const e = hit.entity;
      const name = displayOriginalName(e, e.translations, locale);
      view = {
        key: `events:${e.id}`,
        href: entityPath("events", locale, e.id, e.slug),
        title: name.main,
        titleLang: name.sub ? locale : e.originalLanguage,
        sub: name.sub,
        subLang: e.originalLanguage,
        date: formatDate(e.date ?? e.startTime, locale, DATE_FORMAT) || null,
        day: name.main.match(DAY_PATTERN)?.[0] ?? null,
        meta: resolveLocalizedField(e, e.translations, locale, "venue", "originalVenue"),
        version: null,
        initial: null,
        cover: undefined,
      };
      break;
    }
    case "artists": {
      const a = hit.entity;
      const name = displayOriginalName(a, a.translations, locale);
      view = {
        key: `artists:${a.id}`,
        href: entityPath("artists", locale, a.id, a.slug),
        title: name.main,
        titleLang: name.sub ? locale : a.originalLanguage,
        sub: name.sub,
        subLang: a.originalLanguage,
        date: null,
        day: null,
        meta: labels.artistType(a.type),
        version: null,
        initial: firstCodePoint(name.shortName || name.main),
        cover: undefined,
      };
      break;
    }
    case "songs": {
      const s = hit.entity;
      const title = displayOriginalTitle(s, s.translations, locale);
      const localeVariant = s.translations.find((t) => t.locale === locale)?.variantLabel;
      let version: ResultRowView["version"] = null;
      if (s.baseVersionId !== null) {
        version = title.variant
          ? { label: title.variant, lang: localeVariant ? locale : s.originalLanguage, base: false }
          : { label: labels.variant, lang: locale, base: false };
      } else if (s._count.variants > 0) {
        version = { label: labels.base, lang: locale, base: true };
      }
      view = {
        key: `songs:${s.id}`,
        href: entityPath("songs", locale, s.id, s.slug),
        title: title.main,
        titleLang: s.originalLanguage,
        sub: title.sub,
        subLang: locale,
        date: null,
        day: null,
        meta: null,
        version,
        initial: null,
        cover: undefined,
      };
      break;
    }
    case "albums": {
      const al = hit.entity;
      const title = displayOriginalTitle(al, al.translations, locale);
      const released = al.releaseDate ? formatDate(al.releaseDate, locale, DATE_FORMAT) : "";
      view = {
        key: `albums:${al.id}`,
        href: entityPath("albums", locale, al.id, al.slug),
        title: title.main,
        titleLang: al.originalLanguage,
        sub: title.sub,
        subLang: locale,
        date: null,
        day: null,
        meta: [labels.albumType(al.type), released].filter(Boolean).join(" · "),
        version: null,
        initial: null,
        cover: al.imageUrl,
      };
      break;
    }
  }

  const showMatched =
    normalizedQuery !== "" &&
    !normalizeSearchText(view.title).includes(normalizedQuery) &&
    hit.matchedName !== view.sub;
  return {
    ...view,
    matched: showMatched
      ? {
          name: hit.matchedName,
          lang: hit.matchedLocale ?? hit.entity.originalLanguage,
        }
      : null,
  };
}
