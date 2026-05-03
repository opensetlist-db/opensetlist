import { describe, it, expect } from "vitest";
import { shouldShowTranslateButton } from "@/lib/translation";
import { buildUserInput } from "@/lib/translator/prompt";

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

describe("buildUserInput", () => {
  // The "translate ... into ko, ja, and en" framing pins the task so the
  // glossary-heavy system prompt can't be misread as an extraction task.
  // The "always return one JSON object inside an array" clause is the
  // load-bearing instruction that prevents the `[]` failure mode (F13).
  it("emits explicit translate task line on the user turn", () => {
    const out = buildUserInput("시작한다", "ko");
    expect(out).toContain("task: translate");
    expect(out).toContain("into ko, ja, and en");
    expect(out).toMatch(/Always return one JSON object inside an array/);
  });

  it("preserves source_locale and text content", () => {
    const out = buildUserInput("오늘 정말 즐거웠어요", "ko");
    expect(out).toContain("source_locale: ko");
    expect(out).toContain("오늘 정말 즐거웠어요");
  });
});
