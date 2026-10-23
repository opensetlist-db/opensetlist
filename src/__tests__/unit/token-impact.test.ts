// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { analyzeImpact, renderImpact } from "../../../scripts/token-impact/analyze.mjs";
import { main, readRef, readTree } from "../../../scripts/token-impact.mjs";

const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), `scripts/token-impact/fixtures/live-${name}.json`), "utf8"));
const before = fixture("before"), after = fixture("after");

describe("shared token impact inventory", () => {
  it("keeps direct and indirect LIVE dot consumers beside foreground consumers", () => {
    const report = analyzeImpact(before, after);
    const live = report.changes.find((row) => row.name === "colors.live")!;
    expect(live.consumers).toEqual(expect.arrayContaining([
      expect.objectContaining({ side: "after", component: "Badge", property: "color", expression: "cfg.color" }),
      expect.objectContaining({ side: "after", component: "Badge", property: "background", expression: "cfg.color", status: "unresolved" }),
      expect.objectContaining({ side: "after", component: "Badge", property: "backgroundColor", expression: "tokens.colors.live" }),
    ]));
    const markdown = renderImpact(report);
    expect(markdown).toContain("background");
    expect(markdown).toContain("foreground");
    expect(markdown).toContain("candidate");
    // Positive control above proves the stale dot is reachable. The fixed
    // fixture then moves just its token reference out of the LIVE inventory.
    const fixed = { ...after, "src/Badge.tsx": after["src/Badge.tsx"].replace("backgroundColor: tokens.colors.live", "backgroundColor: tokens.colors.liveDot") };
    const fixedLive = analyzeImpact(before, fixed).changes.find((row) => row.name === "colors.live")!;
    expect(fixedLive.consumers.some((row) => row.side === "after" && row.expression === "tokens.colors.live" && row.property === "backgroundColor")).toBe(false);
    expect(analyzeImpact(before, fixed).changes.find((row) => row.name === "colors.liveDot")!.consumers).toEqual(expect.arrayContaining([expect.objectContaining({ side: "after", property: "backgroundColor" })]));
    expect(report.complete).toBe(false);
  });

  it("tracks CSS fallback/alias references and exposes no-consumer tokens", () => {
    const report = analyzeImpact(before, after);
    expect(report.changes.find((row) => row.name === "--live")!.consumers).toEqual(expect.arrayContaining([
      expect.objectContaining({ side: "after", component: ".label", property: "color" }),
      expect.objectContaining({ side: "after", component: ".dot", property: "background", status: "unresolved" }),
    ]));
    expect(report.changes.find((row) => row.name === "colors.live")!.consumers.length).toBeGreaterThan(0);
    const unused = report.changes.find((row) => row.name === "colors.unused")!;
    expect(unused.consumers).toHaveLength(0);
    expect(unused.review).toContain("No static consumers");
    expect(renderImpact(report)).toContain("colors.unused");
  });

  it("resolves re-exports, bindings, shadowing and dynamic candidate sets without evaluating source", () => {
    const source = {
      ...after,
      "src/barrel.ts": "export { colors as tone } from './styles/tokens';",
      "src/consumer.tsx": "import { tone } from './barrel'; const { live: alias } = tone; const key = getKey(); const tint = tone[key]; export const View = () => <i style={{color: alias, background: tint}}/>; export function Shadow(tone: {live: string}) { return <b style={{color: tone.live}}/> }",
      "src/derived.ts": "import { colors } from './styles/tokens'; export const emphasis = `${colors.live}20`;",
      "src/derived-consumer.tsx": "import { emphasis } from './derived'; export const Derived = () => <i style={{background: emphasis}}/>;",
      "src/destructured.tsx": "import { colors } from './styles/tokens'; const config = { color: colors.live }; const { color: tint } = config; export const Dot = () => <i style={{background: tint}}/>;",
      "src/namespace.tsx": "import * as tokens from './styles/tokens'; const selected = tokens[getKey()]; export const NamespaceDot = () => <i style={{background: selected.live}}/>;",
      "src/never-run.ts": "throw new Error('SOURCE WAS EXECUTED');",
    };
    const live = analyzeImpact(before, source).changes.find((row) => row.name === "colors.live")!;
    expect(live.consumers).toEqual(expect.arrayContaining([
      expect.objectContaining({ side: "after", expression: "alias", property: "color", status: "unresolved" }),
      expect.objectContaining({ side: "after", expression: "tone[key]", status: "unresolved" }),
      expect.objectContaining({ side: "after", expression: "emphasis", property: "background", status: "unresolved" }),
      expect.objectContaining({ side: "after", file: "src/destructured.tsx", expression: "tint", property: "background", status: "unresolved" }),
      expect.objectContaining({ side: "after", file: "src/namespace.tsx", expression: "selected.live", property: "background", status: "unresolved" }),
    ]));
    const unshadowed = { ...source, "src/consumer.tsx": source["src/consumer.tsx"].replace("Shadow(tone: {live: string})", "Shadow()") };
    const controlLive = analyzeImpact(before, unshadowed).changes.find((row) => row.name === "colors.live")!;
    expect(controlLive.consumers.some((row) => row.side === "after" && row.expression === "tone.live" && row.component === "Shadow")).toBe(true);
    expect(live.consumers.some((row) => row.side === "after" && row.expression === "tone.live" && row.component === "Shadow")).toBe(false);
  });

  it("compares expression deltas and reports additions, deletions, diagnostics and removed consumers", () => {
    const unchanged = analyzeImpact(before, before);
    expect(unchanged.changes).toHaveLength(0);
    const source = { ...after, "src/styles/tokens.ts": "export const colors = { liveDot: '#f59e0b', added: compute() } as const;", "src/Badge.tsx": "", "src/broken.css": ".bad {", "src/broken.ts": "export const x = ;" };
    const report = analyzeImpact(before, source);
    expect(report.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "colors.live", change: "removed" }),
      expect.objectContaining({ name: "colors.added", change: "added" }),
    ]));
    expect(report.changes.find((row) => row.name === "colors.live")!.consumers.some((row) => row.side === "before" && row.property === "background")).toBe(true);
    expect(report.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ file: "src/broken.css" }), expect.objectContaining({ file: "src/broken.ts" })]));
    const malicious = { ...report, diagnostics: [{ side: "after", file: "<script>|x", line: 1, reason: "<img>\n|bad" }] };
    expect(renderImpact(malicious)).toContain("&lt;script&gt;&#124;x");
  });

  it("does not narrow candidate origins just because an object field shares another token's name", () => {
    const source = { ...after, "src/collision.tsx": "import { colors } from './styles/tokens'; const config = { live: colors.liveDot, foreground: colors.live }; const { live: tint } = config; export const Dot = () => <i style={{ background: tint, color: config[getKey()].live }} />;" };
    const report = analyzeImpact(before, source);
    const dot = report.changes.find((row) => row.name === "colors.liveDot")!;
    expect(dot.consumers).toEqual(expect.arrayContaining([
      expect.objectContaining({ side: "after", file: "src/collision.tsx", expression: "tint", property: "background", status: "unresolved" }),
      expect.objectContaining({ side: "after", file: "src/collision.tsx", expression: "config[getKey()].live", property: "color", status: "unresolved" }),
    ]));
  });

  it("uses checker-proven literal properties without fanning out to unrelated tokens", () => {
    const source = { ...after, "src/exact.tsx": "import { colors } from './styles/tokens'; const { live: tint } = colors; export const Exact = () => <i style={{ color: tint, background: colors['live'] }}/>;" };
    const report = analyzeImpact(before, source);
    const live = report.changes.find((row) => row.name === "colors.live")!;
    expect(live.consumers).toEqual(expect.arrayContaining([
      expect.objectContaining({ side: "after", file: "src/exact.tsx", expression: "tint", property: "color" }),
      expect.objectContaining({ side: "after", file: "src/exact.tsx", expression: "colors['live']", property: "background" }),
    ]));
    for (const name of ["colors.liveDot", "colors.unused"]) {
      expect(report.changes.find((row) => row.name === name)!.consumers.some((row) => row.file === "src/exact.tsx" && ["tint", "colors['live']"].includes(row.expression))).toBe(false);
    }
  });

  it("keeps candidates when typed property declarations do not prove a value origin", () => {
    const source = { ...after, "src/typed.tsx": "import { colors } from './styles/tokens'; const cfg: { color: string } = { color: colors.live }; const { color: tint } = cfg; export const TypedDot = () => <i style={{background: tint}}/>;" };
    const live = analyzeImpact(before, source).changes.find((row) => row.name === "colors.live")!;
    expect(live.consumers).toEqual(expect.arrayContaining([
      expect.objectContaining({ side: "after", file: "src/typed.tsx", expression: "colors.live", property: "color" }),
      expect.objectContaining({ side: "after", file: "src/typed.tsx", expression: "tint", property: "background", status: "unresolved" }),
    ]));
  });

  it("reports CSS in TS strings, dynamic names and cyclic aliases without looping", () => {
    const source = { ...after, "src/runtime.tsx": "const name = 'live'; export const C = () => <i style={{color: 'var(--live)', background: `var(--${name})`}}/>;", "src/cycle.css": ":root { --a: var(--b); --b: var(--a); } .x { color: var(--a); }" };
    const report = analyzeImpact(before, source);
    expect(report.changes.find((row) => row.name === "--live")!.consumers).toEqual(expect.arrayContaining([expect.objectContaining({ file: "src/runtime.tsx", property: "color", status: "unresolved" })]));
    expect(report.diagnostics.some((row) => row.reason.includes("Interpolated"))).toBe(true);
    expect(report.changes.find((row) => row.name === "--a")!.consumers.length).toBeGreaterThan(0);
  });

  it("normalizes source-tree iteration order while preserving per-file CSS declaration changes", () => {
    const first = { "src/a.css": ":root { --live: red; }", "src/b.css": ".dark { --live: blue; }" };
    const reordered = { "src/b.css": first["src/b.css"], "src/a.css": first["src/a.css"] };
    expect(analyzeImpact(first, { ...reordered, "src/a.css": ":root { --live: orange; }" }).changes).toHaveLength(1);
    expect(analyzeImpact(first, reordered).changes).toHaveLength(0);
  });

  it("keeps minified CSS alias consumers with different properties and selectors", () => {
    const first = { "src/test.css": ":root{--live:red;--alias:var(--live)}.label{color:var(--alias);background:var(--alias)}.dot{background:var(--alias)}" };
    const next = { "src/test.css": first["src/test.css"].replace("--live:red", "--live:orange") };
    const live = analyzeImpact(first, next).changes.find((row) => row.name === "--live")!;
    expect(live.consumers).toEqual(expect.arrayContaining([
      expect.objectContaining({ side: "after", component: ".label", property: "color", status: "unresolved" }),
      expect.objectContaining({ side: "after", component: ".label", property: "background", status: "unresolved" }),
      expect.objectContaining({ side: "after", component: ".dot", property: "background", status: "unresolved" }),
    ]));
  });

  it("resolves ESM extension substitutions and attributes inner bindings to the component", () => {
    const source = { ...after, "src/nested.tsx": "import { colors } from './styles/tokens.js'; export const Dot = () => { const config = { color: colors.live }; return <i style={{ background: config.color }}/> };", "src/unresolved.ts": "export { colors } from './missing.js';" };
    const report = analyzeImpact(before, source);
    expect(report.changes.find((row) => row.name === "colors.live")!.consumers).toEqual(expect.arrayContaining([
      expect.objectContaining({ side: "after", file: "src/nested.tsx", component: "Dot", expression: "colors.live" }),
      expect.objectContaining({ side: "after", file: "src/nested.tsx", component: "Dot", property: "background", expression: "config.color" }),
    ]));
    expect(report.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ side: "after", file: "src/unresolved.ts", reason: expect.stringContaining("Unresolved source import") })]));
  });

  it("propagates a larger CSS alias inventory without dropping terminal roles", () => {
    const aliases = Array.from({ length: 100 }, (_, index) => `--alias-${index}:var(--live);`).join("");
    const uses = Array.from({ length: 1000 }, (_, index) => `.use-${index}{color:var(--alias-${index % 100})}`).join("");
    const first = { "src/scale.css": `:root{--live:red;${aliases}}${uses}` };
    const next = { "src/scale.css": first["src/scale.css"].replace("--live:red", "--live:orange") };
    const live = analyzeImpact(first, next).changes.find((row) => row.name === "--live")!;
    expect(live.consumers.filter((row) => row.side === "after" && row.property === "color")).toHaveLength(1000);
  });
});

