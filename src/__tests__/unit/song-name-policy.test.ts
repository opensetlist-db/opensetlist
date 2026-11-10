import { describe, expect, it } from "vitest";
import { parseSongTranslations, songNameError } from "@/lib/admin/songNames";
import { pairText, songDisplay } from "@/lib/songDisplay";

const song = {
  originalTitle: "Say Good-Bye 涙",
  originalLanguage: "ja",
  variantLabel: null,
  translations: [
    { locale: "ko", title: "Say Good-Bye 눈물" },
    { locale: "en", title: "Say Good-Bye Namida" },
  ],
};

describe("song naming policy", () => {
  it("keeps the approved mixed-script pair in Korean and English", () => {
    expect(pairText(songDisplay(song, song.translations, "ko"))).toBe("Say Good-Bye 涙 / Say Good-Bye 눈물");
    expect(pairText(songDisplay(song, song.translations, "en"))).toBe("Say Good-Bye 涙 / Say Good-Bye Namida");
    expect(pairText(songDisplay(song, song.translations, "ja"))).toBe("Say Good-Bye 涙");
    expect(songNameError(song, song.translations, false)).toBeNull();
    expect(songNameError({ ...song, translations: [song.translations[0]] }, [], false)).toContain("en 제목");
  });

  it("exempts a Roman title but still requires a Roman person label to be reviewed", () => {
    const roman = { ...song, originalTitle: "Ｄｒｅａｍ 2026" };
    expect(pairText(songDisplay(roman, song.translations, "ko"))).toBe(roman.originalTitle);
    expect(songNameError({ ...roman, translations: [] }, [], false)).toBeNull();

    const version = { ...roman, variantLabel: "Kozue Ver.", translations: [
      { locale: "ko", title: "", variantLabel: "코즈에 Ver." },
      { locale: "en", title: "", variantLabel: "Kozue Ver." },
    ] };
    expect(songNameError(version, version.translations, false)).toContain("en 버전 라벨");
    expect(songNameError(version, version.translations, true)).toBeNull();
    expect(songDisplay(version, version.translations, "ko").variant).toMatchObject({
      main: "Kozue Ver.", sub: "코즈에 Ver.",
    });
    expect(songDisplay(version, version.translations, "en").variant?.sub).toBeNull();
  });

  it("allows a legacy row through unchanged and rejects stale translations when its source changes", () => {
    const incomplete = { ...song, translations: [] };
    expect(songNameError(incomplete, [], false, incomplete)).toBeNull();
    const changed = { ...song, originalTitle: "新しい曲" };
    expect(songNameError(changed, [], false, song)).toContain("ko 제목");
    expect(songNameError(changed, song.translations, false, song)).toContain("ko 제목");
    expect(songNameError(changed, song.translations, true, song)).toBeNull();
  });

  it("keeps variant-only edits distinct from title removal and rejects malformed rows", () => {
    expect(parseSongTranslations([{ locale: "ko", variantLabel: "코즈에" }])).toEqual([
      { locale: "ko", title: undefined, variantLabel: "코즈에" },
    ]);
    expect(parseSongTranslations([{ locale: "ko", variantLabel: false }])).toBeNull();
    expect(parseSongTranslations([{ locale: "ko" }, { locale: "ko" }])).toBeNull();
  });
});
