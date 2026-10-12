// Attribution smoke (n14 step 6, design §3): prove, BEFORE a transition
// run, that every request the harness will record can be joined to the
// deployment that served it via `x-vercel-id` ↔ `vercel logs --json` `id`.
//
//   node tests/load/attribution-smoke.mjs --base=<alias origin> --deployment=<immutable url | dpl_id>
//        [--out=<dir>] [--event-id=111] [--event-path=/events/111/<slug>]
//        [--locales=ko,ja,en] [--wait-s=15] [--headed]
//
// What it does (reads only — no writes; dev alias):
//   1. 10 SDK-style reads of /api/setlist on the alias, the way
//      subs-worker.mjs issues them (plain fetch, no pin): 5 generic, then
//      5 hinted (`minRev=<rev of the first answer>&hint=1`) — the two URL
//      shapes the transition population sends;
//   2. 1 Playwright page load of the event page on the alias, recording
//      the document AND EVERY /api/setlist request the page actually
//      issues (Codex round 3: the denominator is what the page sent, not
//      a fixed "11"), each with request-side pin evidence (`x-deployment-id`
//      header, `__vdpl` cookie, `dpl` query) — and, apart, how many
//      framework assets carried a `dpl` pin (Skew Protection pins assets;
//      the custom setlist fetch is expected to be unpinned);
//   3. waits --wait-s (default 15 s: log ingestion lag), exports the
//      deployment's JSON logs for the window with vercel-logs-json.sh and
//      joins every captured response by request id; unmatched requests
//      get one more export pass 20 s later (merged by id) before they are
//      reported unmatched;
//   4. writes <stamp>-attribution-smoke.{json,md} into
//      tests/load/results/<UTC date>/ (or --out) and exits 0 only when
//      every request matched a record whose deploymentId is the expected
//      deployment and whose path / status / method agree.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { attribute, normaliseResponse, parseJsonl, reqIdOf } from "./transition-join.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
if (!args.base || !args.deployment) {
  console.error("usage: node tests/load/attribution-smoke.mjs --base=<alias origin> --deployment=<immutable url | dpl_id> [--out=<dir>] [--event-id=111] [--event-path=…] [--wait-s=15]");
  process.exit(2);
}
const BASE = String(args.base).replace(/\/$/, "");
const DEPLOYMENT = String(args.deployment);
const EVENT_ID = String(args["event-id"] ?? "111");
const EVENT_PATH = String(args["event-path"] ?? "/events/111/rehearsal-lovelive-fes-2020-day1");
const LOCALES = String(args.locales ?? "ko,ja,en").split(",");
const WAIT_S = Number(args["wait-s"] ?? 15);
const now = new Date();
const OUT_DIR = String(args.out ?? path.join(HERE, "results", now.toISOString().slice(0, 10)));
const STAMP = now.toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The expected deployment id: given, or resolved from the immutable URL
// with `vercel inspect` (its "id" line). Resolved BEFORE the requests so a
// wrong URL fails fast.
function resolveDeploymentId(dep) {
  if (/^dpl_/.test(dep)) return dep;
  // One command string with shell: true — `npx` is a .cmd shim on Windows,
  // and passing an args array together with `shell` is deprecated (DEP0190).
  // The URL is validated first so nothing else reaches the shell.
  if (!/^[\w.:/-]+$/.test(dep)) throw new Error(`refusing an unexpected deployment value: ${dep}`);
  const scope = process.env.VERCEL_SCOPE ?? "opensetlist-projects";
  if (!/^[\w-]+$/.test(scope)) throw new Error(`refusing an unexpected VERCEL_SCOPE: ${scope}`);
  const r = spawnSync(`npx vercel inspect ${dep} --scope ${scope}`, { encoding: "utf8", shell: true });
  const m = /\bid\s+(dpl_[A-Za-z0-9]+)/.exec(`${r.stdout}\n${r.stderr}`);
  if (!m) throw new Error(`could not resolve a deployment id for ${dep}:\n${r.stderr}`);
  return m[1];
}

