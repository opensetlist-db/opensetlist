#!/usr/bin/env node
// Verify that a checkout's installed node_modules still matches its
// package-lock.json at the package-directory level:
//
//   node scripts/check-node-modules.mjs [root]      root defaults to cwd
//
// Exit 0 when every package the lockfile lists is present with a
// package.json; exit 3 with a per-package repair recipe otherwise;
// exit 2 when root has no usable package-lock.json or no node_modules.
// "Damaged" is deliberately not 1: an uncaught error (EACCES on a
// package dir, say) exits 1, and must not read as damage to a caller.
//
// Why this exists: task worktrees link node_modules to the MAIN
// checkout's (scripts/worktree-new.sh), so damage there reaches every
// worktree at once — and it surfaces far from its cause. A recursive
// delete that followed a junction once emptied pg, kuromoji,
// @prisma/client and a few tracing packages in place; nothing failed
// until a later `Cannot find module 'pg'` and hundreds of misleading
// tsc errors. worktree-new.sh runs this before linking, so a damaged
// copy is caught at the next worktree creation instead.
//
// One pass over the lockfile's `packages` map, one stat + readdir per
// entry: a few hundred milliseconds, unlike walking the tree.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? process.cwd());
const lockPath = path.join(root, "package-lock.json");
if (!existsSync(lockPath)) {
  console.error(`check-node-modules: no package-lock.json in ${root}`);
  process.exit(2);
}
if (!existsSync(path.join(root, "node_modules"))) {
  console.error(`check-node-modules: no node_modules in ${root}`);
  process.exit(2);
}

const lock = JSON.parse(readFileSync(lockPath, "utf8"));
if (!lock.packages) {
  // lockfileVersion 1 has only the nested `dependencies` tree; checking
  // nothing and printing "ok" would be a false all-clear.
  console.error(`check-node-modules: ${lockPath} has no "packages" map (lockfile v1?)`);
  process.exit(2);
}

const NM = "node_modules/";

// The installed name is the part after the last node_modules/ segment
// (scoped names keep their @scope/ prefix); `name` in the entry wins for
// npm-aliased installs, where the folder and the real package differ.
// npm pack names the tarball <scope>-<name>-<version>.tgz.
function describe(key, entry, problem) {
  const name = entry.name ?? key.slice(key.lastIndexOf(NM) + NM.length);
  const version = entry.version ?? "<version>";
  const tgz = `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
  return { key, name, version, tgz, integrity: entry.integrity, problem };
}

const broken = [];

for (const [key, entry] of Object.entries(lock.packages)) {
  // "" is the root project; workspace paths (no node_modules/ prefix)
  // are source folders, not installed packages.
  if (!key.startsWith(NM)) continue;

  const dir = path.join(root, key);
  let isDir = false;
  try {
    isDir = statSync(dir).isDirectory(); // follows links/junctions
  } catch {
    // absent (or a dangling link) — judged below
  }

  if (!isDir) {
    // `link` entries point at a workspace folder npm links in; optional
    // ones (platform-specific binaries such as @next/swc-*) are legitimately
    // skipped on other platforms — devOptional is the same flag for an
    // optional dependency of a dev dependency. Anything else should have
    // been installed.
    if (entry.link || entry.optional || entry.devOptional) continue;
    broken.push(describe(key, entry, "missing"));
    continue;
  }
  if (entry.link) continue; // the target is source, not an npm tarball

  const files = readdirSync(dir);
  if (files.length === 0) {
    broken.push(describe(key, entry, "empty directory"));
  } else if (!files.includes("package.json")) {
    broken.push(describe(key, entry, "no package.json"));
  }
}

if (broken.length === 0) {
  console.log(`check-node-modules: ok (${root})`);
  process.exit(0);
}

console.error(
  `check-node-modules: ${broken.length} damaged package(s) in ${path.join(root, "node_modules")}:`,
);
for (const { key, name, version, problem } of broken) {
  console.error(`  ${key}  ${name}@${version}  (${problem})`);
}

// Repair recipe. Run everything from the root with RELATIVE paths: Git
// Bash's tar reads `C:/...` as host:path (a remote archive) and fails.
// `npm pack` downloads the exact lockfile version into the cwd and
// prints its integrity, which must match the lockfile's before extracting.
console.error(`\nRepair, from ${root}:`);
for (const { key, name, version, tgz, integrity } of broken) {
  console.error(`\n  # ${key}`);
  console.error(`  npm pack ${name}@${version}`);
  console.error(`  #   integrity must equal: ${integrity ?? "(none in lockfile)"}`);
  console.error(`  mkdir -p ${key}`);
  console.error(`  tar -xzf ${tgz} -C ${key} --strip-components=1`);
  console.error(`  rm ${tgz}`);
}
console.error(
  "\nAlternatively run `npm ci` in the main checkout (~10 min on Windows);" +
    " it replaces node_modules for EVERY worktree linked to it, so stop" +
    " dev servers and test runs there first.",
);
process.exit(3);
