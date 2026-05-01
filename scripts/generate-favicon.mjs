#!/usr/bin/env node
// Regenerate src/app/favicon.ico from the brand SVG at src/app/icon.svg.
//
// Why: Next.js auto-serves /favicon.ico from src/app/favicon.ico. Mobile
// browsers (iOS Safari + WebKit-on-iOS Chrome, Android Chrome) prefer a
// rasterized icon over the SVG for tab/address-bar use, so a stale or
// mis-encoded `.ico` overrides our brand SVG everywhere it matters most.
// The original file was the Next.js scaffold default committed at project
// init (1b6e3e3). An earlier attempt with the `to-ico` library produced
// an all-BMP `.ico` that iOS WebKit couldn't decode — it fell back to the
// "gray globe" no-favicon placeholder. This version writes the ICO
// container by hand with PNG-encoded layers throughout, which every
// modern browser (incl. iOS Safari since ~2007) decodes natively.
//
// Layers: 16 / 32 / 48 / 256
//   - 16, 32: tab/address-bar everywhere
//   - 48: Windows Tiles + legacy IE
//   - 256: high-DPI displays — iOS Chrome on a Retina iPhone renders the
//     favicon at ~32–48 logical px, which means 64–96 device px. Without
//     a high-res layer the browser scales 48→96 and reads as muddy. The
//     scaffold's `.ico` shipped a 256 PNG for exactly this reason.
//
// Usage: `npm run generate-favicon` (or `node scripts/generate-favicon.mjs`)
// after editing src/app/icon.svg. Commit the resulting favicon.ico.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SVG_PATH = resolve(REPO_ROOT, "src/app/icon.svg");
const ICO_PATH = resolve(REPO_ROOT, "src/app/favicon.ico");
const SIZES = [16, 32, 48, 256];

// Build an ICO container around the supplied PNG buffers.
//
// ICO format (https://en.wikipedia.org/wiki/ICO_(file_format)):
//   - 6-byte header: reserved=0, type=1 (icon), imageCount
//   - imageCount × 16-byte directory entries: width, height, colors=0,
//     reserved=0, planes=1, bitCount=32, dataSize, dataOffset
//   - image payloads concatenated in the order matching the directory
//
// Width/height encode 256 as the byte literal 0 (the field is 1-byte).
// The SVG has no palette so colors=0 and bitCount=32 is correct for
// PNG-encoded 32-bit RGBA payloads. Browsers don't care about
// `bitCount` matching the embedded PNG's actual depth — the field is
// advisory; the embedded PNG is the source of truth.
function buildIco(layers) {
  const HEADER_SIZE = 6;
  const ENTRY_SIZE = 16;
  const directorySize = layers.length * ENTRY_SIZE;
  const dataStart = HEADER_SIZE + directorySize;

  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(layers.length, 4);

  const entries = Buffer.alloc(directorySize);
  let cursor = dataStart;
  for (let i = 0; i < layers.length; i++) {
    const { size, png } = layers[i];
    const off = i * ENTRY_SIZE;
    // 256 wraps to 0 in the byte field (the .ico spec's encoding for
    // "≥256 px"). Anything smaller writes its true value.
    entries.writeUInt8(size >= 256 ? 0 : size, off);
    entries.writeUInt8(size >= 256 ? 0 : size, off + 1);
    entries.writeUInt8(0, off + 2);
    entries.writeUInt8(0, off + 3);
    entries.writeUInt16LE(1, off + 4);
    entries.writeUInt16LE(32, off + 6);
    entries.writeUInt32LE(png.length, off + 8);
    entries.writeUInt32LE(cursor, off + 12);
    cursor += png.length;
  }

  return Buffer.concat([header, entries, ...layers.map((l) => l.png)]);
}

async function main() {
  const svg = await readFile(SVG_PATH);
  // Density scales with the target so each layer is rasterized from the
  // SVG at the correct resolution rather than upsampled from a single
  // intermediate. The viewBox is 64 px on a side; density = px / 64 * 72
  // keeps anti-aliasing crisp at 16 (where every pixel counts) and at
  // 256 (where a low density would smear).
  const layers = await Promise.all(
    SIZES.map(async (size) => ({
      size,
      png: await sharp(svg, { density: Math.max(72, (size / 64) * 72) })
        .resize(size, size)
        .png()
        .toBuffer(),
    })),
  );
  const ico = buildIco(layers);
  await writeFile(ICO_PATH, ico);
  console.log(
    `✔ favicon.ico (${SIZES.join("/")} PNG layers, ${ico.length} bytes) written to ${ICO_PATH}`,
  );
}

main().catch((err) => {
  console.error("✘ favicon generation failed:", err);
  process.exit(1);
});
