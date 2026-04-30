import { describe, it, expect } from "vitest";
import {
  displayNameWithFallback,
  displayOriginalName,
  displayOriginalTitle,
  resolveLocalizedField,
  resolveOriginalShortLabel,
} from "@/lib/display";

// `displayName(translation, mode)` was removed (no consumers).
// Single-translation name resolution flows through
// `displayNameWithFallback(item, translations, locale, mode)` now,
// which carries the original-name fallback the legacy helper lacked.

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

describe("displayOriginalName", () => {
  it("translation-primary: ko viewer sees ko name as main, ja original as sub", () => {
    const result = displayOriginalName(
      { originalName: "蓮ノ空女学院スクールアイドルクラブ", originalLanguage: "ja" },
      [{ locale: "ko", name: "하스노소라 여학원 스쿨 아이돌 클럽" }],
      "ko"
    );
    expect(result).toEqual({
      main: "하스노소라 여학원 스쿨 아이돌 클럽",
      sub: "蓮ノ空女学院スクールアイドルクラブ",
      shortName: null,
    });
  });

  it("returns parent originalShortName when translation row missing shortName", () => {
    const result = displayOriginalName(
      {
        originalName: "蓮ノ空女学院スクールアイドルクラブ",
        originalShortName: "蓮ノ空",
        originalLanguage: "ja",
      },
      [{ locale: "ko", name: "하스노소라 여학원 스쿨 아이돌 클럽" }],
      "ko"
    );
    expect(result).toEqual({
      main: "하스노소라 여학원 스쿨 아이돌 클럽",
      sub: "蓮ノ空女学院スクールアイドルクラブ",
      shortName: "蓮ノ空",
    });
  });

  it("uses translation shortName when present", () => {
    const result = displayOriginalName(
      { originalName: "蓮ノ空女学院スクールアイドルクラブ", originalShortName: "蓮ノ空", originalLanguage: "ja" },
      [{ locale: "ko", name: "하스노소라 여학원 스쿨 아이돌 클럽", shortName: "하스노소라" }],
      "ko"
    );
    expect(result.shortName).toBe("하스노소라");
  });

  it("never bleeds ko translation to ja viewer when ja row missing", () => {
    // Regression: a ja viewer should never see the ko name in `sub`.
    const result = displayOriginalName(
      { originalName: "蓮ノ空", originalLanguage: "ja" },
      [{ locale: "ko", name: "하스노소라" }],
      "ja"
    );
    expect(result).toEqual({ main: "蓮ノ空", sub: null, shortName: null });
  });

  it("shows no sub when displayLocale matches originalLanguage", () => {
    const result = displayOriginalName(
      { originalName: "蓮ノ空", originalLanguage: "ja" },
      [{ locale: "ja", name: "蓮ノ空" }],
      "ja"
    );
    expect(result).toEqual({ main: "蓮ノ空", sub: null, shortName: null });
  });

  it("shows no sub when translation name is identical to original", () => {
    const result = displayOriginalName(
      { originalName: "Cerise Bouquet", originalLanguage: "en" },
      [{ locale: "ko", name: "Cerise Bouquet" }],
      "ko"
    );
    expect(result).toEqual({ main: "Cerise Bouquet", sub: null, shortName: null });
  });

  it("falls through to parent originalShortName when translation row absent", () => {
    const result = displayOriginalName(
      {
        originalName: "蓮ノ空女学院スクールアイドルクラブ",
        originalShortName: "蓮ノ空",
        originalLanguage: "ja",
      },
      [],
      "ko"
    );
    expect(result).toEqual({
      main: "蓮ノ空女学院スクールアイドルクラブ",
      sub: null,
      shortName: "蓮ノ空",
    });
  });
});

describe("resolveLocalizedField", () => {
  it("returns translation field when locale row exists with non-empty value", () => {
    const event = { originalCity: "神戸", originalLanguage: "ja" };
    const translations = [{ locale: "ko", city: "고베" }];
    expect(resolveLocalizedField(event, translations, "ko", "city", "originalCity")).toBe("고베");
  });

  it("falls back to parent originalField when locale row missing", () => {
    const event = { originalCity: "神戸", originalLanguage: "ja" };
    expect(resolveLocalizedField(event, [], "ko", "city", "originalCity")).toBe("神戸");
  });

  it("falls back to parent when locale row exists but field is null", () => {
    const event = { originalCity: "神戸", originalLanguage: "ja" };
    const translations = [{ locale: "ko", city: null }];
    expect(resolveLocalizedField(event, translations, "ko", "city", "originalCity")).toBe("神戸");
  });

  it("falls back to parent when locale row exists but field is empty string", () => {
    const event = { originalCity: "神戸", originalLanguage: "ja" };
    const translations = [{ locale: "ko", city: "" }];
    expect(resolveLocalizedField(event, translations, "ko", "city", "originalCity")).toBe("神戸");
  });

  it("returns null when both locale row missing AND parent field is null", () => {
    const event = { originalCity: null, originalLanguage: "ja" };
    expect(resolveLocalizedField(event, [], "ko", "city", "originalCity")).toBeNull();
  });

  it("never picks a non-matching locale (no fallback chain)", () => {
    // Regression: pickTranslation would have returned the ko row for a ja viewer.
    const event = { originalCity: "神戸", originalLanguage: "ja" };
    const translations = [{ locale: "ko", city: "고베" }];
    expect(resolveLocalizedField(event, translations, "ja", "city", "originalCity")).toBe("神戸");
  });
});

