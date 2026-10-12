// Helpers for `history-fetch.sh` (n14 step 7): count, assemble and merge
// the TEXT history exports of `npx vercel logs <target> --since --until
// --limit --expand`, and parse the self-describing file they produce.
//
//   node tests/load/history-merge.mjs count <slice.txt>
//   node tests/load/history-merge.mjs slices <history.txt>
//   node tests/load/history-merge.mjs assemble <history.txt> <manifest> \
//        --target=<t> --since=<iso> --until=<iso> --limit=<n> --tz=<±hhmm> \
//        --resplit=<n> [--second-pass]
//
// Why a REQUEST RECORD count and not `wc -l`: the CLI's `--limit` counts
// request records (one per request id; verified in JSON mode on CLI
// 63.1.2, README "vercel-logs-json.sh — export caveats"), and in text mode
// one record is a header line followed by any number of nested function
// lines (`[liveSnapshot] build`, `[prisma] pool`, …) — or none at all.
// A slice is saturated (the CLI silently kept only the NEWEST `limit`
// records) when its record count reaches the limit; its line count says
// nothing about that. The record is recognised by the same header parser
// the summariser uses (`parseHeader` in vercel-logs-summary.mjs), so "a
// record" means the same thing in the saturation check and in every count
// the join reports.
//
// File format written by `assemble` (every marker starts with `### capture`
// so vercel-logs-summary.mjs's META filter skips it; none starts with
// `### capture segment start`, which would trigger that parser's
// cross-segment dedupe):
//
//   ### capture history-fetch v1 target=<t> since=<iso> until=<iso> limit=<n> tz=<±hhmm> passes=<1|2> fetchedAt=<iso> [secondPassAt=<iso>]
//   ### capture slice from=<iso> to=<iso> records=<n> status=ok|saturated|failed pass1=<n|failed> [pass2=<n|failed|saturated> identical= enriched= new= pass1Only=]
//   <the CLI's stdout for that slice — header + nested lines per record>
//   …
//   ### capture coverage slices= records= saturated= resplit= failed= passes= pass2Failed= identical= enriched= new= pass1Only= maxPerSlice= limit= span=<since>/<until>
//
// Slices are DISJOINT: slice [a, b) is fetched with `--since a --until
// b − 1 ms` (both bounds are inclusive at ms precision — verified for the
// CLI on 2026-10-12, README l.1255), so no record can appear in two
// slices and no cross-slice dedupe is needed (or attempted: text records
// carry no request id, and two different requests with the same header
// within 10 ms are common at 50 req/s — "identical text" is NOT "same
// request" across slices).
//
// Second pass (dedupe rule, within ONE slice only): background `after()`
// lines (the writer's warm job, its builds and pool lines) land in a
// request's record LATER than the response, so the same slice fetched
// again a few minutes later can hold a longer copy of a record. Per slice
// the pass-2 records replace the pass-1 records as follows:
//   1. records are grouped by their exact header line (time to 10 ms,
//      host, level, method, path);
//   2. inside a group, a pass-1 record is matched to a pass-2 record with
//      the IDENTICAL multiset of nested lines first ("identical"), then
//      to a pass-2 record whose nested lines are a strict SUPERSET of it
//      ("enriched" — the later, longer copy wins);
//   3. pass-2 records left unmatched are "new" (indexed after pass 1 ran);
//      pass-1 records left unmatched are KEPT and counted as "pass1Only"
//      (pass 2 should have returned every record pass 1 saw — a non-zero
//      count means pass 2 was short, e.g. it failed or saturated, and is
//      reported, never silently dropped).
// Matching by content can pair the wrong two of several identical-header
// records whose line sets nest; that only moves an enrichment between two
// records of the same instant and path, and never changes a count.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseHeader, META } from "./vercel-logs-summary.mjs";

/**
 * Split CLI text into request records: [{ header, lines[] }]. Blank lines,
 * CLI preamble and `### capture …` markers are skipped; lines before the
 * first header are returned as `loose` (they belong to no record).
 */
