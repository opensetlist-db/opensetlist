import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shareCard } from "@/lib/shareCard";

// Stub html2canvas via dynamic import. The helper does
// `await import("html2canvas")` then calls `mod.default(el, opts)`.
// Vitest hoists vi.mock above imports, so the dynamic import inside
// shareCard resolves to this mock.
vi.mock("html2canvas", () => ({
  default: vi.fn(async () => {
    // Minimal canvas stub — toBlob is the only method shareCard
    // actually uses. Returns a 1×1 PNG blob.
    return {
      toBlob: (cb: (b: Blob) => void) => {
        cb(new Blob(["fake-png"], { type: "image/png" }));
      },
    } as unknown as HTMLCanvasElement;
  }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shareCard — mobile (navigator.canShare returns true)", () => {
  it("invokes navigator.share with the file + text + url and returns shared", async () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      canShare: vi.fn().mockReturnValue(true),
      share: shareSpy,
    });
    const cardEl = document.createElement("div");
    const outcome = await shareCard({
      cardEl,
      text: "tweet body",
      url: "https://example.test/event/1",
    });
    expect(outcome).toEqual({ kind: "shared" });
    expect(shareSpy).toHaveBeenCalledOnce();
    const arg = shareSpy.mock.calls[0][0];
    expect(arg.text).toBe("tweet body");
    expect(arg.url).toBe("https://example.test/event/1");
    expect(arg.files).toHaveLength(1);
    expect(arg.files[0].name).toBe("opensetlist-result.png");
    expect(arg.files[0].type).toBe("image/png");
  });

  it("returns kind: cancelled when the user dismisses the native sheet (AbortError)", async () => {
    const shareSpy = vi
      .fn()
      .mockRejectedValue(new DOMException("aborted", "AbortError"));
    vi.stubGlobal("navigator", {
      canShare: vi.fn().mockReturnValue(true),
      share: shareSpy,
    });
    const cardEl = document.createElement("div");
    const outcome = await shareCard({
      cardEl,
      text: "x",
      url: "https://example.test/",
    });
    expect(outcome).toEqual({ kind: "cancelled" });
  });

  it("returns kind: error on a non-abort share rejection", async () => {
    vi.stubGlobal("navigator", {
      canShare: vi.fn().mockReturnValue(true),
      share: vi.fn().mockRejectedValue(new Error("permission denied")),
    });
    const cardEl = document.createElement("div");
    const outcome = await shareCard({
      cardEl,
      text: "x",
      url: "https://example.test/",
    });
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.message).toBe("permission denied");
    }
  });
});

describe("shareCard — desktop (no navigator.canShare)", () => {
  it("triggers a download + opens Twitter intent and returns kind: downloaded", async () => {
    const openSpy = vi.fn();
    // Stub navigator without canShare → falls through to desktop path.
    vi.stubGlobal("navigator", {
      // canShare absent
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("open", openSpy);
    // Spy on appendChild so we know the anchor was clicked.
    const appendChildSpy = vi.spyOn(document.body, "appendChild");
    const cardEl = document.createElement("div");

    const outcome = await shareCard({
      cardEl,
      text: "tweet body",
      url: "https://example.test/event/1",
    });

    expect(outcome).toEqual({ kind: "downloaded" });
    // Anchor with the download attribute was appended (then removed).
    expect(appendChildSpy).toHaveBeenCalled();
    const appended = appendChildSpy.mock.calls.find(
      ([n]) => (n as HTMLElement).tagName === "A",
    );
    expect(appended).toBeTruthy();
    // Twitter intent opened with text + url query params.
    expect(openSpy).toHaveBeenCalledOnce();
    const intentUrl = openSpy.mock.calls[0][0] as string;
    expect(intentUrl).toContain("twitter.com/intent/tweet");
    expect(intentUrl).toContain(encodeURIComponent("tweet body"));
    expect(intentUrl).toContain(encodeURIComponent("https://example.test/event/1"));
  });
});

describe("shareCard — popup blocked (window.open returns null)", () => {
  it("returns kind: popup_blocked instead of downloaded so caller can toast a different message", async () => {
    vi.stubGlobal("navigator", {
      // canShare absent → desktop fallback path
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    // window.open returning null is the popup-blocker signal in
    // every browser. CR #281 caught the original code returning
    // `downloaded` regardless.
    vi.stubGlobal("open", vi.fn(() => null));
    const cardEl = document.createElement("div");
    const outcome = await shareCard({
      cardEl,
      text: "x",
      url: "https://example.test/",
    });
    expect(outcome).toEqual({ kind: "popup_blocked" });
  });
});

describe("shareCard — html2canvas failure", () => {
  it("returns kind: error when html2canvas throws", async () => {
    const html2canvasMod = await import("html2canvas");
    const spy = vi.spyOn(html2canvasMod, "default").mockRejectedValueOnce(
      new Error("canvas tainted"),
    );
    const cardEl = document.createElement("div");
    const outcome = await shareCard({
      cardEl,
      text: "x",
      url: "https://example.test/",
    });
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.message).toBe("canvas tainted");
    }
    spy.mockRestore();
  });
});
