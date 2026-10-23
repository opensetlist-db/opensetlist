#!/usr/bin/env node
// A loopback-only, no-database experiment. These fixtures deliberately mimic
// only the shared roles needed by the scenario; they are not app/iOS evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { runScenario } from "./page-qa/harness.mjs";
import { createFoundationScenario } from "./page-qa/scenarios/shared-foundation.mjs";
import { loadFontManifest, classifyRequestFailure, observeFontResponses, verifyFontResponses } from "./page-qa/font-proof.mjs";

const { values } = parseArgs({ options: { manifest: { type: "string" }, out: { type: "string" } } });
if (!values.manifest || !values.out) throw new Error("usage: node scripts/font-proof-browser-check.mjs --manifest <approved.json> --out <dir>");
const manifest = loadFontManifest(values.manifest);
const out = path.resolve(values.out);
fs.mkdirSync(out, { recursive: true });
const packages = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../node_modules/@fontsource");
const assets = new Map();
let css = "";
for (const family of ["dm-sans", "noto-sans-kr", "noto-sans-jp", "josefin-sans"]) {
  for (const weight of family === "josefin-sans" ? [400] : [400, 500, 600, 700]) {
    const source = fs.readFileSync(path.join(packages, family, `${weight}.css`), "utf8");
    css += source.replace(/url\(\.\/files\/([^)]*)\)/g, (_, file) => {
      const url = `/fonts/${family}/${file}`;
      assets.set(url, path.join(packages, family, "files", file));
      return `url(${url})`;
    });
  }
}
const body = (mode) => `<!doctype html><html lang="ko"><head><style>${mode === "wrong-weight" ? css.replace(/-(500|600|700)-normal/g, "-400-normal") : css}
:root{--font-body:"DM Sans","Noto Sans KR","Noto Sans JP",sans-serif}body{font-family:var(--font-body);margin:16px} .font-josefin{font-family:"Josefin Sans";font-size:20px;font-weight:400;letter-spacing:.4px;text-transform:uppercase}</style></head><body><header><span class="font-josefin">OpenSetlist</span></header><main><h1>공연 Live</h1><h2>음악 안내</h2><a href="/ko/privacy">Privacy</a></main><footer><span class="font-josefin">OpenSetlist</span></footer></body></html>`;
let mode = "normal";
const server = http.createServer((req, res) => {
  const asset = assets.get(req.url);
  if (asset) {
    res.writeHead(200, { "Content-Type": "font/woff2" });
    res.end(fs.readFileSync(asset));
  } else if (req.url === "/missing.woff2") {
    res.writeHead(503); res.end("font unavailable");
  } else {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(body(mode));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const results = {};
let browser;
try {
  for (const variant of ["normal", "wrong-weight"]) {
    mode = variant;
    const scenario = createFoundationScenario({ smoke: true, manifest });
    results[variant] = await runScenario({
      scenario: { ...scenario, run: (h) => scenario.run({ ...h, open: (url, options) => h.open(url, { ...options, hydrate: null }) }) },
      base, outDir: path.join(out, variant), browserName: "chromium", quick: false, timeoutMs: 15000, runMs: 120000,
    });
  }
  assert.equal(results.normal.failed, 0, "normal/cold/failure fixtures must pass");
  assert.deepEqual(results["wrong-weight"].results.filter((check) => !check.ok).map((check) => check.name),
    ["privacy/ko/390/normal actual custom glyphs and weights"],
    "only the actual-weight detector may fail in the wrong-weight control");
  const wrong = JSON.parse(fs.readFileSync(path.join(out, "wrong-weight/font-evidence-chromium.json"), "utf8"));
  assert.equal(wrong.entries.length, 1, "preflight must stop after its first failed cell");

  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(base);
  const failures = [];
  page.on("requestfailed", (request) => failures.push({ url: request.url(), error: request.failure()?.errorText, classification: classifyRequestFailure(request, "normal") }));
  await page.route("**/api/*", (route) => route.abort(route.request().url().endsWith("/failed") ? "failed" : "aborted"));
  for (const [endpoint, prefetch] of [["cancel", false], ["cancel-prefetch", true], ["failed", true]]) {
    await page.evaluate(async ({ endpoint, prefetch }) => {
      await fetch(`/api/${endpoint}`, { headers: prefetch ? { "next-router-prefetch": "1" } : {} }).catch(() => {});
    }, { endpoint, prefetch });
  }
  assert.deepEqual(failures.map((failure) => failure.classification), ["unexpected", "prefetch-abort", "unexpected"]);
  const observer = observeFontResponses(page);
  await page.evaluate(async () => { await fetch("/missing.woff2"); });
  const responses = await observer.finish();
  const errors = verifyFontResponses(responses, manifest);
  assert.ok(errors.some((error) => error.includes("HTTP 503")));
  results.requests = failures;
  results.responseErrors = errors;
  console.log("PASS: three font states, synthetic weight, HTTP error and explicit prefetch cancellation controls");
} finally {
  fs.writeFileSync(path.join(out, "experiment.json"), JSON.stringify(results, null, 2));
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
