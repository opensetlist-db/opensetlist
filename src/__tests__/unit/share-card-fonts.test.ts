import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareShareCardFonts } from "@/lib/shareCardFonts";
import { renderCardToBlob } from "@/lib/shareCard";

vi.mock("html2canvas", () => ({ default: vi.fn(async () => ({
  toBlob: (callback: BlobCallback) => callback(new Blob(["png"], { type: "image/png" })),
})) }));

function face(family: string, weight: string, unicodeRange: string, fail = false) {
  const result = {
    family, weight, unicodeRange, style: "normal", status: "unloaded",
    load: vi.fn(async () => {
      result.status = fail ? "error" : "loaded";
      if (fail) throw new Error("offline");
      return result;
    }),
  };
  return result;
}

function card(text: string, weight = "400") {
  const el = document.createElement("div");
  el.style.cssText = `font-family: 'DM Sans', 'Noto Sans KR', sans-serif; font-weight: ${weight}; font-style: normal`;
  el.textContent = text;
  document.body.append(el);
  return el;
}

function provideFonts(faces: unknown[]) {
  Object.defineProperty(document, "fonts", { configurable: true, get: () => new Set(faces) });
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("share image font delivery", () => {
  it("loads both Latin and Korean faces used by mixed text before allowing capture", async () => {
    const latin = face("DM Sans", "400", "U+0000-00FF");
    const korean = face("Noto Sans KR", "400", "U+AC00-D7A3");
    provideFonts([latin, korean]);
    await prepareShareCardFonts(card("OPEN 곡"));
    expect(latin.load).toHaveBeenCalledOnce();
    expect(korean.load).toHaveBeenCalledOnce();
    expect([latin.status, korean.status]).toEqual(["loaded", "loaded"]);
  });

  it("rejects missing glyphs and synthetic weights even if a different face is available", async () => {
    const regular = face("DM Sans", "400", "U+0000-00FF");
    provideFonts([regular]);
    await expect(prepareShareCardFonts(card("OPEN"))).resolves.toBeUndefined();
    await expect(prepareShareCardFonts(card("OPEN", "600"))).rejects.toThrow("weight unavailable");
    await expect(prepareShareCardFonts(card("곡"))).rejects.toThrow("glyph");
  });

  it("keeps family priority, wildcard coverage and exact weights across mixed text", async () => {
    const latin = face("DM Sans", "400", "U+0000-00FF");
    const bold = face("DM Sans", "700", "U+0000-00FF");
    const korean = face("Noto Sans KR", "400", "U+AC??");
    const fallback = face("Noto Sans KR", "400", "U+0000-00FF");
    fallback.status = "loaded";
    provideFonts([fallback, korean, bold, latin]);
    const target = card("O각");
    target.append(card("O", "700"));
    await prepareShareCardFonts(target);
    expect([latin.status, korean.status, bold.status]).toEqual(["loaded", "loaded", "loaded"]);
    expect(latin.load).toHaveBeenCalledOnce();
    // The declared Latin family above supplies O; the available Korean Latin
    // subset must not replace it just because it precedes it in FontFaceSet.
  });

  it("reuses a loaded replacement before the original failed face within the same family", async () => {
    const broken = face("DM Sans", "400", "U+0-FF", true);
    broken.status = "error";
    provideFonts([broken]);
    const target = card("OPEN");
    await expect(prepareShareCardFonts(target)).rejects.toThrow("font unavailable");
    const recovered = face("DM Sans", "400", "U+0-FF");
    recovered.status = "loaded";
    provideFonts([broken, recovered]);
    await prepareShareCardFonts(target);
    expect(recovered.load).toHaveBeenCalledOnce();
    expect(recovered.status).toBe("loaded");
  });

  it("does not pass a failed font load as a successful fallback image", async () => {
    const broken = face("DM Sans", "400", "U+0000-00FF", true);
    provideFonts([broken]);
    await expect(prepareShareCardFonts(card("OPEN"))).rejects.toThrow("offline");
    expect(broken.load).toHaveBeenCalledOnce();
  });

  it("retries an errored CSS face from its original self-hosted source", async () => {
    const broken = face('"DM Sans"', "400", "U+0-FF", true);
    provideFonts([broken]);
    const target = card("OPEN");
    await expect(prepareShareCardFonts(target)).rejects.toThrow("offline");
    const replacement = face("DM Sans", "400", "U+0-FF");
    const constructor = vi.fn(function () { return replacement; });
    vi.stubGlobal("FontFace", constructor);
    // jsdom discards font-face src/unicode-range descriptors. Supply the
    // browser CSSOM boundary; actual stylesheet recovery runs in page QA.
    const declarations: Record<string, string> = {
      "font-family": '"DM Sans"', "font-weight": "400", "font-style": "normal",
      "unicode-range": "U+0-FF", src: 'url("/font.woff2")',
    };
    vi.spyOn(document, "styleSheets", "get").mockReturnValue([{
      href: null, cssRules: [{ type: CSSRule.FONT_FACE_RULE, style: {
        getPropertyValue: (key: string) => declarations[key] ?? "",
      } }],
    }] as unknown as StyleSheetList);
    await expect(prepareShareCardFonts(target)).resolves.toBeUndefined();
    expect(constructor).toHaveBeenCalledOnce();
    expect(constructor).toHaveBeenCalledWith("DM Sans", expect.any(String), expect.objectContaining({ weight: "400" }));
    expect(replacement.load).toHaveBeenCalledOnce();
  });

  it("evicts a stalled retry and does not install its late face after a successful new attempt", async () => {
    vi.useFakeTimers();
    const broken = face('"DM Sans"', "400", "U+0-FF", true);
    broken.status = "error";
    const fonts = new Set<unknown>([broken]);
    Object.defineProperty(document, "fonts", { configurable: true, get: () => fonts });
    const declarations: Record<string, string> = {
      "font-family": '"DM Sans"', "font-weight": "400", "font-style": "normal",
      "unicode-range": "U+0-FF", src: 'url("/font.woff2")',
    };
    vi.spyOn(document, "styleSheets", "get").mockReturnValue([{
      href: null, cssRules: [{ type: CSSRule.FONT_FACE_RULE, style: {
        getPropertyValue: (key: string) => declarations[key] ?? "",
      } }],
    }] as unknown as StyleSheetList);
    const stalled = face("DM Sans", "400", "U+0-FF");
    let finish!: () => void;
    stalled.load.mockImplementation(() => new Promise((resolve) => {
      finish = () => { stalled.status = "loaded"; resolve(stalled); };
    }));
    const recovered = face("DM Sans", "400", "U+0-FF");
    const constructor = vi.fn().mockImplementationOnce(function () { return stalled; })
      .mockImplementationOnce(function () { return recovered; });
    vi.stubGlobal("FontFace", constructor);
    const target = card("OPEN");
    const first = expect(prepareShareCardFonts(target)).rejects.toThrow("font unavailable");
    await vi.advanceTimersByTimeAsync(10000);
    await first;
    await prepareShareCardFonts(target);
    expect(constructor).toHaveBeenCalledTimes(2);
    expect(fonts.has(recovered)).toBe(true);
    finish();
    await vi.runAllTimersAsync();
    expect(fonts.has(stalled)).toBe(false);
  });

  it("stops the actual PNG pipeline before canvas when required fonts cannot load", async () => {
    const latin = face("DM Sans", "400", "U+0000-00FF");
    provideFonts([latin]);
    const target = card("OPEN");
    target.setAttribute("data-share-card", "");
    const canvas = await import("html2canvas");
    await expect(renderCardToBlob(target)).resolves.toBeInstanceOf(Blob);
    expect(canvas.default).toHaveBeenCalledOnce();
    vi.mocked(canvas.default).mockClear();
    // Positive control above reaches the PNG renderer; removing the face makes
    // this real capture fail instead of silently accepting a fallback.
    provideFonts([]);
    await expect(renderCardToBlob(target)).rejects.toThrow("glyph");
    expect(canvas.default).not.toHaveBeenCalled();
  });

  it("releases a stalled font load at the deadline and never starts late canvas work", async () => {
    const regular = face("DM Sans", "400", "U+0000-00FF");
    provideFonts([regular]);
    const target = card("OPEN");
    target.setAttribute("data-share-card", "");
    const canvas = await import("html2canvas");
    await renderCardToBlob(target);
    expect(canvas.default).toHaveBeenCalled();
    vi.mocked(canvas.default).mockClear();
    let finish!: () => void;
    regular.load.mockImplementation(() => new Promise((resolve) => {
      finish = () => resolve(regular);
    }));
    vi.useFakeTimers();
    const stalled = expect(renderCardToBlob(target)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15000);
    await stalled;
    finish();
    await vi.runAllTimersAsync();
    expect(canvas.default).not.toHaveBeenCalled();
  });
});
