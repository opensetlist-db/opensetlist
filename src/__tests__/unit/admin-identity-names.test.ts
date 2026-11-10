import { describe, expect, it } from "vitest";
import { checkIdentityNames } from "@/lib/adminIdentityNames";

describe("identity name completeness", () => {
  it("allows an explicitly confirmed brand, never its unconfirmed copy or missing row", () => {
    const brand = {
      originalName: "DiverDiva", originalShortName: "DiverDiva", originalLanguage: "ja",
      translations: [{ locale: "ko", name: "DiverDiva" }, { locale: "en", name: "DiverDiva" }],
    };
    expect(checkIdentityNames("아티스트", brand, undefined, "diverdiva")).toBeNull();
    expect(checkIdentityNames("아티스트", brand)).toContain("name (ko, 원문 동일 표기 검수 필요)");
    expect(checkIdentityNames("아티스트", { ...brand, translations: brand.translations.slice(0, 1) }, undefined, "diverdiva")).toContain("name (en, 표기 필요)");
  });
  it("keeps prior locale values for a partial edit and rechecks both locales on a new source name", () => {
    const previous = {
      originalName: "元の名前", originalLanguage: "ja", originalShortName: "元",
      translations: [
        { locale: "ko", name: "기존 이름", shortName: "기존" },
        { locale: "en", name: "Original Name", shortName: "Original" },
      ],
    };
    const next = { ...previous, translations: [{ locale: "ko", name: "현재 이름" }] };
    expect(checkIdentityNames("인물", next, previous)).toBeNull();
    expect(checkIdentityNames("인물", { ...next, originalName: "新しい名前" }, previous)).toContain("name (en, 표기 필요)");
  });
});
