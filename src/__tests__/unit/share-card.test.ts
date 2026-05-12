import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shareCard, copyCardToClipboard } from "@/lib/shareCard";

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

describe("shareCard — native share path (touch-primary + navigator.share present)", () => {
  beforeEach(() => {
    // Touch-primary by default for this describe block — these tests
    // exist to exercise the share path. The post-iOS-feedback gate
    // is `pointer: coarse` + `typeof navigator.share === "function"`
    // (the `canShare({ files })` check that was here pre-feedback was
    // dropped because iOS Safari returned false from it even when
    // share would succeed). Individual specs override touch state
    // when they need to assert the desktop fallback below.
    stubTouchPrimary(true);
  });

  it("calls navigator.share with the file on touch-primary devices, returns kind: shared", async () => {
    // Post-iOS-feedback: the canShare({files}) gate was removed
    // because iOS Safari was observed returning false from it even
    // when navigator.share would succeed. The helper now attempts
    // share unconditionally on touch-primary devices when
    // navigator.share exists; the test only stubs `share` (no
    // canShare) and asserts share is invoked with the right payload.
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      share: shareSpy,
    });
    const cardEl = document.createElement("div");

    const outcome = await shareCard({
      cardEl,
      share: { title: "T", text: "X", url: "https://example.com" },
    });

    expect(outcome).toEqual({ kind: "shared" });
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

describe("shareCard — download fallback (non-touch-primary or no navigator.share)", () => {
  beforeEach(() => {
    // Non-touch-primary by default for this describe block — the
    // share branch is gated on `(pointer: coarse) === true`, so
    // setting it false here forces every test to take the download
    // path regardless of navigator state. Pre-feedback this describe
    // relied on test-order side effects (the previous describe's
    // last test left matchMedia=false); explicit setup makes the
    // intent clear and order-independent.
    stubTouchPrimary(false);
  });

  it("rasterizes via html2canvas and triggers an anchor download, returning kind: downloaded", async () => {
    // No navigator stub → typeof navigator.share !== 'function' →
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

  it("non-touch-primary device with navigator.share present → still downloads (desktop with Web Share API doesn't get the share branch)", async () => {
    // The non-touch-primary case is what routes desktops (mouse /
    // trackpad) through download even when they expose
    // `navigator.share` (macOS Safari, recent Chromium). Pre-iOS-
    // feedback this test was named "canShare({files}) returns false"
    // — that check is no longer in the helper, but the *behavioral*
    // pin survives: a desktop with share API still gets download.
    const shareSpy = vi.fn();
    vi.stubGlobal("navigator", {
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

/**
 * Stub `navigator.clipboard` + `window.ClipboardItem` so the copy
 * helper sees a fully-capable environment. The `ClipboardItem`
 * constructor in jsdom is undefined by default, so we install a
 * minimal class shim that just records what was constructed; the
 * helper's only contract with ClipboardItem is "must be invokable
 * with `new` and accept a Record<string, Promise<Blob>>". The
 * `clipboard.write` mock returns a `vi.fn` so individual tests can
 * override its resolution to assert success / NotAllowedError /
 * arbitrary failure paths.
 */
function stubClipboardSupported(): { writeSpy: ReturnType<typeof vi.fn> } {
  const writeSpy = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", {
    clipboard: { write: writeSpy },
  });
  class ClipboardItemShim {
    items: Record<string, Promise<Blob>>;
    constructor(items: Record<string, Promise<Blob>>) {
      this.items = items;
    }
  }
  vi.stubGlobal("ClipboardItem", ClipboardItemShim);
  return { writeSpy };
}

describe("copyCardToClipboard — clipboard write path", () => {
  it("rasterizes the card, constructs a ClipboardItem with image/png Promise<Blob>, and calls clipboard.write → kind: copied", async () => {
    const { writeSpy } = stubClipboardSupported();
    const cardEl = document.createElement("div");

    const outcome = await copyCardToClipboard({ cardEl });

    expect(outcome).toEqual({ kind: "copied" });
    expect(writeSpy).toHaveBeenCalledTimes(1);
    // ClipboardItem instance is the first (and only) array element
    // passed to clipboard.write. Its `items` record should carry
    // `image/png` → a Promise<Blob>. We verify the MIME key and
    // resolve the promise to confirm the blob shape — not just
    // existence — so a future refactor that swaps MIME or drops
    // the promise wrapper fails loudly here.
    const item = writeSpy.mock.calls[0][0][0];
    expect(Object.keys(item.items)).toEqual(["image/png"]);
    const blob = await item.items["image/png"];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");
  });

  it("preserves the user-gesture context by passing the Promise<Blob> to ClipboardItem *before* awaiting the render", async () => {
    // iOS Safari requires the ClipboardItem to receive an unresolved
    // Promise so the user-gesture context (the click event) stays
    // valid across the async html2canvas render. If a future refactor
    // `await renderCardToBlob()` first and then passes the resolved
    // Blob into ClipboardItem, iOS Safari throws NotAllowedError.
    // This test pins the ordering: ClipboardItem must be constructed
    // synchronously inside the click tick, BEFORE the blob resolves.
    //
    // We assert by spying on the ClipboardItem constructor and
    // checking it was called with a `then`-able (Promise-like) for
    // the image/png key, not a resolved Blob.
    const { writeSpy: _writeSpy } = stubClipboardSupported();
    void _writeSpy;
    const cardEl = document.createElement("div");

    const outcome = await copyCardToClipboard({ cardEl });

    expect(outcome).toEqual({ kind: "copied" });
    // Inspect the value passed for image/png: it should be a
    // thenable (Promise). A resolved Blob would still satisfy
    // `instanceof Blob` but fail the `typeof .then === "function"`
    // check — pinning on `.then` documents the API contract.
    const item = _writeSpy.mock.calls[0][0][0];
    const slot = item.items["image/png"];
    expect(typeof slot?.then).toBe("function");
  });

  it("returns kind: unsupported when ClipboardItem is undefined (older Firefox / WebView)", async () => {
    const writeSpy = vi.fn();
    vi.stubGlobal("navigator", {
      clipboard: { write: writeSpy },
    });
    // No ClipboardItem stub → typeof ClipboardItem === 'undefined'.
    const cardEl = document.createElement("div");

    const outcome = await copyCardToClipboard({ cardEl });

    expect(outcome).toEqual({ kind: "unsupported" });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("returns kind: unsupported when navigator.clipboard.write is missing", async () => {
    // navigator.clipboard exists (some browsers expose readText only)
    // but `write` does not. The capability check should reject.
    vi.stubGlobal("navigator", { clipboard: {} });
    class ClipboardItemShim {
      constructor() {}
    }
    vi.stubGlobal("ClipboardItem", ClipboardItemShim);
    const cardEl = document.createElement("div");

    const outcome = await copyCardToClipboard({ cardEl });

    expect(outcome).toEqual({ kind: "unsupported" });
  });

  it("returns kind: denied when clipboard.write rejects with NotAllowedError (user-gesture expired / permission denied)", async () => {
    const notAllowed = new DOMException("permission denied", "NotAllowedError");
    const writeSpy = vi.fn().mockRejectedValue(notAllowed);
    vi.stubGlobal("navigator", {
      clipboard: { write: writeSpy },
    });
    class ClipboardItemShim {
      constructor() {}
    }
    vi.stubGlobal("ClipboardItem", ClipboardItemShim);
    const cardEl = document.createElement("div");

    const outcome = await copyCardToClipboard({ cardEl });

    expect(outcome).toEqual({ kind: "denied" });
  });

  it("returns kind: error when clipboard.write rejects with an arbitrary error", async () => {
    const writeSpy = vi.fn().mockRejectedValue(new Error("clipboard busy"));
    vi.stubGlobal("navigator", {
      clipboard: { write: writeSpy },
    });
    class ClipboardItemShim {
      constructor() {}
    }
    vi.stubGlobal("ClipboardItem", ClipboardItemShim);
    const cardEl = document.createElement("div");

    const outcome = await copyCardToClipboard({ cardEl });

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.message).toBe("clipboard busy");
    }
  });

  it("returns kind: error when html2canvas throws (render failure propagates through ClipboardItem promise)", async () => {
    const html2canvasMod = await import("html2canvas");
    const spy = vi.spyOn(html2canvasMod, "default").mockRejectedValueOnce(
      new Error("canvas tainted"),
    );
    // Capability check must pass so the helper reaches the render
    // step; the rejection happens inside the Promise<Blob> wrapper.
    const writeSpy = vi.fn().mockImplementation(async (items) => {
      // Real browsers await the Promise<Blob> inside ClipboardItem
      // and re-throw on rejection. Simulate by awaiting here so the
      // helper's catch path fires.
      await items[0].items["image/png"];
    });
    vi.stubGlobal("navigator", {
      clipboard: { write: writeSpy },
    });
    class ClipboardItemShim {
      items: Record<string, Promise<Blob>>;
      constructor(items: Record<string, Promise<Blob>>) {
        this.items = items;
      }
    }
    vi.stubGlobal("ClipboardItem", ClipboardItemShim);
    const cardEl = document.createElement("div");

    const outcome = await copyCardToClipboard({ cardEl });

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.message).toBe("canvas tainted");
    }
    spy.mockRestore();
  });
});
