import test from "node:test";
import assert from "node:assert/strict";
import { compareCss, compareGlobals } from "./static-equivalence.mjs";

const variables = { "--red": "#ff000080", "--blue": "#0066ff", "--new": "#ffffff" };

test("approved RGBA substitutions preserve gradient, alpha, fallback branches, and declaration order", () => {
  const before = `.card { color: #ff000080; background: linear-gradient(#0066ff, var(--unknown, #ff000080));
    box-shadow: 0 0 2px #0066ff; color: #0066ff !important; }`;
  const after = `.card { color: var(--red); background: linear-gradient(var(--blue), var(--unknown, var(--red)));
    box-shadow: 0 0 2px var(--blue); color: var(--blue) !important; }`;
  const result = compareCss(before, after, { variables });
  assert.equal(result.equal, true, JSON.stringify(result.differences));
  assert.equal(result.substitutions.length, 5);
});

test("different token color, alpha, gradient structure, and fallback changes fail", () => {
  for (const after of [
    ".card { color: var(--blue); }",
    ".card { color: #ff0000; }",
    ".card { color: var(--red, blue); }",
  ]) {
    assert.equal(compareCss(".card { color: #ff000080; }", after, { variables }).equal, false);
  }
  assert.equal(compareCss(".card { background: linear-gradient(#0066ff, #ff000080); }",
    ".card { background: linear-gradient(var(--blue), #0066ff); }", { variables }).equal, false);
});

test("selector, order, property, and importance have distinct failures", () => {
  const before = ".a { color: #0066ff; background: #ff000080 !important; }";
  assert.deepEqual(compareCss(before, ".b { color: var(--blue); background: var(--red) !important; }", { variables })
    .differences.map((row) => row.kind), ["selector"]);
  assert.ok(compareCss(before, ".a { background: var(--red) !important; color: var(--blue); }", { variables })
    .differences.some((row) => row.kind === "property"));
  assert.ok(compareCss(before, ".a { color: var(--blue) !important; background: var(--red) !important; }", { variables })
    .differences.some((row) => row.kind === "important"));
});

test("strings and URL hashes cannot be rewritten as colors", () => {
  const before = `.a { content: "#0066ff"; background: url("/x/#0066ff"); color: #0066ff; }`;
  const after = `.a { content: "#0066ff"; background: url("/x/#0066ff"); color: var(--blue); }`;
  assert.equal(compareCss(before, after, { variables }).equal, true);
  assert.equal(compareCss(before, after.replace('"#0066ff"', '"var(--blue)"'), { variables }).equal, false);
  assert.equal(compareCss(before, after.replace('/x/#0066ff', '/x/var(--blue)'), { variables }).equal, false);
});

test("global additions are exact and every approved reused token is backed by :root", () => {
  const before = ":root { --red: #ff000080; --blue: #0066ff; } .x { color: black; }";
  const after = ":root { --red: #ff000080; --new: #fff; --blue: #0066ff; } .x { color: black; }";
  assert.equal(compareGlobals(before, after, { variables, addedVariables: ["--new"] }).equal, true);
  assert.equal(compareGlobals(before, after.replace("#fff", "#eee"), { variables, addedVariables: ["--new"] }).equal, false);
  assert.equal(compareGlobals(before, after, { variables, addedVariables: [] }).equal, false);
  assert.equal(compareGlobals(before, after.replace("--blue: #0066ff", "--blue: #ff000080"),
    { variables, addedVariables: ["--new"] }).equal, false);
  assert.equal(compareGlobals(before, after.replace(".x", ".y"), { variables, addedVariables: ["--new"] }).equal, false);
});

test("approved tokens reject scoped overrides and @property registrations", () => {
  const old = ":root { --red: #ff000080; --blue: #0066ff; }";
  const next = ":root { --red: #ff000080; --blue: #0066ff; --new: #fff; }";
  const options = { variables, addedVariables: ["--new"] };
  assert.equal(compareCss(".x { color: #0066ff; }", ".x { color: var(--blue); }", { variables }).equal, true);
  assert.equal(compareGlobals(old, next, options).equal, true);
  assert.equal(compareCss(".x { --blue: black; color: #0066ff; }",
    ".x { --blue: black; color: var(--blue); }", { variables }).equal, false);
  assert.equal(compareGlobals(`${old} @media (min-width: 1px) { :root { --blue: black; } }`,
    `${next} @media (min-width: 1px) { :root { --blue: black; } }`, options).equal, false);
  assert.equal(compareGlobals(`${old} @property --blue { syntax: '<color>'; inherits: true; initial-value: blue; }`,
    `${next} @property --blue { syntax: '<color>'; inherits: true; initial-value: blue; }`, options).equal, false);
});

test("a very small alpha difference is still a color difference", () => {
  const source = ".x { color: rgb(0 0 0 / 0.0000000001); }";
  const changed = ".x { color: var(--black); }";
  assert.equal(compareCss(source, changed, { variables: { "--black": "rgb(0 0 0 / 0.0000000001)" } }).equal, true);
  assert.equal(compareCss(source, changed, { variables: { "--black": "rgb(0 0 0 / 0)" } }).equal, false);
});

test("new global variable must not activate preexisting fallbacks or aliases", () => {
  const unaffected = ".other { color: var(--existing, red); }";
  assert.equal(compareCss(unaffected, unaffected, { variables, addedVariables: ["--new"] }).equal, true);
  const before = ".other { color: var(--new, red); }";
  assert.equal(compareCss(before, before, { variables, addedVariables: ["--new"] }).equal, false);
  assert.equal(compareCss(".other { background: linear-gradient(red, var(--old, var(--new, blue))); }",
    ".other { background: linear-gradient(red, var(--old, var(--new, blue))); }",
    { variables, addedVariables: ["--new"] }).equal, false);
  assert.equal(compareCss('@supports (color: var(--new, red)) { .x { color: red; } }',
    '@supports (color: var(--new, red)) { .x { color: red; } }',
    { variables, addedVariables: ["--new"] }).equal, false);
  const oldGlobal = ":root { --alias: var(--new, red); --blue: #0066ff; --red: #ff000080; }";
  const nextGlobal = ":root { --alias: var(--new, red); --new: #fff; --blue: #0066ff; --red: #ff000080; }";
  assert.equal(compareGlobals(oldGlobal, nextGlobal, { variables, addedVariables: ["--new"] }).equal, false);
});

test("new-variable audit ignores strings and opaque URLs", () => {
  const source = '.other { content: "var(--new, red)"; background: url("/var(--new)"); }';
  assert.equal(compareCss(source, source, { variables, addedVariables: ["--new"] }).equal, true);
});
