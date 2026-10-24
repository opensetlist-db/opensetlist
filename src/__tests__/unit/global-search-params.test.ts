import { describe, it, expect } from "vitest";
import {
  PAGE_MAX,
  QUERY_MAX_LENGTH,
  normalizeSearchText,
  parseSearchParams,
  searchHref,
} from "@/lib/globalSearch/params";

/*
 * URL contract of `/[locale]/search` (ticket 13): q/type/page parsing,
 * malformed-input fallbacks, bounds, and the href builder that resets
 * page on query/type change.
 */

describe("parseSearchParams", () => {
  it("reads q/type/page and trims the query", () => {
    expect(parseSearchParams({ q: "  Dream ", type: "songs", page: "2" })).toEqual({
      q: "Dream",
      type: "songs",
      page: 2,
      tooLong: false,
    });
  });

  it("treats a missing or unknown type as the overview, where page is always 1", () => {
    expect(parseSearchParams({ q: "a", type: "series", page: "3" })).toMatchObject({
      type: null,
      page: 1,
    });
    expect(parseSearchParams({ q: "a", page: "3" })).toMatchObject({ type: null, page: 1 });
  });

  it.each(["0", "-1", "1.5", "1e3", " 2", "abc", "", "00000", "12345"])(
    "falls back to page 1 for malformed page %j",
    (page) => {
      expect(parseSearchParams({ q: "a", type: "songs", page }).page).toBe(1);
    },
  );

  it("accepts the upper page bound", () => {
    expect(parseSearchParams({ q: "a", type: "songs", page: String(PAGE_MAX) }).page).toBe(
      PAGE_MAX,
    );
  });

  it("uses the first value of a repeated parameter", () => {
    expect(parseSearchParams({ q: ["x", "y"], type: ["albums", "songs"] })).toMatchObject({
      q: "x",
      type: "albums",
    });
  });

  it("measures the length limit in code points, not UTF-16 units", () => {
    const emoji = "🎤".repeat(QUERY_MAX_LENGTH); // 240 UTF-16 units
    expect(parseSearchParams({ q: emoji }).tooLong).toBe(false);
    expect(parseSearchParams({ q: "長".repeat(QUERY_MAX_LENGTH + 1) }).tooLong).toBe(true);
  });

  it("returns an empty query for whitespace-only input", () => {
    expect(parseSearchParams({ q: " 　 " }).q).toBe("");
  });
});

describe("searchHref", () => {
  it("omits empty values and page 1", () => {
    expect(searchHref({ q: "" })).toBe("/search");
    expect(searchHref({ q: "Dream", type: "songs", page: 1 })).toBe("/search?q=Dream&type=songs");
    expect(searchHref({ q: "Dream", type: "songs", page: 3 })).toBe(
      "/search?q=Dream&type=songs&page=3",
    );
  });

  it("drops page on the overview", () => {
    expect(searchHref({ q: "Dream", type: null, page: 4 })).toBe("/search?q=Dream");
  });

  it("encodes the query", () => {
    expect(searchHref({ q: "μ's & A+B" })).toBe("/search?q=%CE%BC%27s+%26+A%2BB");
  });
});

describe("normalizeSearchText", () => {
  it("folds NFKC forms, curly apostrophes and case", () => {
    expect(normalizeSearchText(" Ｄｒｅａｍ ")).toBe("dream");
    expect(normalizeSearchText("µ’s")).toBe("μ's");
  });
});
