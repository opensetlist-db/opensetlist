// n14 qualification step 5 — the pre-boundary probe for k6's admission
// mode (viewers.js `ADMISSION=1`, run A1). Dev only.
//
// k6's normal start-up (setup()'s five snapshot reads, the admin login,
// the snapshot-read → save → b00 cold start) would put requests on the
// deployment BEFORE the admission wave — on a fresh deployment, those
// requests are exactly what makes it not cold any more. So everything
// k6 needs from the server is collected HERE, BEFORE the cold boundary,
// against the PRECURSOR deployment (the deployment that is then
// redeployed with identical settings to create the untouched
// measurement deployment). k6 then reads this file and its first
// request after t=0 is the admission wave.
//
// Never run this against the measurement deployment: every request it
// makes (the snapshot reads build/cache snapshots, the anchor insert
// warms) would warm the very target the run must find cold.
//
//   node tests/load/admission-probe.mjs --base=<precursor url> --label=A1 [--fixture=<manifest>]
//        [--after-row=<n>] [--markers=3] [--anchor=create|none]
//   node tests/load/admission-probe.mjs --cleanup=<probe file> [--base=<url>]
//
// What it does, in order:
//   1. the dev-identity check (`--base` may be the dev alias or an
//      `opensetlist-<hash>` deployment URL; the latter has the same shape
//      as a production deployment, so — as run.mjs `--deployment-url` —
//      the target must serve this event at the dev database's revision
//      with the dev database's exact id@position list before anything is
//      written; one ko read with `minRev=<db rev>`, which bypasses
//      cached snapshots);
//   2. five ja snapshot reads for the clock offset, the same method as
//      viewers.js setup(): offset = servedAt − local send/receive
//      midpoint, taken from the sample with the smallest round trip
//      (error ±RTT/2). Taken on the precursor's instance(s): a fresh
//      deployment's instances may differ, so cross-clock comparisons in
//      the join stay "indeterminate" within the bound (step-5 design §0);
//   3. event sanity: status `ongoing`, active row count, revision (and,
//      with `--fixture`, that the fixture manifest is committed and the
//      event holds exactly its rows);
//   4. ONE admin login (the Vercel firewall rate-limits
//      /api/admin/login; k6 reuses this cookie, the clean-up too);
//   5. the dedicated anchor: one blank row through POST
//      /api/admin/setlist-items/insert-after, by default after the LAST
//      ordinary row (so the PUT's `isEncore: false` keeps the encore order
//      valid and only the encore block shifts). k6's measured PUTs edit
//      ONLY this row — the PUT deletes and recreates all three junction
//      collections, so editing a fixture/original row would destroy its
//      representative member structure. Marker songs (never referenced
//      by any SetlistItemSong) are picked for the saves;
//   6. writes `tests/load/results/<UTC date>/admission-probe-<label>.json`.
//
// The probe file holds the admin session cookie (7-day session). It
// lives under tests/load/results/, whose *.json files are gitignored —
// never copy it anywhere that is committed or uploaded.
//
// Clean-up (`--cleanup=<probe file>`, after k6 and BEFORE the fixture's
// own clean-up): soft-deletes the anchor through the admin API, puts the
// rows the anchor shifted back on their pre-anchor positions and
// publishes that through the writer path (tests/load/browsers/admin.mjs
// `cleanup`), reusing the probe's cookie — no second login. Default base
// = the dev alias (after the redeploy it serves the measurement
// deployment; the precursor's own URL works too).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, assertDev, parseArgs, pgClient, isAllowedBaseUrl, isDeploymentBaseUrl } from "./realtime/lib.mjs";
import { adminLogin, insertAfter, activeRows, pickMarkerSongs, cleanup as adminCleanup } from "./browsers/admin.mjs";
import { ADMIN_COOKIE_NAME } from "./lib/constants.js";

const REPO = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DEV_ALIAS = "https://opensetlist-git-dev-opensetlist-projects.vercel.app";

loadEnv();
assertDev();
const args = parseArgs(process.argv.slice(2));
const EVENT_ID = String(args["event-id"] ?? "111");
// Data-safety boundary: every n14 load/drill tool writes to the dev test
// event 111 only (CLAUDE.md / tests/load/README.md). `--event-id` exists so
// the SQL is not hard-wired, but on this project nothing else may be the
// target: a typo here would clone rows into, or re-position, a real event
// in the dev database that mirrors production content. Refuse anything else.
if (EVENT_ID !== "111") {
  console.error(`refusing --event-id=${EVENT_ID}: the n14 drill tools only touch dev event 111`);
  process.exit(2);
}
const log = (...a) => console.log(...a);