describe("token impact input and CLI", () => {
  it("reads trees and git refs as text, writes both reports and rejects partial input", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-impact-"));
    try {
      const left = path.join(root, "left"), right = path.join(root, "right"), output = path.join(root, "report");
      for (const [directory, source] of [[left, before], [right, after]] as const) {
        for (const [file, value] of Object.entries(source)) {
          const target = path.join(directory, file);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, String(value));
        }
      }
      expect(Object.keys(readTree(right))).toContain("src/Badge.tsx");
      main(["--before-tree", left, "--after-tree", right, "--out", output]);
      const treeReport = JSON.parse(fs.readFileSync(path.join(output, "impact.json"), "utf8"));
      expect(treeReport.changes.length).toBeGreaterThan(0);
      expect(fs.readFileSync(path.join(output, "impact.md"), "utf8")).toContain("Shared token impact review");
      const emptyConfig = path.join(root, "empty-git-config");
      fs.writeFileSync(emptyConfig, "");
      const runGit = (...args: string[]) => execFileSync("git", ["-C", right, ...args], { env: { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_SYSTEM: emptyConfig, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.test", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.test" } });
      runGit("init", "--quiet"); runGit("add", "src"); runGit("-c", "core.hooksPath=" + path.join(root, "no-hooks"), "commit", "--quiet", "-m", "fixture");
      expect(readRef(right, "HEAD").files).toEqual(readTree(right));
      fs.writeFileSync(path.join(right, "src/styles/tokens.ts"), before["src/styles/tokens.ts"]);
      runGit("add", "src"); runGit("-c", "core.hooksPath=" + path.join(root, "no-hooks"), "commit", "--quiet", "-m", "changed token fixture");
      main(["--repo", right, "--before", "HEAD~1", "--after", "HEAD", "--out", output]);
      const refReport = JSON.parse(fs.readFileSync(path.join(output, "impact.json"), "utf8"));
      expect(refReport.comparison.before).not.toBe(refReport.comparison.after);
      expect(refReport.changes.some((row: { name: string }) => row.name === "colors.live")).toBe(true);
      expect(() => main(["--before", "HEAD", "--out", output])).toThrow("complete before/after");
      expect(() => main(["--unknown", "x"])).toThrow("Invalid option");
      expect(() => main(["--out", "a", "--out", "b"])).toThrow("Repeated option");
      expect(() => main(["--out"])).toThrow("Invalid option");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
