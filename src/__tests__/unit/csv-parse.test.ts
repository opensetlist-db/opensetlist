import { describe, it, expect } from "vitest";
import { parseArtistSlugs, resolveOriginalLanguage } from "@/lib/csv-parse";

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
