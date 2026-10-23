import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { test } from "node:test";
import { runPaired, validateCases } from "./paired.mjs";

const cases = [
  { key: "heavy", path: "/fixture", viewport: { width: 320, height: 240 } },
  { key: "light", path: "/fixture", viewport: { width: 390, height: 240 } },
];

test("paired gate retains deferred/pending cases and rejects a changed canary before expansion", async () => {
  let changed = false;
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(`<html lang="ja"><body><p style="color:${changed ? "red" : "black"}">canary</p></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "palette-paired-"));
  try {
    const same = await runPaired({ before: base, after: base, cases, canary: "heavy", out: path.join(root, "same") });
    assert.equal(same.status, "passed");
    assert.deepEqual(same.completed, ["heavy"]);
    assert.deepEqual(same.deferred, ["light"]);
    assert.deepEqual(same.pending, []);
    assert.equal(same.results[0].pixels.equal, true);

    // Change only the second response in the paired load. This proves the
    // gate sees a real measured change, before checking deferred coverage.
    let requests = 0;
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      changed = ++requests % 2 === 0;
      res.setHeader("Content-Type", "text/html");
      res.end(`<html lang="ja"><body><p style="color:${changed ? "red" : "black"}">canary</p></body></html>`);
    });
    const different = await runPaired({ before: base, after: base, cases, canary: "heavy", expand: true,
      out: path.join(root, "different") });
    assert.equal(different.status, "canary-failed");
    assert.equal(different.results[0].pass, false);
    assert.equal(different.results[0].computed.equal, false);
    assert.equal(different.results[0].pixels.equal, false);
    assert.deepEqual(different.pending, ["light"]);
    assert.equal(different.results.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "different/paired.json"))).status, "canary-failed");

    const timeout = await runPaired({ before: base, after: base, cases, canary: "heavy", expand: true,
      out: path.join(root, "timeout"), runMs: 1 });
    assert.equal(timeout.status, "aborted");
    assert.equal(timeout.reason, "whole-run timeout");
    assert.deepEqual(timeout.pending, ["heavy", "light"]);
    const saved = JSON.parse(fs.readFileSync(path.join(root, "timeout/paired.json")));
    assert.equal(saved.status, "aborted");
    assert.ok(saved.finishedAt);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("case validation prevents unintentional URLs and ambiguous coverage", () => {
  assert.doesNotThrow(() => validateCases(cases, "heavy"));
  assert.throws(() => validateCases([...cases, cases[0]], "heavy"), /unique/);
  assert.throws(() => validateCases(cases, "absent"), /canary/);
  for (const invalid of ["https://example.com", "//example.com", "/\\example.com"]) {
    assert.throws(() => validateCases([{ ...cases[0], path: invalid }], "heavy"), /same-origin/);
  }
});
