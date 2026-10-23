// @vitest-environment node
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { realWeights, noLoadedFaces, rejectedFaces, fallbackGlyphs, classifyRequestFailure, runtimeFailures, observeFontResponses, responseErrors, loadFontManifest, verifyFontResponses } from "../../../scripts/page-qa/font-proof.mjs";
import { runFontProof } from "../../../scripts/font-proof.mjs";
import { createFoundationScenario } from "../../../scripts/page-qa/scenarios/shared-foundation.mjs";
import sharp from "sharp";

const specimen = () => [400, 500, 600, 700].flatMap((weight, i) => ["latin", "ja", "ko"].map((script) => ({
  selector: `#foundation-${script}-${weight}`,
  fonts: [{ postScriptName: `${script === "latin" ? "DMSans9pt" : "NotoSansJPThin"}-${["Regular", "Medium", "SemiBold", "Bold"][i]}`, isCustomFont: true, glyphCount: script === "latin" ? 15 : 7 }],
})));
const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true }); });

describe("actual font proof", () => {
  it("halts smoke on completed assertion failures and section exceptions/timeouts", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "font-proof-smoke-")); temps.push(dir);
    const screenshot = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).png().toBuffer();
    const page = Object.assign(new EventEmitter(), {
      addInitScript: async () => {}, waitForTimeout: async () => {},
      evaluate: async () => ({ roles: [], faces: [], lang: "ko", overflow: 0 }),
      screenshot: async () => screenshot,
      url: () => "http://localhost/ko/privacy",
      locator: () => ({ evaluate: async () => {} }),
    });
    const ctx = { route: async () => {}, newCDPSession: async () => ({
      send: async (method: string) => method === "DOM.getDocument" ? { root: { nodeId: 1 } } : { nodeId: 0 }, detach: async () => {},
    }) };
    const failures: string[] = [];
    const h = {
      outDir: dir, browserName: "chromium", timeoutMs: 1000, quick: false, webkit: false, base: "http://localhost",
      check: (name: string, ok: boolean) => { if (!ok) failures.push(name); },
      section: vi.fn(async (_name, fn) => { await fn(); return true; }),
      open: async (_url: string, options: { beforeNavigate: (value: unknown) => Promise<void> }) => {
        page.removeAllListeners(); // Model the fresh page/context of each real cell.
        await options.beforeNavigate({ ctx, page });
        return { ctx, page, resp: { status: () => 200 }, errors: [] };
      },
    };
    // The same failing page traverses all 39 quick cells without smoke, so
    // one section below proves early termination rather than an inert mock.
    await createFoundationScenario().run({ ...h, quick: true });
    expect(h.section).toHaveBeenCalledTimes(39);
    h.section.mockClear();
    failures.length = 0;
    await createFoundationScenario({ smoke: true }).run(h);
    expect(failures).toContain("privacy/ko/390/normal actual custom glyphs and weights");
    expect(h.section).toHaveBeenCalledTimes(1);
    // A section that threw/timed out returns false instead of throwing to the
    // scenario. It must also prevent the next state from being attempted.
    h.section.mockReset().mockResolvedValue(false);
    await createFoundationScenario({ smoke: true }).run(h);
    expect(h.section).toHaveBeenCalledTimes(1);
  });

  it("requires every unique specimen, real custom glyphs, face and exact weight", () => {
    const rows = specimen();
    expect(realWeights(rows)).toBe(true);
    rows[0].fonts[0].postScriptName = "DMSans9pt-Bold";
    expect(realWeights(rows)).toBe(false);
    rows[0].fonts[0].postScriptName = "DMSans9pt-Regular";
    expect(realWeights(rows)).toBe(true);
    rows[0].fonts[0].glyphCount = 1;
    expect(realWeights(rows)).toBe(false);
    rows[0].fonts[0].glyphCount = 15;
    expect(realWeights(rows)).toBe(true);
    rows[0].fonts[0].isCustomFont = false;
    expect(realWeights(rows)).toBe(false);
    rows[0].fonts[0].isCustomFont = true;
    rows[0].fonts[0].postScriptName = "WrongFont-Regular";
    expect(realWeights(rows)).toBe(false);
    expect(realWeights(specimen().slice(1))).toBe(false);
    const duplicate = specimen();
    duplicate[1] = duplicate[0];
    expect(realWeights(duplicate)).toBe(false);
  });

  it("distinguishes cold/loading, rejected, loaded and painted fallback", () => {
    const faces = [{ status: "loading" }];
    expect(noLoadedFaces(faces)).toBe(true);
    expect(rejectedFaces(faces)).toBe(false);
    faces[0].status = "error";
    expect(rejectedFaces(faces)).toBe(true);
    faces[0].status = "loaded";
    expect(noLoadedFaces(faces)).toBe(false);
    expect(rejectedFaces(faces)).toBe(false);
    expect(noLoadedFaces([])).toBe(false);
    const rows = [{ fonts: [{ isCustomFont: false, glyphCount: 10 }] }];
    expect(fallbackGlyphs(rows)).toBe(true);
    rows[0].fonts[0].isCustomFont = true;
    expect(fallbackGlyphs(rows)).toBe(false);
    expect(fallbackGlyphs([])).toBe(false);
  });
});