function checkBase(raw) {
  const base = String(raw || "").replace(/\/$/, "");
  if (!isAllowedBaseUrl(base) && !isDeploymentBaseUrl(base)) {
    throw new Error("--base must be the dev alias, localhost, or an opensetlist-<hash>-opensetlist-projects.vercel.app deployment URL");
  }
  return base;
}

function headers() {
  const h = { "accept-encoding": "gzip, deflate, br" };
  if (process.env.VERCEL_BYPASS) h["x-vercel-protection-bypass"] = process.env.VERCEL_BYPASS;
  return h;
}

async function snapshot(base, locale, minRev = null) {
  const url = `${base}/api/setlist?eventId=${EVENT_ID}&locale=${locale}${minRev != null ? `&minRev=${minRev}` : ""}`;
  const t0 = Date.now();
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(60000) });
  const body = await res.json().catch(() => null);
  const t1 = Date.now();
  if (res.status !== 200 || !body) throw new Error(`snapshot ${locale}: HTTP ${res.status}`);
  return { t0, t1, body, source: res.headers.get("x-snapshot-source") };
}

async function probe() {
  const label = String(args.label || "");
  if (!/^[A-Za-z0-9_.-]+$/.test(label)) throw new Error("--label=<name> is required ([A-Za-z0-9_.-])");
  const base = checkBase(args.base);
  const file = path.join(REPO, "tests", "load", "results", new Date().toISOString().slice(0, 10), `admission-probe-${label}.json`);
  if (fs.existsSync(file)) throw new Error(`${file} exists — pick another --label`);
  const anchorMode = String(args.anchor ?? "create");
  const nMarkers = parseInt(args.markers ?? "3", 10);

  const pg = pgClient();
  await pg.connect();
  try {
    const ev = await pg.query(`select slug, status::text as status, "setlistRevision"::text as rev from "Event" where id = $1`, [EVENT_ID]);
    if (!ev.rows.length) throw new Error(`event ${EVENT_ID} not found`);
    const { slug, status } = ev.rows[0];
    const dbRev = Number(ev.rows[0].rev);
    const rows0 = await activeRows(pg, EVENT_ID);
    if (status !== "ongoing") throw new Error(`event ${EVENT_ID} status is ${status}, expected ongoing`);

    // 1. dev identity (read-only; a mismatch stops before any write).
    const id = await snapshot(base, "ko", dbRev);
    const served = (id.body.items || []).map((it) => `${it.id}@${Number(it.position)}`).join(",");
    const expected = rows0.map((r) => `${r.id}@${r.position}`).join(",");
    if (Number(id.body.rev) !== dbRev || served !== expected) {
      throw new Error(`${base} serves event ${EVENT_ID} at rev ${id.body.rev} with rows [${served.slice(0, 120)}], the dev database has rev ${dbRev} with [${expected.slice(0, 120)}] — not the dev deployment (or a concurrent save: re-run); nothing was written`);
    }
    log(`identity: ${base} serves event ${EVENT_ID} at the dev database's rev ${dbRev} with its ${rows0.length} rows`);

    // 2. clock offset — five ja reads, as viewers.js setup().
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const s = await snapshot(base, "ja");
      const served = Date.parse(s.body.servedAt);
      samples.push({ rtt: s.t1 - s.t0, offsetMs: Number.isFinite(served) ? served - (s.t0 + s.t1) / 2 : null, rev: s.body.rev, rows: s.body.items?.length ?? null, source: s.source });
    }
    const usable = samples.filter((s) => s.offsetMs != null);
    if (!usable.length) throw new Error("no servedAt in the snapshot — is R1+ deployed?");
    const best = usable.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    log(`clock: offset ${Math.round(best.offsetMs)} ms ±${Math.round(best.rtt / 2)} ms (best of ${samples.length}, RTTs ${samples.map((s) => s.rtt).join("/")} ms)`);

    // 3. fixture sanity.
    let fixture = null;
    if (args.fixture) {
      const mf = path.resolve(String(args.fixture));
      const m = JSON.parse(fs.readFileSync(mf, "utf8"));
      if (m.kind !== "fes-rows-fixture" || m.state !== "committed") throw new Error(`${mf}: not a committed fes-rows fixture manifest (state ${m.state})`);
      if (String(m.eventId) !== EVENT_ID) throw new Error(`${mf} is for event ${m.eventId}`);
      const want = new Set(m.after.rows.map((r) => r.id));
      const extra = rows0.filter((r) => !want.has(r.id));
      if (rows0.length !== m.after.activeRows || extra.length) throw new Error(`event has ${rows0.length} active rows (${extra.length} not in the fixture), fixture expects ${m.after.activeRows} — reconcile first`);
      fixture = { manifest: path.relative(REPO, mf).replace(/\\/g, "/"), label: m.label, clones: m.clones, target: m.target, anchorReserve: m.anchorReserve, activeRows: m.after.activeRows };
      log(`fixture ${m.label}: ${m.clones} clones, ${m.after.activeRows} active rows (+${m.anchorReserve} reserved)`);
    }

    // 4. the one admin login.
    const cookie = await adminLogin(base);
    const token = cookie.slice(ADMIN_COOKIE_NAME.length + 1);

    // 5. the anchor.
    let anchor = null;
    let markers = [];
    if (anchorMode === "create") {
      const enc = await pg.query(`select position from "SetlistItem" where "eventId" = $1 and "isDeleted" = false and "isEncore" = false order by position desc limit 1`, [EVENT_ID]);
      const afterRow = args["after-row"] != null ? parseInt(args["after-row"], 10) : null;
      const afterPosition = afterRow != null ? rows0[afterRow - 1]?.position : enc.rows[0] ? Number(enc.rows[0].position) : 0;
      if (afterPosition == null) throw new Error(`--after-row=${afterRow} is beyond the ${rows0.length} rows`);
      markers = await pickMarkerSongs(pg, nMarkers);
      const r = await insertAfter({ base, cookie, eventId: EVENT_ID, afterPosition });
      anchor = { id: r.id, position: r.position, afterPosition, createdRev: r.rev };
      log(`anchor: row ${r.id} at position ${r.position} (after ${afterPosition}), rev ${r.rev}; markers ${markers.map((m) => m.id).join(",")}`);
    } else if (anchorMode !== "none") {
      throw new Error("--anchor must be create or none (give an existing anchor to k6 with ANCHOR_ID)");
    }
    const ev2 = await pg.query(`select "setlistRevision"::text as rev from "Event" where id = $1`, [EVENT_ID]);
    const rows1 = await activeRows(pg, EVENT_ID);

    const out = {
      kind: "admission-probe",
      version: 1,
      label,
      at: new Date().toISOString(),
      precursorBase: base,
      eventId: EVENT_ID,
      eventSlug: slug,
      status,
      revAtProbe: dbRev,
      rev: Number(ev2.rows[0].rev),
      rows: rows1.length,
      rowsBeforeAnchor: rows0,
      clock: { offsetMs: best.offsetMs, errMs: best.rtt / 2, samples },
      cookieName: ADMIN_COOKIE_NAME,
      // Secret: admin session token (gitignored *.json under results/).
      cookie: token,
      anchor,
      markers,
      fixture,
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    const rel = path.relative(REPO, file).replace(/\\/g, "/");
    log(`probe file: ${rel}  (contains the admin session cookie — never commit/upload)`);
    log("");
    log("next: redeploy (new BUILD_KEY, zero requests to the new deployment), then from the repo root:");
    log(`  ADMISSION=1 PROBE_FILE=${path.resolve(file).replace(/\\/g, "/")} EVENT_ID=${EVENT_ID} EVENT_SLUG=${slug} EXPECTED_ROWS=${rows1.length} \\`);
    log("    BASE_URL=<measurement url> tests/load/run.sh viewers.js");
    log(`after k6: node tests/load/admission-probe.mjs --cleanup=${rel}${fixture ? `   then: node tests/load/fixtures/fes-rows.mjs --cleanup=${fixture.manifest} --publish` : ""}`);
  } finally {
    await pg.end();
  }
}

