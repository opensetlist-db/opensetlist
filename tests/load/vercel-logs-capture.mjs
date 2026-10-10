// Capture the dev preview's Vercel runtime logs to a text file for the
// length of a load run, for `vercel-logs-summary.mjs` to count builds,
// EMAXCONN errors, instances and pool sizes afterwards.
//
// Why a Node loop and not a shell one-liner:
//   - `vercel logs --follow` ends on its own after ~5 minutes ("Exceeded
//     query duration limit") and only streams from the moment it starts,
//     so a longer run needs it restarted — and a plain restart loses the
//     ~3 s the CLI needs to resolve the deployment, which could be exactly
//     a burst. So segments OVERLAP: segment n+1 starts `--overlap` seconds
//     (default 15) before segment n is stopped at `--segment` seconds
//     (default 280). Each segment writes its own part file, and parts are
//     appended to the output in order, each behind a
//     `### capture segment start <UTC>` marker; the summariser drops the
//     entries a segment repeats from the previous one.
//   - Detached `bash -c` loops did not start on the Windows load machine;
//     this script is launched with PowerShell `Start-Process` instead (see
//     tests/load/README.md) and stops on the same STOP file as
//     pooler-clients.mjs (default `tests/load/results/<UTC date>/run2b.STOP`,
//     ignored when older than this process) or after `--max-minutes`.
//   - Text mode, not `--json`: `--json` wrote nothing in run #2's capture.
//
// Only the dev-branch alias is accepted as the target: the capture is
// read-only, but a production log file in the results folder would be
// published with the repo.
//
// Usage: node tests/load/vercel-logs-capture.mjs [--url=<dev alias>]
//          [--scope=opensetlist-projects] [--out=<file>] [--segment=280]
//          [--overlap=15] [--max-minutes=90] [--stop-file=<path>]
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./realtime/lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const url = args.url ?? process.env.BASE_URL ?? "https://opensetlist-git-dev-opensetlist-projects.vercel.app";
let host = "";
try { host = new URL(url).hostname; } catch { /* checked below */ }
if (!/^opensetlist-git-dev-[a-z0-9-]+\.vercel\.app$/.test(host)) {
  console.error("refusing: --url / BASE_URL is not the dev-branch preview alias");
  process.exit(2);
}
const scope = args.scope ?? "opensetlist-projects";
if (!/^[a-z0-9-]+$/.test(scope)) {
  console.error("--scope must be a team slug");
  process.exit(2);
}
const segmentMs = (parseFloat(args.segment ?? "280") || 280) * 1000;
const overlapMs = Math.min(segmentMs / 2, (parseFloat(args.overlap ?? "15") || 0) * 1000);
const maxMs = (parseFloat(args["max-minutes"] ?? "90") || 90) * 60_000;
const startedAt = Date.now();
const day = new Date(startedAt).toISOString().slice(0, 10);
const outDir = path.join(HERE, "results", day);
fs.mkdirSync(outDir, { recursive: true });
const out = args.out ?? path.join(outDir, `${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}-vercel-logs.txt`);
const stopFile = args["stop-file"] ?? path.join(outDir, "run2b.STOP");

const stopRequested = () => {
  try { return fs.statSync(stopFile).mtimeMs >= startedAt; } catch { return false; }
};

// `npx` is a .cmd shim on Windows, so it runs through a shell (one
// command string: both the URL and the scope were validated above, so
// nothing in it needs quoting). Killing the shell alone would orphan the
// node process behind it, hence taskkill /T there.
const CMD = `npx vercel logs ${url} --follow --scope ${scope}`;
function killTree(child) {
  if (child.exitCode != null || child.signalCode != null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

const segs = []; // { n, start, part, fd, child, exited, flushed }
function startSegment() {
  const n = segs.length + 1;
  const part = `${out}.part${String(n).padStart(3, "0")}`;
  const fd = fs.openSync(part, "w");
  const child = spawn(CMD, { shell: true, stdio: ["ignore", fd, fd] });
  const seg = { n, start: Date.now(), part, fd, child, exited: false, flushed: false };
  child.on("exit", () => { seg.exited = true; });
  segs.push(seg);
  console.log(`segment ${n} started ${new Date(seg.start).toISOString()}`);
}

// Append finished segments to the output strictly in order.
function flush() {
  for (const s of segs) {
    if (s.flushed) continue;
    if (!s.exited) return;
    fs.closeSync(s.fd);
    fs.appendFileSync(out, `### capture segment start ${new Date(s.start).toISOString()}\n`);
    fs.appendFileSync(out, fs.readFileSync(s.part));
    fs.rmSync(s.part, { force: true });
    s.flushed = true;
    console.log(`segment ${s.n} appended (${Math.round((Date.now() - s.start) / 1000)} s)`);
  }
}

console.log(`capturing ${url} → ${out}; stop with ${stopFile}`);
startSegment();
let reason = null;
while (true) {
  await new Promise((r) => setTimeout(r, 1000));
  if (!reason && stopRequested()) reason = "STOP file";
  if (!reason && Date.now() - startedAt >= maxMs) reason = `--max-minutes=${maxMs / 60000}`;
  const live = segs.filter((s) => !s.exited);
  if (reason) {
    for (const s of live) killTree(s.child);
    if (segs.every((s) => s.exited)) break;
    continue;
  }
  const newest = segs[segs.length - 1];
  const age = Date.now() - newest.start;
  // Successor: before the newest one is retired, or at once when it died
  // on its own (CLI limit, network) — but not in a tight loop when every
  // start fails immediately (expired login, CLI missing).
  if (age >= segmentMs - overlapMs || (newest.exited && age >= 5000)) startSegment();
  for (const s of live) if (Date.now() - s.start >= segmentMs) killTree(s.child);
  flush();
}
flush();
fs.appendFileSync(out, `### capture end ${new Date().toISOString()} (${reason})\n`);
console.log(`stopped (${reason})`);
process.exit(0);