export function splitEntries(text) {
  const entries = [];
  const loose = [];
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith("### capture")) { cur = null; continue; }
    if (parseHeader(line)) {
      cur = { header: line, lines: [] };
      entries.push(cur);
      continue;
    }
    if (META.test(line.trim())) continue;
    if (cur) cur.lines.push(line);
    else loose.push(line);
  }
  return { entries, loose };
}

export const countRecords = (text) => splitEntries(text).entries.length;

/**
 * The CLI's own record count for one call: `Fetched <N> logs for …` (its
 * last line, on STDERR in text mode), 0 for `No logs found …`, null when
 * neither line is there (an interrupted call).
 */
export function cliCount(text) {
  const m = /^Fetched (\d+) logs?\b/m.exec(String(text));
  if (m) return Number(m[1]);
  return /^No logs found\b/m.test(String(text)) ? 0 : null;
}

const multiset = (lines) => {
  const m = new Map();
  for (const l of lines) m.set(l, (m.get(l) || 0) + 1);
  return m;
};
const sameLines = (a, b) => {
  if (a.length !== b.length) return false;
  const ma = multiset(a);
  for (const [k, v] of multiset(b)) if (ma.get(k) !== v) return false;
  return true;
};
// b ⊋ a as multisets.
const strictSuperset = (b, a) => {
  if (b.length <= a.length) return false;
  const mb = multiset(b);
  for (const [k, v] of multiset(a)) if ((mb.get(k) || 0) < v) return false;
  return true;
};

/**
 * Merge two fetches of the SAME slice (see the header for the rule).
 * Returns the merged records plus the counts.
 */
export function mergeEntries(pass1, pass2) {
  const groups = new Map();
  for (const e of pass2) {
    if (!groups.has(e.header)) groups.set(e.header, []);
    groups.get(e.header).push({ e, used: false });
  }
  let identical = 0;
  let enriched = 0;
  const pass1Only = [];
  const pending = [];
  // Identical copies first, across all groups, so an exact pair is never
  // stolen by a superset match.
  for (const a of pass1) {
    const g = groups.get(a.header) ?? [];
    const hit = g.find((x) => !x.used && sameLines(x.e.lines, a.lines));
    if (hit) { hit.used = true; identical++; } else pending.push(a);
  }
  // Then the longest pass-1 records first: they have the fewest supersets.
  pending.sort((x, y) => y.lines.length - x.lines.length);
  for (const a of pending) {
    const g = groups.get(a.header) ?? [];
    const hit = g.find((x) => !x.used && strictSuperset(x.e.lines, a.lines));
    if (hit) { hit.used = true; enriched++; } else pass1Only.push(a);
  }
  let added = 0;
  for (const g of groups.values()) for (const x of g) if (!x.used) added++;
  return { merged: [...pass2, ...pass1Only], identical, enriched, new: added, pass1Only: pass1Only.length };
}

const kv = (line) => {
  const out = {};
  for (const m of line.matchAll(/([A-Za-z_][\w]*)=(\S+)/g)) out[m[1]] = m[2];
  return out;
};

/**
 * Parse a file written by `assemble`. Files without the markers (e.g. the
 * older history-fetch-par.sh concatenation) return { header: null,
 * slices: [], coverage: null } — the caller must then treat completeness
 * as unknown.
 */
export function parseFetchFile(text) {
  const out = { header: null, slices: [], coverage: null };
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith("### capture history-fetch")) { out.header = kv(line); continue; }
    if (line.startsWith("### capture coverage")) { out.coverage = kv(line); cur = null; continue; }
    if (line.startsWith("### capture slice")) {
      const f = kv(line);
      cur = { ...f, fromMs: Date.parse(f.from), toMs: Date.parse(f.to), records: Number(f.records), body: [] };
      out.slices.push(cur);
      continue;
    }
    if (cur) cur.body.push(raw);
  }
  for (const s of out.slices) s.body = s.body.join("\n");
  return out;
}