describe("resource evidence", () => {
  const request = (url: string, errorText: string, headers = {}) => ({ url: () => url, failure: () => ({ errorText }), headers: () => headers });
  it("exempts only explicit Next prefetch cancellation, telemetry and intentional font faults", () => {
    expect(classifyRequestFailure(request("/api/data", "net::ERR_ABORTED"), "normal")).toBe("unexpected");
    expect(classifyRequestFailure(request("/api/data", "net::ERR_ABORTED", { "next-router-prefetch": "1" }), "normal")).toBe("prefetch-abort");
    expect(classifyRequestFailure(request("/api/data", "net::ERR_FAILED", { "next-router-prefetch": "1" }), "normal")).toBe("unexpected");
    expect(classifyRequestFailure(request("/font.woff2", "net::ERR_FAILED"), "normal")).toBe("unexpected");
    expect(classifyRequestFailure(request("/font.woff2", "net::ERR_FAILED"), "failure")).toBe("font-fault");
    expect(classifyRequestFailure(request("https://sentry.io/noise", "net::ERR_FAILED"), "normal")).toBe("telemetry");
    expect(runtimeFailures({ errors: ["Failed to load resource: net::ERR_FAILED"], exceptions: [], requests: [] })).toEqual([]);
    expect(runtimeFailures({ errors: ["HTTP 500 /api/data"], exceptions: ["TypeError"], requests: ["/api/data ERR_FAILED"] })).toEqual(["HTTP 500 /api/data", "TypeError", "/api/data ERR_FAILED"]);
  });

  it("consumes immediate response rejection before a later drain and retains URL/status/error", async () => {
    const page = new EventEmitter();
    const observer = observeFontResponses(page);
    const body = Buffer.from("real response");
    page.emit("response", { url: () => "/ok.woff2", status: () => 200, body: () => Promise.resolve(body) });
    page.emit("response", { url: () => "/broken.woff2", status: () => 200, body: () => Promise.reject(new Error("body refused")) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(observer.responses).toContainEqual({ url: "/broken.woff2", status: 200, error: "Error: body refused" });
    const responses = await observer.finish();
    expect(responses).toContainEqual({ url: "/ok.woff2", status: 200, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") });
    expect(responseErrors(responses)).toHaveLength(1);
    expect(page.listenerCount("response")).toBe(0);
  });

  it("validates responses against an explicitly loaded manifest, with empty/error/mismatch controls", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "font-proof-")); temps.push(dir);
    const file = path.join(dir, "approved.json");
    const sha256 = createHash("sha256").update("approved bytes").digest("hex");
    fs.writeFileSync(file, JSON.stringify([{ file: "approved.woff2", sha256 }]));
    const manifest = loadFontManifest(file);
    const response = { url: "/hashed-build-name.woff2", status: 200, sha256 };
    expect(verifyFontResponses([response], manifest)).toEqual([]);
    expect(verifyFontResponses([{ ...response, sha256: "wrong" }], manifest)).toHaveLength(1);
    expect(verifyFontResponses([{ ...response, status: 500 }], manifest)).toHaveLength(1);
    expect(verifyFontResponses([{ url: "/broken.woff2", status: 200, error: "body rejected" }], manifest)).toHaveLength(1);
    expect(verifyFontResponses([], manifest)).toEqual(["no font responses observed"]);
    expect(verifyFontResponses([], manifest, { requireResponses: false })).toEqual([]);
    fs.writeFileSync(file, "[]");
    expect(() => loadFontManifest(file)).toThrow("nonempty array");
    fs.writeFileSync(file, JSON.stringify([{ file: "approved.woff2", sha256 }]));
    const options = { manifest: file, out: dir, browser: "chromium", base: "http://localhost", timeoutMs: 1000, runMs: 5000, smoke: false, quick: false };
    const run = vi.fn().mockResolvedValueOnce({ failed: 1 });
    await runFontProof(options, run);
    expect(run).toHaveBeenCalledTimes(1);
    run.mockReset().mockResolvedValue({ failed: 0 });
    await runFontProof(options, run);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.map(([arg]) => path.basename(arg.outDir))).toEqual(["smoke", "matrix"]);
    run.mockClear();
    await runFontProof({ ...options, smoke: true }, run);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
