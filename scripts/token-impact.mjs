#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { analyzeImpact, renderImpact } from "./token-impact/analyze.mjs";

const supported = /\.(?:[cm]?[jt]sx?|css)$/;
const excluded = /(?:^|\/)(?:node_modules|\.git|\.next|\.claude|generated|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const included = (file) => supported.test(file) && !excluded.test(file);
const git = (repo, args, options = {}) => execFileSync("git", ["-C", repo, ...args], { maxBuffer: 128 * 1024 * 1024, ...options });

export function readRef(repo, ref) {
  const sha = git(repo, ["rev-parse", "--verify", `${ref}^{commit}`], { encoding: "utf8" }).trim();
  const entries = git(repo, ["ls-tree", "-rz", "--full-tree", sha], { encoding: "utf8" }).split("\0").filter(Boolean).map((line) => {
    const separator = line.indexOf("\t"), meta = line.slice(0, separator), file = line.slice(separator + 1);
    return { mode: meta.split(" ")[0], oid: meta.split(" ")[2], file };
  }).filter((row) => included(row.file) && row.mode.startsWith("100"));
  const buffer = git(repo, ["cat-file", "--batch"], { input: entries.map((row) => row.oid).join("\n") + "\n" });
  let offset = 0;
  const files = {};
  for (const row of entries) {
    const end = buffer.indexOf(10, offset), header = buffer.subarray(offset, end).toString("utf8");
    const size = Number(header.split(" ")[2]);
    if (end < 0 || !Number.isFinite(size)) throw new Error("Invalid git object response");
    offset = end + 1;
    files[row.file] = buffer.subarray(offset, offset + size).toString("utf8");
    offset += size + 1;
  }
  return { sha, files };
}

export function readTree(root) {
  const files = {};
  const walk = (directory, relative = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (excluded.test(name) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(path.join(directory, entry.name), name);
      else if (entry.isFile() && included(name)) files[name] = fs.readFileSync(path.join(directory, entry.name), "utf8");
    }
  };
  walk(path.resolve(root));
  return files;
}

export function main(args) {
  const options = {}, tokenFiles = [];
  const accepted = new Set(["--repo", "--before", "--after", "--before-tree", "--after-tree", "--out", "--token-file"]);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help") {
      console.log("Usage: node scripts/token-impact.mjs (--before REF --after REF [--repo DIR] | --before-tree DIR --after-tree DIR) [--token-file src/styles/tokens.ts] --out DIR\nWrites impact.json and impact.md. Static inventory only; never executes source. See docs/token-impact.md.");
      return;
    }
    if (!accepted.has(flag) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Invalid option: ${flag}`);
    const value = args[++index];
    if (flag === "--token-file") tokenFiles.push(value);
    else if (options[flag]) throw new Error(`Repeated option: ${flag}`);
    else options[flag] = value;
  }
  if (!options["--out"]) throw new Error("--out is required");
  const refMode = Boolean(options["--before"] && options["--after"] && !options["--before-tree"] && !options["--after-tree"]);
  const treeMode = Boolean(options["--before-tree"] && options["--after-tree"] && !options["--before"] && !options["--after"] && !options["--repo"]);
  if (!refMode && !treeMode) throw new Error("Supply exactly one complete before/after ref pair or tree pair");
  let before, after, comparison;
  if (refMode) {
    const left = readRef(options["--repo"] ?? process.cwd(), options["--before"]), right = readRef(options["--repo"] ?? process.cwd(), options["--after"]);
    before = left.files; after = right.files; comparison = { mode: "refs", before: left.sha, after: right.sha };
  } else {
    before = readTree(options["--before-tree"]); after = readTree(options["--after-tree"]); comparison = { mode: "trees" };
  }
  const report = { ...analyzeImpact(before, after, tokenFiles.length ? { tokenFiles } : {}), comparison };
  fs.mkdirSync(options["--out"], { recursive: true });
  fs.writeFileSync(path.join(options["--out"], "impact.json"), JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(path.join(options["--out"], "impact.md"), renderImpact(report));
  console.log("Token impact: %d changes, %d diagnostics. Complete impact analysis: false.", report.changes.length, report.diagnostics.length);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error("token-impact: %s", error.message); process.exitCode = 1; }
}
