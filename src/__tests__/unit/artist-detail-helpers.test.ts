import { describe, expect, it } from "vitest";
import {
  accentStyle,
  fallbackNameLang,
  firstGrapheme,
  originalLang,
} from "@/components/artists/artistDetail";

describe("firstGrapheme", () => {
  it("keeps a surrogate pair whole", () => {
    // charAt(0) would return a lone high surrogate here.
    expect(firstGrapheme("𠮷野")).toBe("𠮷");
  });

  it("keeps a combining sequence whole", () => {
    // Decomposed (NFD) Hangul 카: two code points, one grapheme.
    expect(firstGrapheme("카호")).toBe("카");
  });

  it("skips leading whitespace and falls back for empty input", () => {
    expect(firstGrapheme("  かほ")).toBe("か");
    expect(firstGrapheme("")).toBe("?");
  });
});

describe("fallbackNameLang", () => {
  const ja = { originalLanguage: "ja" };

  it("is unset when the viewer-locale translation exists", () => {
    expect(fallbackNameLang(ja, [{ locale: "en", name: "Kaho" }], "en")).toBe(
      undefined,
    );
  });

  it("marks the original language when the name falls back", () => {
    expect(fallbackNameLang(ja, [{ locale: "ko", name: "카호" }], "en")).toBe(
      "ja",
    );
  });

  it("treats an empty translated name as missing", () => {
    expect(fallbackNameLang(ja, [{ locale: "en", name: "" }], "en")).toBe("ja");
  });

  it("is unset on a page in the original language", () => {
    expect(fallbackNameLang(ja, [], "ja")).toBe(undefined);
  });
});

describe("originalLang", () => {
  it("returns the source language only when it differs from the page", () => {
    expect(originalLang("ja", "ko")).toBe("ja");
    expect(originalLang("ko", "ko")).toBe(undefined);
  });
});

describe("accentStyle", () => {
  it("derives a wash for six-digit hex", () => {
    expect(accentStyle("#EC4899")).toEqual({
      "--accent": "#EC4899",
      "--wash": "#EC489918",
    });
  });

  it("passes a non-hex accent through without a wash", () => {
    expect(accentStyle("linear-gradient(#165dcc, #a855f7)")).toEqual({
      "--accent": "linear-gradient(#165dcc, #a855f7)",
    });
  });
});
