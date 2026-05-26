import { describe, it, expect } from "vitest";
import {
  parseBigInt,
  parsePositiveInt,
  parseListingTranslations,
  parseBonusTranslations,
  parsePattern3TrackTranslations,
} from "@/lib/adminParsers";

describe("parsePositiveInt", () => {
  it("accepts safe positive integers", () => {
    expect(parsePositiveInt(1)).toBe(1);
    expect(parsePositiveInt(42)).toBe(42);
    expect(parsePositiveInt("999")).toBe(999);
    expect(parsePositiveInt(Number.MAX_SAFE_INTEGER)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("rejects zero and negatives", () => {
    expect(parsePositiveInt(0)).toBeNull();
    expect(parsePositiveInt(-1)).toBeNull();
    expect(parsePositiveInt("0")).toBeNull();
  });

  it("rejects non-integer numbers", () => {
    expect(parsePositiveInt(1.5)).toBeNull();
    expect(parsePositiveInt("1.5")).toBeNull();
  });

  it("rejects values outside the safe integer range (CR finding)", () => {
    // 9007199254740993 > MAX_SAFE_INTEGER (9007199254740991) and
    // silently rounds to 9007199254740992 when passed through
    // Number(). Without isSafeInteger the parser would accept the
    // rounded value as a "valid" positive int.
    expect(parsePositiveInt("9007199254740993")).toBeNull();
    expect(parsePositiveInt(Number.MAX_SAFE_INTEGER + 2)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(parsePositiveInt("abc")).toBeNull();
    expect(parsePositiveInt(null)).toBeNull();
    expect(parsePositiveInt(undefined)).toBeNull();
    expect(parsePositiveInt({})).toBeNull();
  });
});

describe("parseBigInt", () => {
  it("coerces number / string to bigint", () => {
    expect(parseBigInt(42)).toBe(BigInt(42));
    expect(parseBigInt("123")).toBe(BigInt(123));
  });
  it("rejects garbage", () => {
    expect(parseBigInt("abc")).toBeNull();
    expect(parseBigInt(null)).toBeNull();
    expect(parseBigInt({})).toBeNull();
  });
});

describe("parseListingTranslations", () => {
  it("drops entries missing locale; trims storeName/editionLabel", () => {
    expect(
      parseListingTranslations([
        { locale: "ko", storeName: "  아마존  ", editionLabel: "  통상반  " },
        { locale: "ja", storeName: "", editionLabel: null },
        { storeName: "no-locale" }, // dropped
      ]),
    ).toEqual([
      { locale: "ko", storeName: "아마존", editionLabel: "통상반" },
      { locale: "ja", storeName: null, editionLabel: null },
    ]);
  });

  it("returns [] for non-array input", () => {
    expect(parseListingTranslations(undefined)).toEqual([]);
    expect(parseListingTranslations(null)).toEqual([]);
    expect(parseListingTranslations("not an array")).toEqual([]);
  });
});

describe("parseBonusTranslations", () => {
  it("trims bonusType; preserves null when blank", () => {
    expect(
      parseBonusTranslations([
        { locale: "ko", bonusType: "  태피스트리  " },
        { locale: "ja", bonusType: "" },
      ]),
    ).toEqual([
      { locale: "ko", bonusType: "태피스트리" },
      { locale: "ja", bonusType: null },
    ]);
  });
});

describe("parsePattern3TrackTranslations", () => {
  it("drops empty titles + trims survivors", () => {
    expect(
      parsePattern3TrackTranslations([
        { locale: "ko", title: "  드라마  " },
        { locale: "ja", title: "  " }, // dropped
        { locale: "en", title: "Drama" },
      ]),
    ).toEqual([
      { locale: "ko", title: "드라마" },
      { locale: "en", title: "Drama" },
    ]);
  });
});
