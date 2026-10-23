import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { chromium, webkit } from "@playwright/test";
import { waitForVisualReady } from "../capture/visual-ready.mjs";
import { captureComputed, compareComputed } from "./computed.mjs";
import { comparePng } from "./compare.mjs";

// The caller supplies a small, explicit case list. Expanding a run always
// captures the heaviest case first on BOTH builds; a failed canary closes
// the gate before the remaining URLs can consume minutes of browser time.
export async function runPaired({ before, after, cases, canary, out, expand = false,
  browserName = "chromium", timeoutMs = 30000, runMs = 600000 }) {
  validateCases(cases, canary);
  if (!["chromium", "webkit"].includes(browserName)) throw new Error("browser must be chromium or webkit");
  for (const base of [before, after]) {
    if (!["http:", "https:"].includes(new URL(base).protocol)) throw new Error("base must be an HTTP URL");
  }
  const order = [cases.find((c) => c.key === canary), ...cases.filter((c) => c.key !== canary)];
  const selected = expand ? order : order.slice(0, 1);
  fs.mkdirSync(out, { recursive: true });
  const manifestFile = path.join(out, "paired.json");
  const manifest = { schemaVersion: 1, startedAt: new Date().toISOString(), before, after,
    browser: browserName, canary, expand, timeoutMs, runMs, status: "running",
    planned: selected.map((c) => c.key), deferred: expand ? [] : order.slice(1).map((c) => c.key),
    completed: [], pending: selected.map((c) => c.key), results: [] };
  const save = () => {
    fs.writeFileSync(`${manifestFile}.tmp`, JSON.stringify(manifest, null, 2) + "\n");
    fs.renameSync(`${manifestFile}.tmp`, manifestFile);
  };
  save();
  let stopped = false;
  let browser;
  const stop = (reason) => {
    if (stopped) return;
    stopped = true;
    manifest.status = "aborted";
    manifest.reason = reason;
    save();
    // Closing this run's browser interrupts navigation/evaluate/screenshot.
    // The persisted manifest already identifies the unfinished case/side.
    void browser?.close().catch(() => {});
  };
  const onInterrupt = () => stop("SIGINT");
  const onTerminate = () => stop("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  const timer = setTimeout(() => stop("whole-run timeout"), runMs);
  timer.unref();
  try {
    browser = await ({ chromium, webkit })[browserName].launch();
    if (stopped) return manifest;
    for (let index = 0; index < selected.length && !stopped; index++) {
      const c = selected[index];
      const row = { key: c.key, case: c, sides: {}, pass: false };
      const snapshots = {};
      manifest.results.push(row);
      manifest.active = { key: c.key };
      save();
      for (const [side, base] of [["before", before], ["after", after]]) {
        if (stopped) break;
        manifest.active = { key: c.key, side };
        save();
        const dir = path.join(out, `${index}-${side}`);
        fs.mkdirSync(dir, { recursive: true });
        const context = await browser.newContext({ viewport: c.viewport, locale: c.locale ?? "ja",
          deviceScaleFactor: 1, timezoneId: "UTC", reducedMotion: "reduce" });
        context.setDefaultTimeout(timeoutMs);
        context.setDefaultNavigationTimeout(timeoutMs);
        // A page action timeout does not bound a hanging evaluate or PNG
        // encoder. Close only this context when its entire side expires.
        const sideTimer = setTimeout(() => void context.close().catch(() => {}), timeoutMs * 2);
        try {
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          const response = await page.goto(new URL(c.path, base).href, { waitUntil: "domcontentloaded" });
          if (c.readySelector) await page.locator(c.readySelector).first().waitFor({ state: "visible" });
          const readiness = await waitForVisualReady(page, { timeoutMs });
          row.sides[side] = { status: response?.status(), url: new URL(page.url()).pathname + new URL(page.url()).search,
            readiness, errors };
          save();
          if (!readiness.ready || response?.status() !== 200 || errors.length) continue;
          const snapshot = await captureComputed(page);
          const computed = path.join(dir, "computed.json.gz");
          fs.writeFileSync(computed, gzipSync(JSON.stringify(snapshot)));
          const png = path.join(dir, "capture.png");
          await page.screenshot({ path: png, fullPage: true, animations: "disabled" });
          Object.assign(row.sides[side], { computed: path.relative(out, computed), png: path.relative(out, png) });
          snapshots[side] = snapshot;
        } catch (error) {
          row.sides[side] = { ...row.sides[side], error: String(error.message ?? error) };
        } finally {
          clearTimeout(sideTimer);
          await context.close();
          save();
        }
      }
      const b = row.sides.before, a = row.sides.after;
      if (b?.png && a?.png) {
        row.computed = compareComputed(snapshots.before, snapshots.after);
        row.pixels = await comparePng(path.join(out, b.png), path.join(out, a.png));
        row.metadataEqual = b.status === a.status && b.url === a.url;
        row.pass = row.computed.equal && row.pixels.equal && row.metadataEqual;
      }
      // Large raw observations belong in their gzip files, never duplicate
      // them in the summary or normalize their measured CSS values.
      if (stopped) break;
      manifest.completed.push(c.key);
      manifest.pending = manifest.pending.filter((key) => key !== c.key);
      delete manifest.active;
      save();
      if (index === 0 && !row.pass) {
        manifest.status = "canary-failed";
        manifest.reason = "paired canary failed; matrix not expanded";
        break;
      }
    }
    if (manifest.status === "running") manifest.status = manifest.results.every((r) => r.pass) ? "passed" : "failed";
  } catch (error) {
    if (!stopped) {
      manifest.status = "failed";
      manifest.reason = String(error.message ?? error);
    }
  } finally {
    clearTimeout(timer);
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    manifest.finishedAt = new Date().toISOString();
    save();
    if (browser) await Promise.race([browser.close().catch(() => {}), new Promise((r) => {
      const closeTimer = setTimeout(r, 10000);
      closeTimer.unref();
    })]);
  }
  return manifest;
}

export function validateCases(cases, canary) {
  if (!Array.isArray(cases) || !cases.length) throw new Error("cases must be a nonempty array");
  const keys = new Set();
  for (const c of cases) {
    if (typeof c.key !== "string" || !c.key || keys.has(c.key)) throw new Error("case keys must be unique nonempty strings");
    keys.add(c.key);
    if (typeof c.path !== "string" || !c.path.startsWith("/") || c.path.startsWith("//") || c.path.includes("\\"))
      throw new Error("case path must be a same-origin absolute path");
    if (![c.viewport?.width, c.viewport?.height].every((n) => Number.isInteger(n) && n > 0 && n <= 16384))
      throw new Error("case viewport must contain positive integer width/height <= 16384");
    if (c.readySelector !== undefined && (typeof c.readySelector !== "string" || !c.readySelector.trim()))
      throw new Error("case readySelector must be a nonempty CSS selector");
  }
  if (!keys.has(canary)) throw new Error("--canary must name a case (choose the heaviest page)");
}
