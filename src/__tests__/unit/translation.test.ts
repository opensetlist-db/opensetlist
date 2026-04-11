import { describe, it, expect } from "vitest";
import { shouldShowTranslateButton } from "@/lib/translation";

describe("shouldShowTranslateButton", () => {
  it("returns false for known locale", () => {
    expect(shouldShowTranslateButton("ja", ["ko", "ja", "en"])).toBe(false);
  });

  it("returns true for unknown locale", () => {
    expect(shouldShowTranslateButton("zh-CN", ["ko", "ja"])).toBe(true);
  });

  it("returns false for preferred locale", () => {
    expect(shouldShowTranslateButton("ko", ["ko"])).toBe(false);
  });

  it("returns false when detectedLocale is null", () => {
    expect(shouldShowTranslateButton(null, ["ko"])).toBe(false);
  });

  it("returns false when detectedLocale is undefined", () => {
    expect(shouldShowTranslateButton(undefined, ["ko"])).toBe(false);
  });
});
