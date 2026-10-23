import sharp from "sharp";
import { normalizeModuleHash } from "./computed.mjs";

export async function comparePng(beforePath, afterPath) {
  const [old, next] = await Promise.all([
    sharp(beforePath, { limitInputPixels: false }).metadata(),
    sharp(afterPath, { limitInputPixels: false }).metadata(),
  ]);
  const dimensions = { before: [old.width, old.height], after: [next.width, next.height] };
  if (old.width !== next.width || old.height !== next.height) {
    return { equal: false, sameDimensions: false, dimensions, differingPixels: null,
      differences: [{ kind: "dimensions", ...dimensions }] };
  }
  let differingPixels = 0, maxChannelDelta = 0, first = null;
  // Decode in strips so tall page captures do not require two full RGBA
  // buffers in memory. The comparison uses uncompressed channel bytes.
  for (let top = 0; top < old.height; top += 1024) {
    const height = Math.min(1024, old.height - top);
    const extract = { left: 0, top, width: old.width, height };
    const [a, b] = await Promise.all([
      sharp(beforePath, { limitInputPixels: false }).extract(extract).ensureAlpha().raw().toBuffer(),
      sharp(afterPath, { limitInputPixels: false }).extract(extract).ensureAlpha().raw().toBuffer(),
    ]);
    if (a.length !== b.length || a.length !== old.width * height * 4) throw new Error("RGBA strip length mismatch");
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3]) continue;
      differingPixels++;
      if (!first) first = { x: (i / 4) % old.width, y: top + Math.floor(i / 4 / old.width),
        before: [...a.subarray(i, i + 4)], after: [...b.subarray(i, i + 4)] };
      for (let channel = 0; channel < 4; channel++) {
        maxChannelDelta = Math.max(maxChannelDelta, Math.abs(a[i + channel] - b[i + channel]));
      }
    }
  }
  return { equal: differingPixels === 0, sameDimensions: true, dimensions,
    differingPixels, maxChannelDelta, first };
}

const status = (row) => row.skipped ? "skip" : row.ok ? "pass" : "fail";

export function compareQa(before, after) {
  const left = Array.isArray(before) ? before : before.results;
  const right = Array.isArray(after) ? after : after.results;
  if (!Array.isArray(left) || !Array.isArray(right)) throw new Error("QA report needs results array");
  for (const [side, report, rows] of [["before", before, left], ["after", after, right]]) {
    for (const [index, row] of rows.entries()) {
      if (!row || typeof row.name !== "string" || !row.name ||
        (row.skipped !== true && typeof row.ok !== "boolean")) {
        throw new Error(`malformed ${side} QA row ${index}`);
      }
    }
    if (!Array.isArray(report)) {
      const counts = { passed: rows.filter((row) => status(row) === "pass").length,
        failed: rows.filter((row) => status(row) === "fail").length,
        skipped: rows.filter((row) => status(row) === "skip").length, total: rows.length };
      for (const [key, actual] of Object.entries(counts)) {
        if (report[key] !== actual) throw new Error(`${side} QA summary ${key} mismatch: ${report[key]} != ${actual}`);
      }
    }
  }
  const differences = [];
  if (left.length !== right.length) differences.push({ kind: "row-count", before: left.length, after: right.length });
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = left[index], b = right[index];
    if (!a || !b) continue;
    if (a.name !== b.name) differences.push({ kind: "name", index, before: a.name, after: b.name });
    if (status(a) !== status(b)) differences.push({ kind: "status", index, name: a.name, before: status(a), after: status(b) });
    if (/\bcontrast\b/i.test(a.name) || /\bcontrast\b/i.test(b.name)) {
      // A generated selector hash in a diagnostic label may change across
      // builds; ratios, colors, sample counts, and other detail stay exact.
      if (normalizeModuleHash(a.detail) !== normalizeModuleHash(b.detail)) {
        differences.push({ kind: "contrast", index, name: a.name, before: a.detail, after: b.detail });
      }
    }
  }
  return { equal: differences.length === 0, count: differences.length, differences };
}