const headerSet = (h) => ({
  vercelId: h.get("x-vercel-id"),
  source: h.get("x-snapshot-source"),
  verify: h.get("x-snapshot-verify"),
  cache: { xVercelCache: h.get("x-vercel-cache"), cacheControl: h.get("cache-control"), age: h.get("age") },
});

async function sdkReads() {
  const out = [];
  const url = (locale, minRev) => `/api/setlist?eventId=${encodeURIComponent(EVENT_ID)}&locale=${locale}${minRev != null ? `&minRev=${minRev}&hint=1` : ""}`;
  let headRev = null;
  for (let i = 0; i < 10; i++) {
    const hinted = i >= 5;
    const locale = LOCALES[i % LOCALES.length];
    const p = url(locale, hinted ? headRev ?? 1 : null);
    const tStart = Date.now();
    let status = 0, rev = null, bodyValid = false, h = null, err = null;
    try {
      const res = await fetch(BASE + p);
      status = res.status;
      h = headerSet(res.headers);
      const body = await res.json().catch(() => null);
      bodyValid = !!body && Array.isArray(body.items);
      rev = Number.isSafeInteger(body?.rev) ? body.rev : null;
      if (headRev == null && rev != null) headRev = rev;
    } catch (e) { err = String(e?.message ?? e); }
    out.push({ pop: "sdk", client: `sdk-${i}`, kind: hinted ? "hinted" : "generic", tStart, tEnd: Date.now(), method: "GET", path: p, status, rev, bodyValid, notify: hinted, ...(h ?? {}), pin: { header: null, cookie: null, query: null }, err });
  }
  return out;
}

