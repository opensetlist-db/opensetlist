import { describe, it, expect } from "vitest";
import {
  buildOriginals,
  ensureOriginalName,
  ImportValidationError,
  parseArtistSlugs,
  resolveOriginalLanguage,
} from "@/lib/csv-parse";

describe("parseArtistSlugs", () => {
  it("parses single slug", () => {
    expect(parseArtistSlugs("hasunosora")).toEqual(["hasunosora"]);
  });

  it("parses multiple space-separated slugs", () => {
    expect(parseArtistSlugs("cerise-bouquet dollchestra")).toEqual([
      "cerise-bouquet",
      "dollchestra",
    ]);
  });

  it("parses three slugs (split single)", () => {
    expect(
      parseArtistSlugs("cerise-bouquet dollchestra mira-cra-park")
    ).toEqual(["cerise-bouquet", "dollchestra", "mira-cra-park"]);
  });

  it("returns empty array for empty string", () => {
    expect(parseArtistSlugs("")).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(parseArtistSlugs(undefined)).toEqual([]);
  });

  it("returns empty array for null", () => {
    expect(parseArtistSlugs(null)).toEqual([]);
  });

  it("trims leading/trailing whitespace", () => {
    expect(parseArtistSlugs("  hasunosora  ")).toEqual(["hasunosora"]);
  });

  it("handles multiple spaces between slugs", () => {
    expect(parseArtistSlugs("cerise-bouquet   dollchestra")).toEqual([
      "cerise-bouquet",
      "dollchestra",
    ]);
  });

  it("handles tabs between slugs", () => {
    expect(parseArtistSlugs("cerise-bouquet\tdollchestra")).toEqual([
      "cerise-bouquet",
      "dollchestra",
    ]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(parseArtistSlugs("   ")).toEqual([]);
  });
});

describe("resolveOriginalLanguage", () => {
  it("returns 'ja' as default when undefined", () => {
    expect(resolveOriginalLanguage(undefined)).toBe("ja");
  });

  it("returns 'ja' as default when null", () => {
    expect(resolveOriginalLanguage(null)).toBe("ja");
  });

  it("returns 'ja' as default when empty string", () => {
    expect(resolveOriginalLanguage("")).toBe("ja");
  });

  it("returns 'ja' for whitespace-only string", () => {
    expect(resolveOriginalLanguage("   ")).toBe("ja");
  });

  it("returns provided language code", () => {
    expect(resolveOriginalLanguage("en")).toBe("en");
  });

  it("returns 'ko' when specified", () => {
    expect(resolveOriginalLanguage("ko")).toBe("ko");
  });

  it("returns 'zh-CN' when specified (canonical form)", () => {
    expect(resolveOriginalLanguage("zh-CN")).toBe("zh-CN");
  });

  it("normalizes lowercase 'zh-cn' to canonical 'zh-CN'", () => {
    expect(resolveOriginalLanguage("zh-cn")).toBe("zh-CN");
  });

  it("trims whitespace from value", () => {
    expect(resolveOriginalLanguage("  en  ")).toBe("en");
  });

  it("returns 'ja' when explicitly set", () => {
    expect(resolveOriginalLanguage("ja")).toBe("ja");
  });

  it("normalizes legacy 'jp' alias to 'ja'", () => {
    expect(resolveOriginalLanguage("jp")).toBe("ja");
  });

  it("normalizes 'JP' uppercase to 'ja'", () => {
    expect(resolveOriginalLanguage("JP")).toBe("ja");
  });

  it("throws on unknown language code", () => {
    expect(() => resolveOriginalLanguage("fr")).toThrow(/Unknown originalLanguage/);
  });

  it("throws on bare 'zh' (not canonical)", () => {
    expect(() => resolveOriginalLanguage("zh")).toThrow(/Unknown originalLanguage/);
  });
});

describe("buildOriginals", () => {
  type Source = { locale: string; name: string; shortName: string | null };
  const FIELDS = [
    { override: "originalName", sourceKey: "name" as const, out: "originalName" },
    { override: "originalShortName", sourceKey: "shortName" as const, out: "originalShortName" },
    { override: "originalBio", sourceKey: null, out: "originalBio" },
  ];

  it("derives all fields from source when no overrides", () => {
    const source: Source = { locale: "ja", name: "蓮ノ空", shortName: "蓮ノ空" };
    expect(buildOriginals({}, source, "ja", FIELDS)).toEqual({
      originalLanguage: "ja",
      originalName: "蓮ノ空",
      originalShortName: "蓮ノ空",
    });
  });

  it("explicit override wins over source value", () => {
    const source: Source = { locale: "ja", name: "蓮ノ空", shortName: "蓮ノ空" };
    expect(
      buildOriginals(
        { originalName: "Hasunosora", originalShortName: "HSNS" },
        source,
        "ja",
        FIELDS
      )
    ).toEqual({
      originalLanguage: "ja",
      originalName: "Hasunosora",
      originalShortName: "HSNS",
    });
  });

  it("empty override falls back to source", () => {
    const source: Source = { locale: "ja", name: "蓮ノ空", shortName: "蓮ノ空" };
    expect(
      buildOriginals({ originalName: "   ", originalShortName: "" }, source, "ja", FIELDS)
    ).toEqual({
      originalLanguage: "ja",
      originalName: "蓮ノ空",
      originalShortName: "蓮ノ空",
    });
  });

  it("override-only field (sourceKey null) is omitted unless provided", () => {
    const source: Source = { locale: "ja", name: "Foo", shortName: null };
    expect(buildOriginals({}, source, "ja", FIELDS)).toEqual({
      originalLanguage: "ja",
      originalName: "Foo",
      originalShortName: null,
    });
  });

  it("override-only field is included when explicit value present", () => {
    const source: Source = { locale: "ja", name: "Foo", shortName: null };
    expect(
      buildOriginals({ originalBio: "An idol group." }, source, "ja", FIELDS)
    ).toEqual({
      originalLanguage: "ja",
      originalName: "Foo",
      originalShortName: null,
      originalBio: "An idol group.",
    });
  });

  it("returns null for source field that is null (matches pre-PR-B.3 nulling behavior)", () => {
    const source: Source = { locale: "ja", name: "Foo", shortName: null };
    expect(buildOriginals({}, source, "ja", FIELDS)).toEqual({
      originalLanguage: "ja",
      originalName: "Foo",
      originalShortName: null,
    });
  });

  it("source absent + no overrides → returns empty object (preserve existing on update)", () => {
    expect(buildOriginals({}, null, "ja", FIELDS)).toEqual({});
  });

  it("source absent + only secondary override → omits originalLanguage (avoids stale-name mismatch)", () => {
    expect(buildOriginals({ originalShortName: "HSNS" }, null, "ja", FIELDS)).toEqual({
      originalShortName: "HSNS",
    });
  });

  it("source absent + originalName override → includes originalLanguage", () => {
    expect(
      buildOriginals({ originalName: "Hasunosora" }, null, "en", FIELDS)
    ).toEqual({
      originalLanguage: "en",
      originalName: "Hasunosora",
    });
  });

  it("trims explicit override whitespace", () => {
    expect(
      buildOriginals({ originalName: "  Foo Bar  " }, null, "ja", FIELDS)
    ).toEqual({
      originalLanguage: "ja",
      originalName: "Foo Bar",
    });
  });

  it("trims source values and treats whitespace-only source as null", () => {
    const source: Source = { locale: "ja", name: "  Foo  ", shortName: "   " };
    expect(buildOriginals({}, source, "ja", FIELDS)).toEqual({
      originalLanguage: "ja",
      originalName: "Foo",
      originalShortName: null,
    });
  });

  it("source matches different prefix when fieldMap uses prefixed override columns", () => {
    type SeriesSource = { locale: string; name: string; shortName: string | null };
    const seriesFields = [
      { override: "series_originalName", sourceKey: "name" as const, out: "originalName" },
      { override: "series_originalShortName", sourceKey: "shortName" as const, out: "originalShortName" },
    ];
    const source: SeriesSource = { locale: "ja", name: "蓮ノ空 6th", shortName: "6th" };
    expect(
      buildOriginals(
        { series_originalName: "Hasunosora 6th Live" },
        source,
        "ja",
        seriesFields
      )
    ).toEqual({
      originalLanguage: "ja",
      originalName: "Hasunosora 6th Live",
      originalShortName: "6th",
    });
  });
});

describe("ensureOriginalName", () => {
  it("returns the originalName when present", () => {
    expect(ensureOriginalName({ originalName: "Hasunosora" }, "hasunosora", "Artist", "ja")).toBe(
      "Hasunosora"
    );
  });

  it("throws ImportValidationError when originalName missing", () => {
    expect(() => ensureOriginalName({}, "hasunosora", "Artist", "ja")).toThrow(
      ImportValidationError
    );
  });

  it("throws when originalName is null", () => {
    expect(() =>
      ensureOriginalName({ originalName: null }, "hasunosora", "Artist", "ja")
    ).toThrow(/has no originalName/);
  });

  it("throws when originalName is empty string", () => {
    expect(() =>
      ensureOriginalName({ originalName: "" }, "hasunosora", "Artist", "ja")
    ).toThrow(/has no originalName/);
  });

  it("error message names the entity, slug, and originalLanguage", () => {
    expect(() => ensureOriginalName({}, "kaho", "RealPerson", "en")).toThrow(
      /RealPerson "kaho".*originalLanguage=en/
    );
  });
});
