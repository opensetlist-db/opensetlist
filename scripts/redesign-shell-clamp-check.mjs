#!/usr/bin/env node
// Database-free detector controls in real browser layout. This extracts the
// actual pageInvariants function because importing the CLI would start its
// application/server matrix. A renamed extraction boundary must fail loudly.
// node scripts/redesign-shell-clamp-check.mjs --out <new-evidence-directory>
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium, webkit } from "@playwright/test";
import sharp from "sharp";

const { values } = parseArgs({ options: { out: { type: "string" } } });
if (!values.out) throw new Error("usage: node scripts/redesign-shell-clamp-check.mjs --out <new-directory>");
const out = path.resolve(values.out);
if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error("Use a new output directory to preserve earlier results");
fs.mkdirSync(out, { recursive: true });
const source = fs.readFileSync(new URL("./redesign-shell-qa.mjs", import.meta.url), "utf8");
const start = source.indexOf("function pageInvariants()");
const end = source.indexOf("\n// ---------------------------------------------------------------------------", start);
if (start < 0 || end <= start) throw new Error("pageInvariants extraction boundary missing");
const invariants = new Function(`return (${source.slice(start, end).trim()})`)();
const cases = [
  ["visible-overhang", "width:600px", "width:100px;white-space:nowrap;overflow:visible", false],
  ["ancestor-clipping", "width:100px;overflow:hidden", "width:100px;white-space:nowrap;overflow:visible", true],
  ["own-clipping", "width:600px", "width:100px;white-space:nowrap;overflow:hidden", true],
  ["wrapped", "width:100px", "width:100px;overflow-wrap:anywhere", false],
  ["offcanvas-left", "width:100px;overflow:hidden", "width:100px;white-space:nowrap;overflow:visible;transform:translateX(-600px)", false],
  ["offcanvas-right", "width:100px;overflow:hidden", "width:100px;white-space:nowrap;overflow:visible;transform:translateX(600px)", false],
  ["fitting-heading-clipped-by-ancestor", "width:100px;overflow:hidden", "width:200px;white-space:nowrap;overflow:visible", true, "ABCDEFGHIJKL"],
  ["oversized-heading-visible-short-text", "width:100px;overflow:hidden", "width:200px;white-space:nowrap;overflow:visible", false, "OK"],
  ["inline-descendant-clipped", "width:100px;overflow:hidden", "width:200px;white-space:nowrap;overflow:visible", true, "<span>ABCDEFGHIJKL</span>"],
  ["partially-left-clipped-text", "width:100px;overflow:hidden", "width:200px;white-space:nowrap;overflow:visible;transform:translateX(-50px)", true, "ABCDEFGHIJKL"],
  ["scroll-reveals-heading", "width:100px;overflow:auto", "width:200px;white-space:nowrap;overflow:visible", false, "ABCDEFGHIJKL"],
  ["scroll-does-not-fix-own-clamp", "width:100px;overflow:auto", "width:100px;white-space:nowrap;overflow:hidden", true, "ABCDEFGHIJKL"],
  ["scroll-does-not-fix-inner-clip", "width:100px;overflow:auto", "width:200px;white-space:nowrap;overflow:visible", true, '<span style="display:block;width:100px;overflow:hidden">ABCDEFGHIJKL</span>'],
  ["inline-overflow-property-does-not-clip", "width:600px", "width:200px;white-space:nowrap;overflow:visible", false, '<span style="overflow:hidden">ABCDEFGHIJKL</span>'],
  ["inline-property-does-not-hide-ancestor-clip", "width:100px;overflow:hidden", "width:200px;white-space:nowrap;overflow:visible", true, '<span style="overflow:hidden"><strong>ABCDEFGHIJKL</strong></span>'],
];
const results = [];
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
    for (const [state, parent, heading, expected, text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"] of cases) {
      await page.setContent(`<main><div style="${parent}"><h1 style="font:20px sans-serif;margin:0;${heading}">${text}</h1></div></main>`);
      const result = await page.evaluate(invariants);
      const geometry = await page.locator("h1").evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return { clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, textWidth: range.getBoundingClientRect().width, ancestorWidth: el.parentElement.clientWidth };
      });
      const actual = result.clamp.problems.length > 0;
      const pass = actual === expected;
      results.push({ browser: name, state, expected, actual, pass, geometry, result });
      console.log(`${pass ? "PASS" : "FAIL"} ${name}/${state}: cut=${actual}, expected=${expected}`);
      await sharp(await page.screenshot()).webp({ quality: 90 }).toFile(path.join(out, `${name}-${state}.webp`));
      fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
    }
  } finally {
    await browser.close();
  }
}
console.log(`${results.filter((r) => r.pass).length}/${results.length} PASS`);
if (results.some((r) => !r.pass)) process.exitCode = 1;