describe("displayNameWithFallback", () => {
  const item = {
    originalName: "蓮ノ空女学院スクールアイドルクラブ",
    originalShortName: "蓮ノ空",
    originalLanguage: "ja",
  };

  it("returns translation shortName when present (explicit short mode)", () => {
    expect(
      displayNameWithFallback(
        item,
        [{ locale: "ko", name: "하스노소라 여학원 스쿨 아이돌 클럽", shortName: "하스노소라" }],
        "ko",
        "short"
      )
    ).toBe("하스노소라");
  });

  it("falls back to translation full name when shortName is null (explicit short mode)", () => {
    expect(
      displayNameWithFallback(
        item,
        [{ locale: "ko", name: "하스노소라 여학원 스쿨 아이돌 클럽", shortName: null }],
        "ko",
        "short"
      )
    ).toBe("하스노소라 여학원 스쿨 아이돌 클럽");
  });

  it("falls back to parent originalShortName when no translation row (explicit short mode)", () => {
    expect(displayNameWithFallback(item, [], "ko", "short")).toBe("蓮ノ空");
  });

  it("falls back to originalName when originalShortName is null (explicit short mode)", () => {
    expect(
      displayNameWithFallback(
        { originalName: "Cerise Bouquet", originalShortName: null, originalLanguage: "en" },
        [],
        "ko",
        "short"
      )
    ).toBe("Cerise Bouquet");
  });

  it("default mode is full — returns translation full name (not shortName)", () => {
    expect(
      displayNameWithFallback(
        item,
        [{ locale: "ko", name: "하스노소라 여학원 스쿨 아이돌 클럽", shortName: "하스노소라" }],
        "ko"
      )
    ).toBe("하스노소라 여학원 스쿨 아이돌 클럽");
  });

  it("default mode falls back to parent originalName (not originalShortName)", () => {
    expect(displayNameWithFallback(item, [], "ko")).toBe(
      "蓮ノ空女学院スクールアイドルクラブ"
    );
  });

  it("returns translation full name in full mode", () => {
    expect(
      displayNameWithFallback(
        item,
        [{ locale: "ko", name: "하스노소라 여학원 스쿨 아이돌 클럽", shortName: "하스노소라" }],
        "ko",
        "full"
      )
    ).toBe("하스노소라 여학원 스쿨 아이돌 클럽");
  });

  it("falls back to parent originalName in full mode when no translation", () => {
    expect(displayNameWithFallback(item, [], "ko", "full")).toBe(
      "蓮ノ空女学院スクールアイドルクラブ"
    );
  });

  it("never bleeds ko translation to ja viewer when ja row missing", () => {
    expect(
      displayNameWithFallback(
        { originalName: "蓮ノ空", originalShortName: null, originalLanguage: "ja" },
        [{ locale: "ko", name: "하스노소라" }],
        "ja"
      )
    ).toBe("蓮ノ空");
  });
});

// resolveOriginalShortLabel feeds the canonical-script avatar initial
// on the member-page hero. Distinct from displayNameWithFallback's
// "short" mode: this one is *original-language-primary* (the avatar
// should always render the source-script glyph regardless of the
// viewer's locale), whereas displayNameWithFallback("short") is
// locale-primary. Tests pin the fallback order so a future
// "consistency-fix" can't silently flip the precedence.
describe("resolveOriginalShortLabel", () => {
  it("prefers parent originalShortName over every translation row", () => {
    expect(
      resolveOriginalShortLabel(
        { originalShortName: "瑠璃乃", originalLanguage: "ja" },
        [
          { locale: "ja", shortName: "ja-translation-short" },
          { locale: "ko", shortName: "루리노" },
          { locale: "en", shortName: "Rurino" },
        ],
        "大沢瑠璃乃",
      ),
    ).toBe("瑠璃乃");
  });

  it("falls through to the original-language translation shortName when parent is null", () => {
    expect(
      resolveOriginalShortLabel(
        { originalShortName: null, originalLanguage: "ja" },
        [
          { locale: "ja", shortName: "瑠璃乃" },
          { locale: "ko", shortName: "루리노" },
        ],
        "大沢瑠璃乃",
      ),
    ).toBe("瑠璃乃");
  });

  it("never bleeds in a non-original-locale shortName when the original-locale row is missing", () => {
    // Strict locale lookup — a viewer landing on /ko/... where the
    // avatar should still draw the JP canonical glyph must not get
    // the Korean shortName painted into the chip.
    expect(
      resolveOriginalShortLabel(
        { originalShortName: null, originalLanguage: "ja" },
        [
          { locale: "ko", shortName: "루리노" },
          { locale: "en", shortName: "Rurino" },
        ],
        "大沢瑠璃乃",
      ),
    ).toBe("大沢瑠璃乃");
  });

  it("falls through to the full-original fallback when no shortName is curated anywhere", () => {
    // Preserves the pre-PR behavior for entries without
    // originalShortName set yet — they still get a meaningful
    // identity glyph (the full name's first character).
    expect(
      resolveOriginalShortLabel(
        { originalShortName: null, originalLanguage: "ja" },
        [],
        "大沢瑠璃乃",
      ),
    ).toBe("大沢瑠璃乃");
  });

  it("returns '?' when nothing in the chain resolves", () => {
    // Hard floor — the avatar must never render blank.
    expect(
      resolveOriginalShortLabel(
        { originalShortName: null, originalLanguage: "ja" },
        [],
        null,
      ),
    ).toBe("?");
  });

  it("treats empty string in originalShortName as 'no value' (truthy fallback, not strict equality)", () => {
    // Belt-and-suspenders against an admin import row that landed an
    // empty string instead of null in the column. The avatar's
    // .charAt(0) on "" would render blank — the falsy `||` chain is
    // the correct guard.
    expect(
      resolveOriginalShortLabel(
        { originalShortName: "", originalLanguage: "ja" },
        [{ locale: "ja", shortName: "瑠璃乃" }],
        "大沢瑠璃乃",
      ),
    ).toBe("瑠璃乃");
  });
});
