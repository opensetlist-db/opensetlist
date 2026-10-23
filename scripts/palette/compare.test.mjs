import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { comparePng, compareQa } from "./compare.mjs";
import { compareComputed, normalizeModuleHash } from "./computed.mjs";

test("one raw RGBA pixel, equal image, and dimension changes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "palette-png-"));
  try {
    const a = path.join(dir, "a.png"), b = path.join(dir, "b.png"), c = path.join(dir, "c.png");
    const data = Buffer.alloc(3 * 2 * 4, 255), changed = Buffer.from(data);
    changed[4] = 254;
    await sharp(data, { raw: { width: 3, height: 2, channels: 4 } }).png().toFile(a);
    await sharp(changed, { raw: { width: 3, height: 2, channels: 4 } }).png().toFile(b);
    await sharp(Buffer.alloc(2 * 2 * 4, 255), { raw: { width: 2, height: 2, channels: 4 } }).png().toFile(c);
    assert.equal((await comparePng(a, a)).differingPixels, 0);
    const one = await comparePng(a, b);
    assert.equal(one.equal, false);
    assert.equal(one.differingPixels, 1);
    assert.deepEqual([one.first.x, one.first.y], [1, 0]);
    assert.equal((await comparePng(a, c)).sameDimensions, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const snapshot = (className = "card-module__a_bC12__title", color = "rgb(1, 2, 3)") => ({
  properties: ["color"], url: "/ko", fontsStatus: "loaded", readyState: "complete", images: [], text: ["Hi"],
  styles: [[ ["div", "", className, null, null], ["normal", color], ["none", ""], ["none", ""] ]],
});

test("known module hashes normalize while local names, raw classes, and computed values remain exact", () => {
  assert.equal(normalizeModuleHash("card-module__a_bC12__title"), "card-module__<build-hash>__title");
  assert.equal(normalizeModuleHash("card-module__a_bC12__title_more"), "card-module__<build-hash>__title_more");
  assert.equal(normalizeModuleHash("card-module__too-long__title"), "card-module__too-long__title");
  assert.equal(compareComputed(snapshot(), snapshot("card-module__X_Yz09__title")).equal, true);
  assert.ok(compareComputed(snapshot(), snapshot("card-module__X_Yz09__other"))
    .differences.some((row) => row.kind === "element-identity"));
  assert.ok(compareComputed(snapshot(), snapshot("raw-class"))
    .differences.some((row) => row.kind === "element-identity"));
  assert.deepEqual(compareComputed(snapshot(), snapshot("raw-class", "rgb(9, 9, 9)"))
    .differences.map((row) => row.kind), ["element-identity"]);
  assert.ok(compareComputed(snapshot(), snapshot("card-module__X_Yz09__title", "rgb(1, 2, 4)"))
    .differences.some((row) => row.kind === "computed"));
  assert.ok(compareComputed(snapshot(), snapshot("card-module__X_Yz09__title", "card-module__X_Yz09__title"))
    .differences.some((row) => row.kind === "computed"));
});

test("QA normalizes selector hashes only; ratio and RGB mutations fail", () => {
  const a = [{ name: "contrast card", ok: true, detail: "4.51 rgb(1, 2, 3) card-module__a_bC12__title" }];
  const b = [{ name: "contrast card", ok: true, detail: "4.51 rgb(1, 2, 3) card-module__X_Yz09__title" }];
  assert.equal(compareQa(a, b).equal, true);
  assert.equal(compareQa(a, [{ ...b[0], detail: b[0].detail.replace("4.51", "4.52") }]).equal, false);
  assert.equal(compareQa(a, [{ ...b[0], detail: b[0].detail.replace("rgb(1", "rgb(2") }]).equal, false);
  assert.throws(() => compareQa(a, [{ name: "contrast card" }]), /malformed/);
  assert.throws(() => compareQa({ results: a, passed: 0, failed: 0, skipped: 0, total: 1 },
    { results: b, passed: 1, failed: 0, skipped: 0, total: 1 }), /summary passed mismatch/);
});
