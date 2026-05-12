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

describe("shareCard — native share path (navigator.share present)", () => {
  it("navigator.share present + resolves → calls share with the file, returns kind: shared", async () => {
    // Post-iOS-feedback final shape: the gate is purely
    // `typeof navigator.share === "function"`. canShare is NOT
    // consulted — operator-spotted on iPhone that canShare({files})
    // could return false even when share() would succeed, breaking
    // the share path on a non-trivial slice of real iOS Safari
    // installs. Trusting the call attempt instead is more permissive
    // and more reliable; failure modes fall through to download.
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

  it("share attempted even when canShare({files}) would return false → exercises the iOS workaround path", async () => {
    // Defensive pin on the post-iOS-feedback design decision: we
    // call navigator.share REGARDLESS of canShare's verdict. This
    // test stubs canShare to return false (simulating the unreliable
    // iOS Safari behavior) AND share to resolve — the helper should
    // still attempt share and return `shared`. If a future refactor
    // re-introduces a canShare gate, this test fails loudly so the
    // iOS regression doesn't sneak back in.
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    const canShareSpy = vi.fn().mockReturnValue(false);
    vi.stubGlobal("navigator", {
      canShare: canShareSpy,
      share: shareSpy,
    });
    const cardEl = document.createElement("div");

    const outcome = await shareCard({ cardEl });

    expect(outcome).toEqual({ kind: "shared" });
    expect(shareSpy).toHaveBeenCalledTimes(1);
    // canShare may or may not have been called by other code paths,
    // but the helper itself doesn't gate on its return value.
  });

  it("returns kind: cancelled when navigator.share rejects with AbortError (user dismissed sheet)", async () => {
    const abort = new DOMException("aborted", "AbortError");
    vi.stubGlobal("navigator", {
      share: vi.fn().mockRejectedValue(abort),
    });
    const cardEl = document.createElement("div");

    const outcome = await shareCard({ cardEl });

    expect(outcome).toEqual({ kind: "cancelled" });
  });

  it("falls back to download when navigator.share rejects with a non-abort error", async () => {
    // The catch-all path: any non-abort share failure (platform
    // can't share files, file-too-large, permission-policy, etc.)
    // routes to download so the user always ends up with the image.
    vi.stubGlobal("navigator", {
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
});

describe("shareCard — download fallback (navigator.share missing)", () => {
  it("no navigator stub → typeof navigator.share !== 'function' → download fallback", async () => {
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

  it("navigator.clipboard-only stub (no share) → download fallback", async () => {
    // Some browsers expose `navigator` without the Web Share API
    // (older Chrome, every desktop Firefox). The download path is
    // the unconditional fallback. The stub deliberately includes
    // `clipboard` but not `share` to mirror that real-world shape.
    vi.stubGlobal("navigator", {
      clipboard: { write: vi.fn() },
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    const cardEl = document.createElement("div");

    const outcome = await shareCard({ cardEl });

    expect(outcome).toEqual({ kind: "downloaded" });
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
