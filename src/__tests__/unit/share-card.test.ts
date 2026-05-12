import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shareCard } from "@/lib/shareCard";

// Stub html2canvas via dynamic import. The helper does
// `await import("html2canvas")` then calls `mod.default(el, opts)`.
// Vitest hoists vi.mock above imports, so the dynamic import inside
// shareCard resolves to this mock.
vi.mock("html2canvas", () => ({
  default: vi.fn(async () => {
    // Minimal canvas stub — toBlob is the only method shareCard
    // actually uses. Returns a 1×1 PNG blob. Callback is typed as
    // `Blob | null` to match the BlobCallback browser spec
    // (lib.dom.d.ts) — the per-test toBlob-null override below
    // depends on this matching shape. CR #295 nit.
    return {
      toBlob: (cb: (b: Blob | null) => void) => {
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

/**
 * Stub `window.matchMedia` so the touch-primary gate in shareCard
 * reports the requested shape. `(pointer: coarse)` → true simulates
 * a phone/tablet finger; false simulates desktop mouse/trackpad. Any
 * other media query falls through to `matches: false` (the test
 * environment never uses them, but the spec demands a defined return).
 */
function stubTouchPrimary(matches: boolean): void {
  const matchMediaSpy = vi.fn((query: string) => ({
    matches: query === "(pointer: coarse)" ? matches : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  }));
  // jsdom defines `window.matchMedia` as undefined by default, so
  // assigning directly is fine; the unstubAllGlobals call in
  // beforeEach/afterEach can't reach window.matchMedia (only
  // vi.stubGlobal-managed entries) but the property is overwritten
  // fresh on every stubTouchPrimary call.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMediaSpy,
  });
}

describe("shareCard — native share path (touch-primary devices + canShare-capable browsers)", () => {
  beforeEach(() => {
    // Touch-primary by default for this describe block — these tests
    // exist to exercise the share path. Individual specs override
    // when they need to assert the desktop fallback (see "desktop
    // even when canShare succeeds" below).
    stubTouchPrimary(true);
  });

  it("calls navigator.share with the file when canShare({ files }) returns true, returns kind: shared", async () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    const canShareSpy = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", {
      canShare: canShareSpy,
      share: shareSpy,
    });
    const cardEl = document.createElement("div");

    const outcome = await shareCard({
      cardEl,
      share: { title: "T", text: "X", url: "https://example.com" },
    });

    expect(outcome).toEqual({ kind: "shared" });
    expect(canShareSpy).toHaveBeenCalledWith(
      expect.objectContaining({ files: expect.any(Array) }),
    );
    expect(shareSpy).toHaveBeenCalledTimes(1);
    const payload = shareSpy.mock.calls[0][0];
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0]).toBeInstanceOf(File);
    expect(payload.files[0].type).toBe("image/png");
    expect(payload.title).toBe("T");
    expect(payload.text).toBe("X");
    expect(payload.url).toBe("https://example.com");
  });

  it("returns kind: cancelled when navigator.share rejects with AbortError (user dismissed sheet)", async () => {
    const abort = new DOMException("aborted", "AbortError");
    vi.stubGlobal("navigator", {
      canShare: vi.fn().mockReturnValue(true),
      share: vi.fn().mockRejectedValue(abort),
    });
    const cardEl = document.createElement("div");

    const outcome = await shareCard({ cardEl });

    expect(outcome).toEqual({ kind: "cancelled" });
  });

  it("falls back to download when navigator.share rejects with a non-abort error", async () => {
    vi.stubGlobal("navigator", {
      canShare: vi.fn().mockReturnValue(true),
      share: vi.fn().mockRejectedValue(new Error("permission denied")),
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    const appendChildSpy = vi.spyOn(document.body, "appendChild");
    const cardEl = document.createElement("div");

    const outcome = await shareCard({ cardEl });

    expect(outcome).toEqual({ kind: "downloaded" });
    const appended = appendChildSpy.mock.calls.find(
      ([n]) => (n as HTMLElement).tagName === "A",
    );
    expect(appended).toBeTruthy();
  });

  it("falls back to download on desktop (pointer: fine) even when canShare({ files }) returns true — macOS regression", async () => {
    // macOS Safari + Chrome both pass `canShare({ files })`, but
    // their OS share sheet has no "save to Downloads" entry. A user
    // who taps 이미지 저장 on a MacBook gets stuck in a Mail / Messages
    // / AirDrop sheet with no way to save the PNG. The touch-primary
    // gate (`(pointer: coarse)`) skips the share branch on desktop
    // regardless of capability so the download fallback always runs.
    stubTouchPrimary(false);
    const shareSpy = vi.fn();
    vi.stubGlobal("navigator", {
      canShare: vi.fn().mockReturnValue(true),
      share: shareSpy,
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    const cardEl = document.createElement("div");

    const outcome = await shareCard({ cardEl });

    expect(outcome).toEqual({ kind: "downloaded" });
    // canShare succeeds but the touch-primary gate blocks the
    // share branch — navigator.share must NOT be invoked.
    expect(shareSpy).not.toHaveBeenCalled();
  });
});

describe("shareCard — download fallback (no canShare support)", () => {
  it("rasterizes via html2canvas and triggers an anchor download, returning kind: downloaded", async () => {
    // No navigator stub → typeof navigator.canShare !== 'function' →
    // skip the share branch entirely and go straight to download.
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    const appendChildSpy = vi.spyOn(document.body, "appendChild");
    const cardEl = document.createElement("div");

    const outcome = await shareCard({ cardEl });

    expect(outcome).toEqual({ kind: "downloaded" });
    // The hidden anchor was appended to <body>, has the correct
    // `download` attr, and points at the blob: object URL.
    const appended = appendChildSpy.mock.calls.find(
      ([n]) => (n as HTMLElement).tagName === "A",
    );
    expect(appended).toBeTruthy();
    const anchor = appended?.[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("opensetlist-result.png");
    expect(anchor.href).toContain("blob:");
  });

  it("uses the caller-provided filename when supplied", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    const appendChildSpy = vi.spyOn(document.body, "appendChild");
    const cardEl = document.createElement("div");

    await shareCard({ cardEl, filename: "custom-name.png" });

    const appended = appendChildSpy.mock.calls.find(
      ([n]) => (n as HTMLElement).tagName === "A",
    );
    expect((appended?.[0] as HTMLAnchorElement).download).toBe(
      "custom-name.png",
    );
  });

  it("falls back to download when canShare({ files }) returns false (e.g. desktop without file-share)", async () => {
    // navigator exists, share fn exists, but the platform refuses to
    // share files (typical on older desktop Chrome). Should skip the
    // share path and download instead.
    const shareSpy = vi.fn();
    vi.stubGlobal("navigator", {
      canShare: vi.fn().mockReturnValue(false),
      share: shareSpy,
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    const cardEl = document.createElement("div");

    const outcome = await shareCard({ cardEl });

    expect(outcome).toEqual({ kind: "downloaded" });
    expect(shareSpy).not.toHaveBeenCalled();
  });
});

describe("shareCard — error paths", () => {
  it("returns kind: error when html2canvas throws", async () => {
    const html2canvasMod = await import("html2canvas");
    const spy = vi.spyOn(html2canvasMod, "default").mockRejectedValueOnce(
      new Error("canvas tainted"),
    );
    const cardEl = document.createElement("div");
    const outcome = await shareCard({ cardEl });
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.message).toBe("canvas tainted");
    }
    spy.mockRestore();
  });

  it("returns kind: error when canvas.toBlob yields null (e.g. tainted canvas)", async () => {
    const html2canvasMod = await import("html2canvas");
    const spy = vi.spyOn(html2canvasMod, "default").mockResolvedValueOnce({
      toBlob: (cb: (b: Blob | null) => void) => cb(null),
    } as unknown as HTMLCanvasElement);
    const cardEl = document.createElement("div");
    const outcome = await shareCard({ cardEl });
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.message).toBe("canvas.toBlob returned null");
    }
    spy.mockRestore();
  });
});
