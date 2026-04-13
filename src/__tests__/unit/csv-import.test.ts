import { describe, it, expect } from "vitest";
import { resolveSongTranslations } from "@/lib/csv-parse";

describe("resolveSongTranslations", () => {
  it("returns all three locales when all titles present", () => {
    const { translations, removedLocales } = resolveSongTranslations({
      ja_title: "眩耀夜行",
      ko_title: "현요야행",
      en_title: "Genyou Yakou",
    });
    expect(translations).toEqual([
      { locale: "ja", title: "眩耀夜行", variantLabel: null },
      { locale: "ko", title: "현요야행", variantLabel: null },
      { locale: "en", title: "Genyou Yakou", variantLabel: null },
    ]);
    expect(removedLocales).toEqual([]);
  });

  it("marks missing locales as removed", () => {
    const { translations, removedLocales } = resolveSongTranslations({
      ja_title: "眩耀夜行",
    });
    expect(translations).toHaveLength(1);
    expect(translations[0].locale).toBe("ja");
    expect(removedLocales).toEqual(["ko", "en"]);
  });

  it("removes ko locale when ko_title is deleted from CSV", () => {
    const { translations, removedLocales } = resolveSongTranslations({
      ja_title: "Dream Believers",
    });
    expect(removedLocales).toContain("ko");
    expect(removedLocales).toContain("en");
    expect(translations.map((t) => t.locale)).toEqual(["ja"]);
  });

  it("keeps locale with only variantLabel (no title)", () => {
    const { translations, removedLocales } = resolveSongTranslations({
      ja_title: "Dream Believers",
      ko_variantLabel: "104기 Ver.",
    });
    expect(translations).toEqual([
      { locale: "ja", title: "Dream Believers", variantLabel: null },
      { locale: "ko", title: "", variantLabel: "104기 Ver." },
    ]);
    expect(removedLocales).toEqual(["en"]);
  });

  it("includes variantLabel alongside title", () => {
    const { translations } = resolveSongTranslations({
      ja_title: "Dream Believers",
      ja_variantLabel: "104期 Ver.",
      ko_title: "Dream Believers",
      ko_variantLabel: "104기 Ver.",
    });
    expect(translations).toEqual([
      { locale: "ja", title: "Dream Believers", variantLabel: "104期 Ver." },
      { locale: "ko", title: "Dream Believers", variantLabel: "104기 Ver." },
    ]);
  });

  it("removes all locales when no translations at all", () => {
    const { translations, removedLocales } = resolveSongTranslations({});
    expect(translations).toEqual([]);
    expect(removedLocales).toEqual(["ja", "ko", "en"]);
  });

  it("treats empty string title as absent", () => {
    const { translations, removedLocales } = resolveSongTranslations({
      ja_title: "",
      ko_title: "현요야행",
    });
    expect(translations).toHaveLength(1);
    expect(translations[0].locale).toBe("ko");
    expect(removedLocales).toContain("ja");
    expect(removedLocales).toContain("en");
  });

  it("treats empty string variantLabel as null", () => {
    const { translations } = resolveSongTranslations({
      ja_title: "Dream Believers",
      ja_variantLabel: "",
    });
    expect(translations[0].variantLabel).toBeNull();
  });

  it("alphabet-only title with no ko_title marks ko as removed", () => {
    // User scenario: original title is "DEEPNESS" (alphabet only), no need for ko translation
    const { translations, removedLocales } = resolveSongTranslations({
      ja_title: "DEEPNESS",
    });
    expect(removedLocales).toContain("ko");
    expect(translations.map((t) => t.locale)).not.toContain("ko");
  });
});