const iso = (ms) => new Date(ms).toISOString();
const render = (entries) => entries.map((e) => [e.header, ...e.lines].join("\n")).join("\n\n");

function sliceLine(s) {
  const extra = s.pass2 != null
    ? ` pass2=${s.pass2} identical=${s.identical ?? 0} enriched=${s.enriched ?? 0} new=${s.new ?? 0} pass1Only=${s.pass1Only ?? 0}`
    : "";
  // cli = the CLI's own `Fetched N` for the LATEST pass of this slice
  // (summed over its leaves; `?` when any call printed no count).
  return `### capture slice from=${iso(s.fromMs)} to=${iso(s.toMs)} records=${s.records} status=${s.status} pass1=${s.pass1} cli=${s.cli ?? "?"}${extra}`;
}

// Sum of the leaves' CLI counts; null when any is unknown.
const cliSum = (leaves) => (leaves.some((l) => l.cli == null) ? null : leaves.reduce((a, l) => a + l.cli, 0));

/** Coverage over assembled slices (the footer line, also printed). */
export function coverageOf(slices, { limit, resplit = 0, passes = 1, since, until }) {
  const sum = (k) => slices.reduce((a, s) => a + (Number(s[k]) || 0), 0);
  return {
    slices: slices.length,
    records: sum("records"),
    saturated: slices.filter((s) => s.status === "saturated").length,
    resplit,
    failed: slices.filter((s) => s.status === "failed").length,
    passes,
    pass2Failed: passes > 1 ? slices.filter((s) => s.pass2 === "failed" || s.pass2 === "saturated" || s.pass2 == null).length : 0,
    identical: sum("identical"), enriched: sum("enriched"), new: sum("new"), pass1Only: sum("pass1Only"),
    // Slices whose latest pass printed no `Fetched N` line, and slices
    // where that count disagrees with the records parsed from the same
    // call (`fetched` = the parsed count of the latest pass).
    cliUnknown: slices.filter((s) => s.status !== "failed" && (s.cli == null || s.cli === "?")).length,
    cliMismatch: slices.filter((s) => s.cli != null && s.cli !== "?" && s.fetched != null && Number(s.cli) !== Number(s.fetched)).length,
    maxPerSlice: slices.reduce((m, s) => Math.max(m, Number(s.records) || 0), 0),
    limit,
    span: `${since}/${until}`,
  };
}
const coverageLine = (c) => `### capture coverage ${Object.entries(c).map(([k, v]) => `${k}=${v}`).join(" ")}`;

/**
 * Manifest = this pass's LEAF slices, one per line:
 *   <fromMs> <toMs> <ok|saturated|failed> <records> <cli count|?> <file>
 * First pass: the leaves become the file's slices. Second pass: every
 * leaf is assigned to the existing slice containing its start and the
 * slice's records are merged (see the header).
 */
