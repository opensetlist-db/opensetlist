import { describe, it, expect } from "vitest";
import { parseArtistTranslations } from "@/app/api/admin/artists/_validate";

describe("parseArtistTranslations", () => {
  it("keeps shortName alongside name and bio", () => {
    const r = parseArtistTranslations([
      { locale: "ja", name: "蓮ノ空女学院スクールアイドルクラブ", shortName: "蓮ノ空", bio: "" },
      { locale: "ko", name: "하스노소라 여학원 스쿨 아이돌 클럽", shortName: "하스노소라", bio: "소개" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([
      { locale: "ja", name: "蓮ノ空女学院スクールアイドルクラブ", shortName: "蓮ノ空", bio: null },
      { locale: "ko", name: "하스노소라 여학원 스쿨 아이돌 클럽", shortName: "하스노소라", bio: "소개" },
    ]);
  });

  it("preserves an omitted shortName and normalizes an explicit blank to null", () => {
    const r = parseArtistTranslations([
      { locale: "en", name: "Hasunosora", shortName: "" },
      { locale: "ja", name: "蓮ノ空" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((t) => t.shortName)).toEqual([null, undefined]);
  });

  it("rejects a non-string shortName", () => {
    const r = parseArtistTranslations([{ locale: "ja", name: "x", shortName: 1 }]);
    expect(r.ok).toBe(false);
  });
});
