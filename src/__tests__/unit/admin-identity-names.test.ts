import { describe, expect, it } from "vitest";
import { parseRealPerson } from "@/app/api/admin/artists/_validate";
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
  it("confirms a real person’s same name and stage name independently", () => {
    const source = "https://example.com/cast";
    const korean = { locale: "ko", name: "파일", stageName: "스타" };
    const english = { locale: "en", name: "Pile", stageName: "Star", nameSameSource: source };
    const person = { originalName: "Pile", originalLanguage: "ja", originalStageName: "Star" };
    expect(parseRealPerson({ ...person, translations: [korean, english] }, "person")).toMatchObject({
      ok: false, message: expect.stringContaining("stageName (en, 원문 동일 표기 검수 필요)"),
    });
    expect(parseRealPerson({ ...person, translations: [korean, { ...english, stageNameSameSource: source }] }, "person")).toMatchObject({
      ok: true, value: { translations: [korean, { locale: "en", name: "Pile", stageName: "Star" }] },
    });
  });

  it("keeps a stored same spelling when changing only a different locale", () => {
    const previous = { originalName: "Pile", originalLanguage: "ja", translations: [
      { locale: "en", name: "Pile" }, { locale: "ko", name: "파일" },
    ] };
    const next = { ...previous, translations: [{ locale: "ko", name: "파일 2" }] };
    expect(checkIdentityNames("인물", next, previous)).toBeNull();
    expect(checkIdentityNames("인물", { ...next, originalLanguage: "ko" }, previous)).toContain("name (en, 원문 동일 표기 검수 필요)");
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
