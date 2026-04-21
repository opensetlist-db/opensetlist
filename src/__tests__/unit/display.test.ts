import { describe, it, expect } from "vitest";
import { displayName, displayOriginalTitle } from "@/lib/display";

describe("displayName", () => {
  it("returns shortName when available", () => {
    expect(
      displayName({
        name: "蓮ノ空女学院スクールアイドルクラブ",
        shortName: "蓮ノ空",
      })
    ).toBe("蓮ノ空");
  });

  it("falls back to name when shortName is null", () => {
    expect(
      displayName({
        name: "蓮ノ空女学院スクールアイドルクラブ",
        shortName: null,
      })
    ).toBe("蓮ノ空女学院スクールアイドルクラブ");
  });

  it("falls back to name when shortName is undefined", () => {
    expect(
      displayName({
        name: "蓮ノ空女学院スクールアイドルクラブ",
      })
    ).toBe("蓮ノ空女学院スクールアイドルクラブ");
  });

  it("returns full name in full mode even when shortName exists", () => {
    expect(
      displayName(
        {
          name: "蓮ノ空女学院スクールアイドルクラブ",
          shortName: "蓮ノ空",
        },
        "full"
      )
    ).toBe("蓮ノ空女学院スクールアイドルクラブ");
  });
});

describe("displayOriginalTitle", () => {
  it("shows sub when ja song has different ko translation", () => {
    const result = displayOriginalTitle(
      { originalTitle: "眩耀夜行", originalLanguage: "ja" },
      [{ locale: "ko", title: "현요야행" }],
      "ko"
    );
    expect(result).toEqual({ main: "眩耀夜行", sub: "현요야행", variant: null });
  });

  it("shows no sub when ko song viewed by ko user", () => {
    const result = displayOriginalTitle(
      { originalTitle: "사랑의 노래", originalLanguage: "ko" },
      [{ locale: "ko", title: "사랑의 노래" }],
      "ko"
    );
    expect(result).toEqual({ main: "사랑의 노래", sub: null, variant: null });
  });

  it("shows no sub when translation is same as original", () => {
    const result = displayOriginalTitle(
      { originalTitle: "Dream Believers", originalLanguage: "en" },
      [{ locale: "ko", title: "Dream Believers" }],
      "ko"
    );
    expect(result).toEqual({ main: "Dream Believers", sub: null, variant: null });
  });

  it("shows no sub when no translation exists for locale", () => {
    const result = displayOriginalTitle(
      { originalTitle: "ハナムスビ", originalLanguage: "ja" },
      [],
      "ko"
    );
    expect(result).toEqual({ main: "ハナムスビ", sub: null, variant: null });
  });

  it("shows no sub when originalLanguage matches displayLocale", () => {
    const result = displayOriginalTitle(
      { originalTitle: "사랑의 노래", originalLanguage: "ko" },
      [{ locale: "ko", title: "다른 제목" }],
      "ko"
    );
    expect(result).toEqual({ main: "사랑의 노래", sub: null, variant: null });
  });

  it("shows sub for en song with ko translation", () => {
    const result = displayOriginalTitle(
      { originalTitle: "Sparkly Spot", originalLanguage: "en" },
      [{ locale: "ko", title: "스파클리 스팟" }],
      "ko"
    );
    expect(result).toEqual({ main: "Sparkly Spot", sub: "스파클리 스팟", variant: null });
  });

  it("defaults displayLocale to ko", () => {
    const result = displayOriginalTitle(
      { originalTitle: "眩耀夜行", originalLanguage: "ja" },
      [{ locale: "ko", title: "현요야행" }]
    );
    expect(result).toEqual({ main: "眩耀夜行", sub: "현요야행", variant: null });
  });

  it("shows sub for ja user viewing en song with ja translation", () => {
    const result = displayOriginalTitle(
      { originalTitle: "Dream Believers", originalLanguage: "en" },
      [{ locale: "ja", title: "ドリームビリーバーズ" }],
      "ja"
    );
    expect(result).toEqual({ main: "Dream Believers", sub: "ドリームビリーバーズ", variant: null });
  });

  it("uses localized variantLabel from translation", () => {
    const result = displayOriginalTitle(
      { originalTitle: "Dream Believers", originalLanguage: "ja", variantLabel: "104期 Ver." },
      [{ locale: "ko", title: "Dream Believers", variantLabel: "104기 Ver." }],
      "ko"
    );
    expect(result).toEqual({ main: "Dream Believers", sub: null, variant: "104기 Ver." });
  });

  it("falls back to original variantLabel when translation has none", () => {
    const result = displayOriginalTitle(
      { originalTitle: "Dream Believers", originalLanguage: "ja", variantLabel: "104期 Ver." },
      [{ locale: "ko", title: "Dream Believers" }],
      "ko"
    );
    expect(result).toEqual({ main: "Dream Believers", sub: null, variant: "104期 Ver." });
  });

  it("returns null variant when neither original nor translation has it", () => {
    const result = displayOriginalTitle(
      { originalTitle: "DEEPNESS", originalLanguage: "ja" },
      [{ locale: "ko", title: "DEEPNESS" }],
      "ko"
    );
    expect(result).toEqual({ main: "DEEPNESS", sub: null, variant: null });
  });

  it("ignores non-matching locale translations — never uses ko as a fallback for ja viewer", () => {
    // Regression: previously pickTranslation leaked a ko variantLabel to a ja
    // viewer when the ja row was missing. The original ja variantLabel must win.
    const result = displayOriginalTitle(
      { originalTitle: "眩耀夜行", originalLanguage: "ja", variantLabel: "104期 Ver." },
      [{ locale: "ko", title: "현요야행", variantLabel: "104기 Ver." }],
      "ja"
    );
    expect(result).toEqual({ main: "眩耀夜行", sub: null, variant: "104期 Ver." });
  });

  it("ignores non-matching locale translations for sub — ja viewer on ja-original with only ko row sees no sub", () => {
    const result = displayOriginalTitle(
      { originalTitle: "眩耀夜行", originalLanguage: "ja" },
      [{ locale: "ko", title: "현요야행" }],
      "ja"
    );
    expect(result).toEqual({ main: "眩耀夜行", sub: null, variant: null });
  });

  it("picks the matching locale from a multi-locale translations array", () => {
    const result = displayOriginalTitle(
      { originalTitle: "眩耀夜行", originalLanguage: "ja", variantLabel: "104期 Ver." },
      [
        { locale: "ko", title: "현요야행", variantLabel: "104기 Ver." },
        { locale: "en", title: "Dazzling Night Journey", variantLabel: "104th Ver." },
        { locale: "ja", title: "眩耀夜行", variantLabel: "104期 Ver." },
      ],
      "en"
    );
    expect(result).toEqual({
      main: "眩耀夜行",
      sub: "Dazzling Night Journey",
      variant: "104th Ver.",
    });
  });
});