export function assemble({ existingText = null, leaves, readLeaf, target, since, until, limit, tz, resplit = 0, now = new Date() }) {
  const leafEntries = (l) => (l.status === "failed" ? [] : splitEntries(readLeaf(l)).entries);
  let header;
  let slices;
  if (existingText == null) {
    header = { target, since, until, limit, tz, passes: 1, fetchedAt: now.toISOString() };
    slices = leaves.map((l) => {
      const entries = leafEntries(l);
      return { fromMs: l.fromMs, toMs: l.toMs, status: l.status, pass1: l.status === "failed" ? "failed" : entries.length, records: entries.length, fetched: entries.length, cli: l.status === "failed" ? null : l.cli, entries };
    });
  } else {
    const prev = parseFetchFile(existingText);
    if (!prev.header) throw new Error("second pass: the existing file has no `### capture history-fetch` header (not written by history-fetch.sh)");
    header = { ...prev.header, passes: 2, secondPassAt: now.toISOString() };
    slices = prev.slices.map((s) => {
      const mine = leaves.filter((l) => l.fromMs >= s.fromMs && l.fromMs < s.toMs);
      const p1 = splitEntries(s.body).entries;
      const failed = !mine.length || mine.some((l) => l.status === "failed");
      const saturated = mine.some((l) => l.status === "saturated");
      const p2 = mine.flatMap(leafEntries);
      if (failed) {
        // Pass 2 did not return the whole slice: keep pass 1 as it was.
        return { ...s, pass1: s.pass1 ?? s.records, pass2: "failed", records: p1.length, fetched: null, entries: p1, identical: 0, enriched: 0, new: 0, pass1Only: 0 };
      }
      const m = mergeEntries(p1, p2);
      // A slice pass 1 could not fetch is now ok when pass 2 got it.
      let status = s.status === "failed" ? "ok" : s.status;
      if (saturated) status = "saturated";
      else if (s.status === "saturated") status = "saturated"; // pass-1 truncation is not undone by a merge
      return { ...s, pass1: s.pass1 ?? s.records, pass2: saturated ? "saturated" : p2.length, status, records: m.merged.length, fetched: p2.length, cli: cliSum(mine), entries: m.merged, identical: m.identical, enriched: m.enriched, new: m.new, pass1Only: m.pass1Only };
    });
    resplit = Number(prev.coverage?.resplit ?? 0) + resplit;
  }
  const cov = coverageOf(slices, { limit: header.limit, resplit, passes: Number(header.passes), since: header.since, until: header.until });
  const L = [`### capture history-fetch v1 ${Object.entries(header).map(([k, v]) => `${k}=${v}`).join(" ")}`];
  for (const s of slices) {
    L.push(sliceLine(s));
    if (s.entries.length) L.push(render(s.entries));
    L.push("");
  }
  L.push(coverageLine(cov));
  return { text: L.join("\n") + "\n", coverage: cov, line: coverageLine(cov) };
}

// ─── CLI ───
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, ...rest] = process.argv.slice(2);
  const pos = rest.filter((a) => !a.startsWith("--"));
  const opt = Object.fromEntries(rest.filter((a) => a.startsWith("--")).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return [m[1], m[2] ?? true];
  }));
  if (cmd === "count") {
    const t = fs.readFileSync(pos[0], "utf8");
    console.log(`${countRecords(t)} ${cliCount(t) ?? "?"}`);
  } else if (cmd === "slices") {
    for (const s of parseFetchFile(fs.readFileSync(pos[0], "utf8")).slices) console.log(`${s.fromMs} ${s.toMs}`);
  } else if (cmd === "assemble") {
    const [out, manifest] = pos;
    const leaves = fs.readFileSync(manifest, "utf8").split(/\r?\n/).filter((l) => l.trim()).map((l) => {
      // `<fromMs> <toMs> <status> <records> <cli|?> <file>` — the file
      // path last, so a path with spaces survives.
      const [fromMs, toMs, status, records, cli, ...file] = l.split(" ");
      return { fromMs: Number(fromMs), toMs: Number(toMs), status, records: Number(records), cli: cli === "?" ? null : Number(cli), file: file.join(" ") };
    }).sort((a, b) => a.fromMs - b.fromMs);
    const existingText = opt["second-pass"] ? fs.readFileSync(out, "utf8") : null;
    const r = assemble({
      existingText, leaves, readLeaf: (l) => fs.readFileSync(l.file, "utf8"),
      target: opt.target, since: opt.since, until: opt.until, limit: Number(opt.limit), tz: opt.tz ?? "",
      resplit: Number(opt.resplit ?? 0),
    });
    fs.writeFileSync(out, r.text);
    console.log(r.line.replace(/^### capture /, ""));
    process.exit(r.coverage.saturated || r.coverage.failed || r.coverage.pass2Failed || r.coverage.cliMismatch ? 3 : 0);
  } else {
    console.error("usage: history-merge.mjs count <file> | slices <history.txt> | assemble <history.txt> <manifest> --target= --since= --until= --limit= --tz= [--resplit=N] [--second-pass]");
    process.exit(2);
  }
}
