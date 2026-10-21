/*
 * URL contract for the public search page (`/[locale]/search`), redesign
 * ticket 13 / approved design 12-v1.2.
 *
 *   ?q=<term>              free text, trimmed; empty → search invitation
 *   ?type=<SearchType>     events | artists | songs | albums; absent or
 *                          unknown → the four-group overview
 *   ?page=<n>              only meaningful with a type; 1-based
 *
 * Everything here is pure so the page, the forms and the tests share one
 * reading of the URL. Malformed input never throws: an unknown type falls
 * back to the overview and a non-numeric / zero / negative / oversized page
 * falls back to page 1, so a hand-edited or truncated link still lands on
 * something useful instead of a 400.
 */

export const SEARCH_TYPES = ["events", "artists", "songs", "albums"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/** Rows per group on the overview (approved: 4 groups × at most 5). */
export const OVERVIEW_LIMIT = 5;
/** Rows per type page. */
export const PAGE_SIZE = 20;
/**
 * Longest accepted query, in code points (not UTF-16 units, so a CJK or
 * emoji-heavy query is not cut short). The forms enforce it with
 * `maxLength`; a longer direct URL keeps the value visible and shows the
 * "too long" state without running a query.
 */
export const QUERY_MAX_LENGTH = 120;
/**
 * Highest page number we read from the URL. Four digits keeps OFFSET
 * bounded (≤ 199,980 rows skipped) while sitting far above any real
 * result set; a valid page past the last result shows the out-of-range
 * state with a link back to page 1.
 */
export const PAGE_MAX = 9999;

/** DOM id of the main search field (form + "edit search" action). */
export const MAIN_QUERY_ID = "search-query";

export type SearchParamsInput = Record<string, string | string[] | undefined>;

export type ParsedSearch = {
  /** Trimmed query as typed (display + form value). */
  q: string;
  type: SearchType | null;
  /** Always 1 when `type` is null. */
  page: number;
  /** Query is longer than QUERY_MAX_LENGTH — do not run it. */
  tooLong: boolean;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function isSearchType(value: unknown): value is SearchType {
  return (
    typeof value === "string" &&
    (SEARCH_TYPES as readonly string[]).includes(value)
  );
}

export function parseSearchParams(sp: SearchParamsInput): ParsedSearch {
  const q = (first(sp.q) ?? "").trim();
  const rawType = first(sp.type);
  const type = isSearchType(rawType) ? rawType : null;
  const rawPage = first(sp.page) ?? "";
  // Digits only, 1–4 of them: rejects "1.5", "-2", "1e3", " 2", "00000".
  const page =
    type && /^\d{1,4}$/.test(rawPage) && Number(rawPage) >= 1
      ? Math.min(Number(rawPage), PAGE_MAX)
      : 1;
  return { q, type, page, tooLong: [...q].length > QUERY_MAX_LENGTH };
}

/**
 * Locale-less search href (`/search?…`); callers prefix the locale. Omits
 * empty params and page 1 so every state has one canonical-looking URL.
 */
export function searchHref(state: {
  q: string;
  type?: SearchType | null;
  page?: number;
}): string {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.type) params.set("type", state.type);
  if (state.type && state.page && state.page > 1) {
    params.set("page", String(state.page));
  }
  const query = params.toString();
  return query ? `/search?${query}` : "/search";
}

/**
 * JS twin of the SQL normalization in `service.ts` (NFKC → ASCII
 * apostrophes → trim → lowercase). Used only for display decisions —
 * e.g. whether the visible title already explains the match — never to
 * decide inclusion or rank, which happen entirely in Postgres.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u02BC\uFF07]/g, "'")
    .trim()
    .toLowerCase();
}
