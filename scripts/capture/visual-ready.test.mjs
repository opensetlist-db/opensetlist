import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { waitForVisualReady } from "./visual-ready.mjs";

const pixel = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>';
const font = readFileSync(new URL("../../node_modules/@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2", import.meta.url));

test("waits for delayed decode and promotes an offscreen lazy image", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.route("https://images.test/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({ status: 200, contentType: "image/svg+xml", body: pixel });
    });
    await page.setContent('<img src="https://images.test/first.svg"><div style="height:1400px"></div><img loading="lazy" src="https://images.test/lazy.svg">', { waitUntil: "domcontentloaded" });
    const result = await waitForVisualReady(page, { timeoutMs: 3000 });
    assert.equal(result.ready, true);
    assert.equal(result.timedOut, false);
    assert.deepEqual(result.images, { total: 2, loaded: 2, promotedLazy: 1 });
    assert.deepEqual(result.brokenImages, []);
    assert.deepEqual(result.pendingImages, []);
    assert.ok(result.elapsedMs >= 200, `elapsed ${result.elapsedMs} ms`);
    assert.equal(await page.evaluate(() => scrollY), 0);
  } finally {
    await browser.close();
  }
});

test("waits for decode after the image has completed loading", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<img src="data:image/svg+xml,${encodeURIComponent(pixel)}">`, { waitUntil: "load" });
    await page.evaluate(() => {
      const original = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () {
        return original.call(this).then(() => new Promise((resolve) => setTimeout(resolve, 250)));
      };
    });
    assert.equal(await page.evaluate(() => document.images[0].complete), true);
    const result = await waitForVisualReady(page, { timeoutMs: 2000 });
    assert.equal(result.ready, true);
    assert.ok(result.elapsedMs >= 250, `elapsed ${result.elapsedMs} ms`);
  } finally {
    await browser.close();
  }
});

test("reports a broken image instead of declaring the page ready", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("https://images.test/broken.png", (route) => route.fulfill({ status: 404, body: "missing" }));
    await page.setContent('<img src="https://images.test/broken.png">', { waitUntil: "domcontentloaded" });
    const result = await waitForVisualReady(page, { timeoutMs: 1000 });
    assert.equal(result.ready, false);
    assert.equal(result.timedOut, false);
    assert.equal(result.brokenImages.length, 1);
    assert.equal(result.brokenImages[0].src, "https://images.test/broken.png");
  } finally {
    await browser.close();
  }
});

test("returns a partial diagnostic when image decoding outlives the deadline", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("https://images.test/slow.svg", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fulfill({ status: 200, contentType: "image/svg+xml", body: pixel }).catch(() => {});
    });
    await page.setContent('<img src="https://images.test/slow.svg">', { waitUntil: "domcontentloaded" });
    const result = await waitForVisualReady(page, { timeoutMs: 120 });
    assert.equal(result.ready, false);
    assert.equal(result.timedOut, true);
    assert.equal(result.pendingImages.length, 1);
    assert.equal(result.pendingImages[0].src, "https://images.test/slow.svg");
    assert.ok(result.elapsedMs < 500, `elapsed ${result.elapsedMs} ms`);
  } finally {
    await browser.close();
  }
});

test("waits for a delayed font and reports a failed font face", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("https://fonts.test/**", async (route) => {
      if (route.request().url().endsWith("slow.woff2")) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        await route.fulfill({ status: 200, contentType: "font/woff2", body: font });
      } else {
        await route.fulfill({ status: 404, body: "missing" });
      }
    });
    await page.setContent("<p>Font probe</p>");
    await page.evaluate(() => {
      const face = new FontFace("SlowProbe", "url(https://fonts.test/slow.woff2)");
      document.fonts.add(face);
      face.load().catch(() => {});
    });
    const loaded = await waitForVisualReady(page, { timeoutMs: 3000 });
    assert.equal(loaded.ready, true);
    assert.equal(loaded.fonts.status, "loaded");
    assert.deepEqual(loaded.fonts.failedFaces, []);
    assert.ok(loaded.elapsedMs >= 200, `elapsed ${loaded.elapsedMs} ms`);

    await page.evaluate(() => {
      const face = new FontFace("BrokenProbe", "url(https://fonts.test/broken.woff2)");
      document.fonts.add(face);
      face.load().catch(() => {});
    });
    const failed = await waitForVisualReady(page, { timeoutMs: 3000 });
    assert.equal(failed.ready, false);
    assert.equal(failed.timedOut, false);
    assert.deepEqual(failed.fonts.failedFaces.map((face) => face.family), ["BrokenProbe"]);
  } finally {
    await browser.close();
  }
});

test("capture writes readiness diagnostics into a partial manifest", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/slow.svg") {
      setTimeout(() => {
        if (!response.destroyed) response.writeHead(200, { "content-type": "image/svg+xml" }).end(pixel);
      }, 1000);
    } else {
      response.writeHead(200, { "content-type": "text/html" }).end(
        '<!doctype html><html lang="ko"><body><div style="height:4000px"></div><img loading="lazy" src="/slow.svg"></body></html>',
      );
    }
  });
  const out = mkdtempSync(path.join(tmpdir(), "visual-ready-capture-"));
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const script = fileURLToPath(new URL("../redesign-capture.mjs", import.meta.url));
    const base = `http://127.0.0.1:${server.address().port}`;
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, "--base", base, "--out", out, "--filter", "ko-home", "--no-webp", "--visual-ready", "--visual-timeout", "0.12", "--page-timeout", "2"], { stdio: "ignore" });
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(exitCode, 1);
    const manifest = JSON.parse(readFileSync(path.join(out, "captures.json"), "utf8"));
    assert.equal(manifest.length, 2);
    for (const entry of manifest) {
      assert.match(entry.error, /visual readiness timeout/);
      assert.equal(entry.visualReadiness.ready, false);
      assert.equal(entry.visualReadiness.timedOut, true);
      assert.deepEqual(entry.visualReadiness.pendingImages.map((image) => image.src), [`${base}/slow.svg`]);
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(out, { recursive: true, force: true });
  }
});
