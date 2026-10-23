import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("static CLI audits the inventory, scoped overrides and replacement count", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "palette-cli-"));
  const cli = fileURLToPath(new URL("../palette-verify.mjs", import.meta.url));
  const config = { files: ["src/card.module.css"], globals: "src/globals.css",
    variables: { "--ink": "#fff" }, addedVariables: ["--ink"], expectedSubstitutions: 1 };
  const write = (file, value) => fs.writeFileSync(path.join(root, file), value);
  for (const side of ["before", "after"]) fs.mkdirSync(path.join(root, side, "src"), { recursive: true });
  const run = () => {
    write("config.json", JSON.stringify(config));
    return spawnSync(process.execPath, [cli, "--mode", "static", "--before", path.join(root, "before"),
      "--after", path.join(root, "after"), "--config", path.join(root, "config.json"), "--out", path.join(root, "out")],
    { encoding: "utf8" });
  };
  const report = () => JSON.parse(fs.readFileSync(path.join(root, "out/static-report.json")));
  try {
    write("before/src/card.module.css", ".card {color:#fff}");
    write("after/src/card.module.css", ".card {color:var(--ink)}");
    write("before/src/globals.css", ":root {--space: 1px}");
    write("after/src/globals.css", ":root {--space: 1px; --ink: #fff}");
    assert.equal(run().status, 0);
    assert.equal(report().substitutions, 1);
    write("after/src/other.css", ".other {color:red}");
    assert.equal(run().status, 1);
    assert.deepEqual(report().unexpectedChangedCss, ["src/other.css"]);
    // An unchanged file can still shadow the proposed global variable.
    for (const side of ["before", "after"]) write(`${side}/src/other.css`, ".other {--ink:black}");
    assert.equal(run().status, 1);
    assert.equal(report().scopeConflicts.length, 2);
    for (const side of ["before", "after"]) write(`${side}/src/other.css`, ".other {color:black}");
    assert.equal(run().status, 0);
    // Defining a token can activate an unchanged fallback elsewhere. The
    // source inventory must reject that context, even with no declaration.
    for (const side of ["before", "after"]) write(`${side}/src/other.css`, ".other {color:var(--ink, red)}");
    assert.equal(run().status, 1);
    assert.equal(report().scopeConflicts.length, 1);
    for (const side of ["before", "after"]) write(`${side}/src/other.css`, ".other {color:black}");
    assert.equal(run().status, 0);
    config.expectedSubstitutions = 2;
    assert.equal(run().status, 1);
    assert.equal(report().expectedSubstitutions, 2);
    config.files = ["../outside.css"];
    assert.equal(run().status, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
