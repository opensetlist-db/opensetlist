import { describe, it, expect } from "vitest";
import { matchesSongSearch, matchesIdentitySearch, normalizeArtistQuery } from "@/lib/search";

describe("matchesSongSearch", () => {
  const song = {
    originalTitle: "Dream Believers",
    translations: [
      { locale: "ja", title: "ドリームビリーバーズ" },
      { locale: "ko", title: "드림 빌리버즈" },
    ],
  };

  it("matches originalTitle", () => {
    expect(matchesSongSearch(song, "Dream")).toBe(true);
  });

  it("matches ko translation", () => {
    expect(matchesSongSearch(song, "드림")).toBe(true);
  });

  it("matches ja translation", () => {
    expect(matchesSongSearch(song, "ドリーム")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesSongSearch(song, "dream believers")).toBe(true);
    expect(matchesSongSearch(song, "DREAM")).toBe(true);
  });

  it("returns false on no match", () => {
    expect(matchesSongSearch(song, "Euphoria")).toBe(false);
  });

  it("returns true on empty query", () => {
    expect(matchesSongSearch(song, "")).toBe(true);
  });

  it("matches partial strings", () => {
    expect(matchesSongSearch(song, "Believ")).toBe(true);
    expect(matchesSongSearch(song, "빌리")).toBe(true);
  });
});

describe("matchesIdentitySearch", () => {
  const si = {
    translations: [
      { locale: "ja", name: "日下 花帆" },
      { locale: "ko", name: "히노시타 카호" },
    ],
  };

  it("matches ko name", () => {
    expect(matchesIdentitySearch(si, "카호")).toBe(true);
  });

  it("matches ja name", () => {
    expect(matchesIdentitySearch(si, "花帆")).toBe(true);
  });

  it("returns false on no match", () => {
    expect(matchesIdentitySearch(si, "루리노")).toBe(false);
  });

  it("returns true on empty query", () => {
    expect(matchesIdentitySearch(si, "")).toBe(true);
  });
});

describe("normalizeArtistQuery", () => {
  const MU = "μ"; // GREEK SMALL LETTER MU — how μ's is stored

  it("folds MICRO SIGN to Greek mu (NFKC)", () => {
    expect(normalizeArtistQuery("µ's")).toBe(`${MU}'s`);
  });

  it("folds curly / full-width apostrophes to ASCII", () => {
    expect(normalizeArtistQuery(`${MU}’s`)).toBe(`${MU}'s`);
    expect(normalizeArtistQuery(`${MU}＇s`)).toBe(`${MU}'s`);
  });

  it("folds full-width Latin to ASCII and trims", () => {
    expect(normalizeArtistQuery(" Ａqours ")).toBe("Aqours");
  });

  it("leaves Korean / Japanese names untouched", () => {
    expect(normalizeArtistQuery("蓮ノ空")).toBe("蓮ノ空");
    expect(normalizeArtistQuery("니지가사키")).toBe("니지가사키");
  });
});