async function pageLoad() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: !args.headed });
  const baseHost = new URL(BASE).host;
  const reqs = new Map(); // Request → row
  const assets = { n: 0, dplQuery: 0, header: 0, cookie: 0 };
  let documentDpl = null;
  try {
    const context = await browser.newContext({ locale: "ko-KR" });
    // Same blocking as pages.mjs: no images / fonts / media / monitoring.
    await context.route("**/*", (route) => {
      const q = route.request();
      const t = q.resourceType();
      let u;
      try { u = new URL(q.url()); } catch { return route.continue(); }
      if (t === "image" || t === "media" || t === "font") return route.abort();
      if (u.host === baseHost && (u.pathname.startsWith("/monitoring") || u.pathname.startsWith("/_vercel/"))) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.on("request", async (q) => {
      let u;
      try { u = new URL(q.url()); } catch { return; }
      if (u.host !== baseHost) return;
      const hs = await q.allHeaders().catch(() => q.headers());
      const pin = { header: hs["x-deployment-id"] ?? null, cookie: /(?:^|;\s*)__vdpl=([^;]+)/.exec(hs.cookie ?? "")?.[1] ?? null, query: u.searchParams.get("dpl") };
      const isDoc = q.isNavigationRequest() && q.frame() === page.mainFrame();
      const isApi = u.pathname.startsWith("/api/setlist");
      if (!isDoc && !isApi) {
        assets.n++;
        if (pin.query) assets.dplQuery++;
        if (pin.header) assets.header++;
        if (pin.cookie) assets.cookie++;
        return;
      }
      const sp = u.searchParams;
      reqs.set(q, { pop: isDoc ? "document" : "page", client: "page-0", kind: isDoc ? "document" : sp.get("hint") === "1" ? "hinted" : "generic", tStart: Date.now(), tEnd: null, method: q.method(), path: u.pathname + u.search, status: null, notify: sp.get("hint") === "1", minRev: sp.get("minRev"), pin });
    });
    page.on("response", async (r) => {
      const row = reqs.get(r.request());
      if (!row) return;
      row.tEnd = Date.now();
      row.status = r.status();
      const h = await r.allHeaders().catch(() => r.headers());
      Object.assign(row, { vercelId: h["x-vercel-id"] ?? null, source: h["x-snapshot-source"] ?? null, verify: h["x-snapshot-verify"] ?? null, cache: { xVercelCache: h["x-vercel-cache"] ?? null, cacheControl: h["cache-control"] ?? null, age: h.age ?? null } });
      if (row.pop === "document") {
        const html = await r.text().catch(() => "");
        documentDpl = /data-dpl-id="([^"]+)"/.exec(html)?.[1] ?? null;
      } else {
        const txt = await r.text().catch(() => "");
        const i = txt.lastIndexOf('"rev":');
        row.rev = i >= 0 ? parseInt(txt.slice(i + 6), 10) : null;
        row.bodyValid = txt.includes('"items":[');
      }
    });
    page.on("requestfailed", (q) => { const row = reqs.get(q); if (row) { row.status = 0; row.tEnd = Date.now(); row.err = q.failure()?.errorText ?? "failed"; } });
    await page.goto(`${BASE}/ko${EVENT_PATH}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // Let the live hook run its first fetches / subscription (the page
    // decides how many /api/setlist requests it sends; all are kept).
    await sleep(10_000);
    await context.close();
  } finally {
    await browser.close();
  }
  return { rows: [...reqs.values()], assets, documentDpl };
}

function exportLogs(dep, from, to, file) {
  const r = spawnSync("bash", [path.join(HERE, "vercel-logs-json.sh"), dep, new Date(from).toISOString(), new Date(to).toISOString(), file, "1000"], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

function evaluate(captured, recs, expectedId) {
  const responses = captured.map((c) => normaliseResponse({ ...c, pop: c.pop === "document" ? "document" : c.pop }, c.pop));
  const rows = attribute(responses, new Map([[expectedId, recs]]));
  return rows.map((r, i) => {
    const c = captured[i];
    const mismatch = [...r.attr.mismatch];
    if (r.attr.matched && r.attr.deploymentId !== expectedId) mismatch.push(`deployment ${r.attr.deploymentId} ≠ expected ${expectedId}`);
    return { ...c, reqId: reqIdOf(c.vercelId), matched: r.attr.matched, consistent: r.attr.matched && mismatch.length === 0, mismatch, record: r.attr.matched ? { deploymentId: r.attr.deploymentId, timestamp: r.attr.recordTs } : null, lines: r.attr.lines ? { hintFetch: r.attr.lines.hintFetch.length, builds: r.attr.lines.builds, warmLookup: r.attr.lines.warmLookup.length, pool: r.attr.lines.pool.length } : null };
  });
}

function toMarkdown(rep) {
  const L = [];
  L.push(`# Attribution smoke — ${rep.at}`);
  L.push("");
  L.push(`- Alias ${rep.base}; expected deployment ${rep.expectedId} (${rep.deployment}); document \`data-dpl-id\` ${rep.documentDpl ?? "—"}`);
  L.push(`- Window ${rep.window.from} → ${rep.window.to}; log export passes: ${rep.exports.map((e) => `\`${e.stdout.split("\n").pop()}\``).join(" · ")}`);
  L.push(`- **${rep.totals.consistent}/${rep.totals.n} requests attributed consistently** (matched ${rep.totals.matched}; SDK ${rep.totals.sdk.consistent}/${rep.totals.sdk.n}, page API ${rep.totals.page.consistent}/${rep.totals.page.n}, document ${rep.totals.document.consistent}/${rep.totals.document.n}) → ${rep.ok ? "**PASS**" : "**FAIL**"}`);
  L.push(`- Pin evidence: SDK reads send no pin (plain fetch); page /api/setlist requests with a pin: ${rep.rows.filter((r) => r.pop === "page" && (r.pin?.header || r.pin?.cookie || r.pin?.query)).length}/${rep.rows.filter((r) => r.pop === "page").length}; framework assets ${rep.assets.n}, with \`dpl\` query ${rep.assets.dplQuery}, header ${rep.assets.header}, cookie ${rep.assets.cookie}.`);
  L.push("");
  L.push("| # | population | kind | path | status | x-vercel-id | source / verify | x-vercel-cache / age | pin (hdr / cookie / dpl) | matched | record deployment | consistent | nested lines | note |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  rep.rows.forEach((r, i) => {
    L.push(`| ${i + 1} | ${r.pop} | ${r.kind} | \`${r.path}\` | ${r.status ?? "—"} | ${r.vercelId ?? "—"} | ${r.source ?? "—"} / ${r.verify ?? "—"} | ${r.cache?.xVercelCache ?? "—"} / ${r.cache?.age ?? "—"} | ${r.pin?.header ?? "—"} / ${r.pin?.cookie ?? "—"} / ${r.pin?.query ?? "—"} | ${r.matched ? "yes" : "**no**"} | ${r.record?.deploymentId ?? "—"} | ${r.consistent ? "yes" : "**no**"} | ${r.lines ? `hint-fetch ${r.lines.hintFetch}, build ${r.lines.builds}, warm-lookup ${r.lines.warmLookup}, pool ${r.lines.pool}` : "—"} | ${r.mismatch.join("; ")}${r.err ? ` ${r.err}` : ""} |`);
  });
  L.push("");
  L.push("Request attribution only: nested-line presence is informational here (a generic cache hit logs nothing; a hinted read on an R2 deployment logs `[setlist] hint-fetch`).");
  return L.join("\n") + "\n";
}

