#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { runScenario, BROWSERS } from "./page-qa/harness.mjs";
import { createFoundationScenario } from "./page-qa/scenarios/shared-foundation.mjs";
import { loadFontManifest } from "./page-qa/font-proof.mjs";

// Keep scenario options out of the common harness API. The same harness runs
// the small preflight and (only after success) the unchanged full matrix.
export async function runFontProof(options, run = runScenario) {
  const manifest = loadFontManifest(options.manifest);
  const common = { browserName: options.browser, quick: options.quick, base: options.base, timeoutMs: options.timeoutMs, runMs: options.runMs };
  const smoke = await run({ ...common, scenario: createFoundationScenario({ smoke: true, manifest }), outDir: path.join(options.out, "smoke") });
  if (!smoke || smoke.failed || options.smoke) return smoke;
  return run({ ...common, scenario: createFoundationScenario({ manifest }), outDir: path.join(options.out, "matrix") });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: {
      manifest: { type: "string" }, out: { type: "string" },
      base: { type: "string", default: "http://localhost:3121" },
      browser: { type: "string", default: "chromium" },
      smoke: { type: "boolean", default: false }, quick: { type: "boolean", default: false },
      timeout: { type: "string", default: "30" }, "timeout-min": { type: "string", default: "25" },
    } });
    const timeoutMs = Number(values.timeout) * 1000;
    const runMs = Number(values["timeout-min"]) * 60000;
    if (!values.manifest || !values.out || !BROWSERS[values.browser] ||
      !Number.isFinite(timeoutMs) || !Number.isFinite(runMs) || timeoutMs <= 0 || runMs <= 0 || timeoutMs > 86400000 || runMs > 86400000) {
      throw new Error("usage: node scripts/font-proof.mjs --manifest <approved-font-manifest.json> --out <dir> [--base URL] [--smoke] [--quick] [--browser chromium|webkit] [--timeout seconds] [--timeout-min minutes]");
    }
    const result = await runFontProof({ ...values, manifest: path.resolve(values.manifest), out: path.resolve(values.out), base: values.base.replace(/\/+$/, ""), timeoutMs, runMs });
    process.exit(result && result.failed === 0 ? 0 : 1);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
