#!/usr/bin/env node
// Regenerate src/app/favicon.ico from the brand SVG at src/app/icon.svg.
//
// Why: Next.js auto-serves /favicon.ico from src/app/favicon.ico. Mobile
// browsers (iOS Safari, Android Chrome) prefer bitmap formats over the
// SVG icon for the tab/favicon, so a stale `.ico` overrides our brand
// SVG everywhere it matters most. The original file was the Next.js
// scaffold default committed at project init (1b6e3e3).
//
// Output: 16x16, 32x32, 48x48 layers — the canonical favicon.ico size
// trio. 16/32 cover virtually all modern browsers; 48 is included for
// Windows Tiles + legacy IE compatibility (cheap to add). Larger sizes
// (64+) are unnecessary in `.ico` — apple-touch-icon.png covers the
// home-screen / share-sheet path at 180x180.
//
// Usage: `npm run generate-favicon` (or `node scripts/generate-favicon.mjs`)
// after editing src/app/icon.svg. Commit the resulting favicon.ico.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import toIco from "to-ico";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SVG_PATH = resolve(REPO_ROOT, "src/app/icon.svg");
const ICO_PATH = resolve(REPO_ROOT, "src/app/favicon.ico");
const SIZES = [16, 32, 48];

async function main() {
  const svg = await readFile(SVG_PATH);
  // Render the SVG at each target size with sharp. Density scales with
  // the viewport so the rasterizer doesn't downsample from a fixed
  // intermediate (which would muddy the 16x16 case where every pixel
  // counts). 64 is the SVG's native viewBox edge — density = px / 64
  // * 72 keeps each render anti-aliased from a fresh source.
  const layers = await Promise.all(
    SIZES.map((size) =>
      sharp(svg, { density: Math.max(72, (size / 64) * 72) })
        .resize(size, size)
        .png()
        .toBuffer(),
    ),
  );
  const ico = await toIco(layers);
  await writeFile(ICO_PATH, ico);
  console.log(
    `✔ favicon.ico (${SIZES.join("/")} layers, ${ico.length} bytes) written to ${ICO_PATH}`,
  );
}

main().catch((err) => {
  console.error("✘ favicon generation failed:", err);
  process.exit(1);
});