async function cleanupProbe() {
  const file = path.resolve(String(args.cleanup));
  const p = JSON.parse(fs.readFileSync(file, "utf8"));
  if (p.kind !== "admission-probe") throw new Error(`${file} is not an admission probe file`);
  if (!p.anchor) { log("probe created no anchor — nothing to clean up"); return true; }
  const base = checkBase(args.base || DEV_ALIAS);
  const pg = pgClient();
  await pg.connect();
  try {
    const out = await adminCleanup({ base, cookie: `${p.cookieName}=${p.cookie}`, pg, eventId: p.eventId, created: [p.anchor.id], original: p.rowsBeforeAnchor });
    log(`anchor ${p.anchor.id}: ${out.deleted.length ? "soft-deleted" : "NOT deleted"}; positions ${JSON.stringify(out.restore)}; final rev ${out.finalRev}`);
    const now = await activeRows(pg, p.eventId);
    const want = p.rowsBeforeAnchor.map((r) => `${r.id}@${r.position}`).join(",");
    const got = now.map((r) => `${r.id}@${r.position}`).join(",");
    const ok = out.failed.length === 0 && want === got;
    log(ok ? `PASS: ${now.length} active rows at their pre-anchor positions` : `FAIL: expected [${want.slice(0, 200)}] got [${got.slice(0, 200)}]`);
    return ok;
  } finally {
    await pg.end();
  }
}

try {
  let ok = true;
  if (args.cleanup) ok = await cleanupProbe();
  else await probe();
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exitCode = 1;
}