const expectedId = resolveDeploymentId(DEPLOYMENT);
console.log(`[smoke] expected deployment ${expectedId}; alias ${BASE}`);
const t0 = Date.now();
const sdk = await sdkReads();
console.log(`[smoke] 10 SDK reads done: ${sdk.map((r) => r.status).join(",")}`);
const pg = await pageLoad();
console.log(`[smoke] page load: document + ${pg.rows.filter((r) => r.pop === "page").length} /api/setlist request(s), ${pg.assets.n} asset(s)`);
const captured = [...sdk, ...pg.rows];
const from = t0 - 5_000;
const to = Math.max(...captured.map((r) => r.tEnd ?? r.tStart)) + 5_000;
console.log(`[smoke] waiting ${WAIT_S} s for log ingestion`);
await sleep(WAIT_S * 1000);
fs.mkdirSync(OUT_DIR, { recursive: true });
const logFile = path.join(OUT_DIR, `${STAMP}-attribution-smoke-logs.jsonl`);
const exports = [exportLogs(DEPLOYMENT, from, to, logFile)];
let rows = evaluate(captured, parseJsonl(fs.readFileSync(logFile, "utf8")), expectedId);
if (rows.some((r) => !r.matched)) {
  console.log(`[smoke] ${rows.filter((r) => !r.matched).length} unmatched — second export pass in 20 s`);
  await sleep(20_000);
  exports.push(exportLogs(DEPLOYMENT, from, to, logFile));
  rows = evaluate(captured, parseJsonl(fs.readFileSync(logFile, "utf8")), expectedId);
}
const tot = (f) => ({ n: rows.filter(f).length, consistent: rows.filter((r) => f(r) && r.consistent).length });
const rep = {
  at: new Date().toISOString(), base: BASE, deployment: DEPLOYMENT, expectedId, documentDpl: pg.documentDpl,
  window: { from: new Date(from).toISOString(), to: new Date(to).toISOString() }, exports,
  totals: { n: rows.length, matched: rows.filter((r) => r.matched).length, consistent: rows.filter((r) => r.consistent).length, sdk: tot((r) => r.pop === "sdk"), page: tot((r) => r.pop === "page"), document: tot((r) => r.pop === "document") },
  assets: pg.assets, rows,
};
rep.ok = rep.totals.n > 0 && rep.totals.consistent === rep.totals.n;
const base = path.join(OUT_DIR, `${STAMP}-attribution-smoke`);
fs.writeFileSync(`${base}.json`, JSON.stringify(rep, null, 2));
const md = toMarkdown(rep);
fs.writeFileSync(`${base}.md`, md);
console.log(md);
console.log(`[smoke] wrote ${base}.{json,md}`);
process.exit(rep.ok ? 0 : 1);
