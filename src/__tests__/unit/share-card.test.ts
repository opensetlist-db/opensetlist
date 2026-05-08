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

describe("shareCard — download path (single platform-agnostic flow)", () => {
  // v0.10.x rewrote `shareCard` to a single download-only flow. The
  // earlier mobile (`navigator.share`) + desktop (`window.open` Twitter
  // intent) split was dropped because Twitter's web intent doesn't
  // accept image attachments AND `navigator.share` doesn't reliably
  // surface Twitter in the OS share sheet (operator-confirmed during
  // smoke). Tests here pin the download path specifically; there is
  // no longer a `shared` / `cancelled` / `popup_blocked` outcome.

  it("rasterizes via html2canvas and triggers an anchor download, returning kind: downloaded", async () => {
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

  it("does NOT call navigator.share or window.open (no platform-integration paths remain)", async () => {
    // Regression guard: the v0.10.x rewrite drops both branches.
    // If someone re-introduces either accidentally, this assertion
    // catches it before users see an empty Twitter compose window
    // or a missing-from-share-sheet bug again.
    const shareSpy = vi.fn();
    const openSpy = vi.fn();
    vi.stubGlobal("navigator", {
      canShare: vi.fn().mockReturnValue(true),
      share: shareSpy,
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("open", openSpy);
    const cardEl = document.createElement("div");

    const outcome = await shareCard({ cardEl });

    expect(outcome).toEqual({ kind: "downloaded" });
    expect(shareSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
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
