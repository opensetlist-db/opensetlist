// n14 qualification step 5 — cold admission (`run.mjs --phase=admission`)
// and the idle-broadcast drill (`run.mjs --drill=idle-broadcast`): the
// pure parts. run.mjs does the I/O (prepare, boundary wait, launches,
// saves, cohorts) and calls these; they live here, free of side effects,
// so admission.test.mjs can pin them without a browser, a database or a
// deployment (run.mjs runs its whole measurement at import time and
// cannot be imported by a test). admission-join.mjs reuses them on the
// harness JSON, so the harness report and the post-hoc join can never
// disagree about what "exposed", "eligible" or "converged" means.
//
// Clocks. Everything here is the LOAD HOST's clock (epoch ms): the SDK
// worker threads, Playwright callbacks and the page's own Date.now() all
// read the same OS clock. The server's commit `at` (a third clock, the
// function's) is never mixed in here — admission-join.mjs reports it as a
// cross-check only. The exposure rule therefore uses the save's PUT
// RESPONSE time on this host as the upper bound of the commit (the server
// commits, then answers), and the PUT START as its lower bound.
import { dist } from "../realtime/lib.mjs";

// ─── flags ───

const flagTrue = (v) => v === true || v === "true" || v === "1";
const isoMs = (v) => {
  if (v === undefined || v === null || v === true) return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : NaN;
};
const secList = (v, name) => {
  if (v === undefined) return { list: null };
  const parts = String(v).split(",").map((x) => x.trim()).filter(Boolean);
  const list = parts.map(Number);
  if (!list.length || list.some((x) => !Number.isFinite(x) || x < 0)) return { error: `--${name} must be a comma-separated list of non-negative seconds` };
  for (let i = 1; i < list.length; i++) if (!(list[i] > list[i - 1])) return { error: `--${name} must be strictly increasing` };
  return { list };
};
const pair = (v, name) => {
  const parts = String(v).split(",").map((x) => Number(x.trim()));
  if (parts.length !== 2 || parts.some((x) => !Number.isInteger(x) || x < 1 || x > 200)) return { error: `--${name} must be "<incumbents>,<fresh>" (1–200 each)` };
  return { value: { incumbents: parts[0], fresh: parts[1] } };
};

const ADMISSION_KEYS = ["admit-at", "admit-file", "admission-saves", "guard-precursor", "rows-manifest", "final-cohort", "exposure-sdk-min", "exposure-pages-min", "expect-live-seed"];
const IDLE_KEYS = ["cohort-incumbents", "cohort-fresh", "connect-at", "first-save-at", "first-save-file", "idle-saves", "wake", "wake-gap", "wake-check-timeout", "max-age"];

// Parse and validate the step-5 flags. `args` = parseArgs() output.
// Returns { cfg } or { error }; run.mjs prints the error and exits 2
// BEFORE anything is created or any request is made.
//
// Refusals and why:
//   - an admission flag without --phase=admission (or an idle flag
//     without --drill=idle-broadcast): it would be silently ignored and
//     the run mistaken for a step-5 run;
//   - --phase=admission without exactly one boundary (--admit-at XOR
//     --admit-file): there is no "start now" — the whole point is that
//     nothing reaches the measurement deployment before the operator's
//     boundary;
//   - --guard-precursor without --deployment-url: the guard exists for a
//     deployment-specific URL only (the dev alias needs no identity
//     proof), and on the alias the prepare requests already go to the
//     precursor through the alias;
//   - idle-broadcast with pages: the drill measures SDK broadcast
//     delivery after idle; a Chromium page would add a second, unaligned
//     population and its own SSR traffic;
//   - idle-broadcast with --phase=admission: two different experiments.
export function parseStep5Flags(args, { phase, drill, deploymentUrl, pages, now = Date.now() }) {
  const admGiven = ADMISSION_KEYS.filter((k) => args[k] !== undefined);
  const idleGiven = IDLE_KEYS.filter((k) => args[k] !== undefined);
  if (phase !== undefined && phase !== null && phase !== "admission") return { error: `unknown --phase=${phase} (only "admission")` };
  const admission = phase === "admission";
  const idle = drill === "idle-broadcast";
  if (!admission && admGiven.length) return { error: `${admGiven.map((k) => `--${k}`).join(", ")} need(s) --phase=admission` };
  if (!idle && idleGiven.length) return { error: `${idleGiven.map((k) => `--${k}`).join(", ")} need(s) --drill=idle-broadcast` };
  if (admission && idle) return { error: "--drill=idle-broadcast is its own experiment; do not combine it with --phase=admission (use --final-cohort for the I3 control)" };
  if (admission && drill) return { error: `--phase=admission runs no drill (got --drill=${drill})` };
  const out = { admission: null, idle: null };

  if (admission) {
    const at = isoMs(args["admit-at"]);
    const file = args["admit-file"] === undefined || args["admit-file"] === true ? null : String(args["admit-file"]);
    if ((at == null) === (file == null)) return { error: "--phase=admission needs exactly one boundary: --admit-at=<ISO UTC> or --admit-file=<path>" };
    if (Number.isNaN(at)) return { error: "--admit-at must be an ISO timestamp (UTC), e.g. 2026-10-12T05:30:00Z" };
    if (at != null && at <= now) return { error: "--admit-at is in the past" };
    const saves = secList(args["admission-saves"] ?? "5,20,45", "admission-saves");
    if (saves.error) return { error: saves.error };
    const precursor = args["guard-precursor"] === undefined ? null : String(args["guard-precursor"]).replace(/\/$/, "");
    if (precursor && !deploymentUrl) return { error: "--guard-precursor needs --deployment-url (the identity guard only exists for deployment-specific URLs)" };
    let finalCohort = null;
    if (args["final-cohort"] !== undefined) {
      const p = pair(args["final-cohort"], "final-cohort");
      if (p.error) return { error: p.error };
      finalCohort = p.value;
    }
    const intOf = (k, d) => {
      if (args[k] === undefined) return d;
      const v = Number(args[k]);
      return Number.isInteger(v) && v >= 0 ? v : NaN;
    };
    const sdkMin = intOf("exposure-sdk-min", 100);
    const pagesMin = intOf("exposure-pages-min", 5);
    if (Number.isNaN(sdkMin) || Number.isNaN(pagesMin)) return { error: "--exposure-sdk-min / --exposure-pages-min must be non-negative integers" };
    out.admission = {
      admitAt: at, admitFile: file, savesS: saves.list, precursor, rowsManifest: args["rows-manifest"] ? String(args["rows-manifest"]) : null,
      finalCohort, sdkMin, pagesMin,
      // The SSR seed must be live (the event must be ongoing): a page
      // without it took the degraded path. --expect-live-seed=false only
      // for a deliberately non-live event (then the seed is not judged).
      expectLiveSeed: args["expect-live-seed"] === undefined ? true : flagTrue(args["expect-live-seed"]),
    };
  }

  if (idle) {
    if (pages > 0) return { error: "--drill=idle-broadcast needs --pages=0 (SDK cohorts only)" };
    const n = (k, d, lo, hi) => {
      const v = args[k] === undefined ? d : Number(args[k]);
      return Number.isInteger(v) && v >= lo && v <= hi ? v : NaN;
    };
    const incumbents = n("cohort-incumbents", 20, 1, 200);
    const fresh = n("cohort-fresh", 20, 0, 200);
    const maxAge = n("max-age", 90, 7, 3600);
    const wakeGap = n("wake-gap", 600, 10, 3600);
    const wakeCheck = n("wake-check-timeout", 10, 1, 120);
    if ([incumbents, fresh, maxAge, wakeGap, wakeCheck].some(Number.isNaN)) return { error: "--cohort-incumbents (1–200), --cohort-fresh (0–200), --max-age (7–3600 s), --wake-gap (10–3600 s), --wake-check-timeout (1–120 s) must be integers in range" };
    const connectAt = isoMs(args["connect-at"]);
    const firstSaveAt = isoMs(args["first-save-at"]);
    // --first-save-file: the operator learns the observer's readiness only
    // AFTER the connect instant, so the first save can also be released
    // at run time: the harness waits for the file; its content is the
    // ISO instant of the first save (readiness + 6 s), or empty = 6 s
    // after the file appeared. Exactly one of the two.
    const firstSaveFile = args["first-save-file"] === undefined || args["first-save-file"] === true ? null : String(args["first-save-file"]);
    if (connectAt == null || Number.isNaN(connectAt)) return { error: "--drill=idle-broadcast needs --connect-at=<ISO UTC> (when every local client connects)" };
    if ((firstSaveAt == null) === (firstSaveFile == null)) return { error: "--drill=idle-broadcast needs exactly one of --first-save-at=<ISO UTC> (= observer readiness + 6 s) or --first-save-file=<path>" };
    if (Number.isNaN(firstSaveAt)) return { error: "--first-save-at must be an ISO timestamp (UTC)" };
    if (connectAt <= now) return { error: "--connect-at is in the past" };
    if (firstSaveAt != null && firstSaveAt - connectAt < 6000) return { error: "--first-save-at must be ≥ 6 s after --connect-at (the clients must be ≥ 6 s old at the save)" };
    if (firstSaveAt != null && firstSaveAt - connectAt > maxAge * 1000) return { error: `--first-save-at is more than --max-age (${maxAge} s) after --connect-at: no client could be eligible` };
    const saves = secList(args["idle-saves"] ?? "40,100", "idle-saves");
    if (saves.error) return { error: saves.error };
    if (saves.list[0] < 40) return { error: "the first save must be followed by ≥ 40 s of quiet: --idle-saves must start at ≥ 40" };
    const wake = flagTrue(args.wake);
    if (!wake && args["cohort-fresh"] !== undefined) return { error: "--cohort-fresh is only used by --wake (I2); I1 connects --cohort-incumbents clients only" };
    out.idle = { incumbents, fresh: wake ? fresh : 0, connectAt, firstSaveAt, firstSaveFile, savesS: saves.list, wake, wakeGapS: wakeGap, wakeCheckS: wakeCheck, maxAgeS: maxAge };
  }
  return { cfg: out };
}

// The admit file: written by the operator script once the redeploy has
// finished and the alias switched. Its CONTENT may name the measurement
// deployment (needed with --deployment-url, whose new hash is only known
// after the redeploy) and carry the precursor → measurement binding the
// run record keeps:
//   { "base": "https://opensetlist-<hash>-opensetlist-projects.vercel.app",
//     "measurementId": "dpl_…", "precursorId": "dpl_…", "inspect": "<vercel inspect output>" }
// An empty file (plain `touch`) or non-JSON text is accepted: then only
// the file's appearance is the boundary.
// The --first-save-file content → the first save's instant: an ISO
// instant, or (empty / unparsable) `seenAt` + 6 s.
export function firstSaveFromFile(text, seenAt) {
  const t = Date.parse(String(text ?? "").trim());
  return Number.isFinite(t) ? t : seenAt + 6000;
}

export function parseAdmitFile(text) {
  // A BOM (PowerShell 5.1 `Out-File -Encoding utf8` writes one) would
  // make JSON.parse fail and the binding vanish into `raw`.
  const t = String(text ?? "").replace(/^﻿/, "").trim();
  if (!t) return { raw: "" };
  try {
    const j = JSON.parse(t);
    if (j && typeof j === "object" && !Array.isArray(j)) return { raw: t.slice(0, 4000), ...j };
  } catch { /* plain text */ }
  return { raw: t.slice(0, 4000) };
}

// Fixture rows (tests/load/fixtures/fes-rows.mjs manifest, optional): the
// harness only needs to know WHICH active rows are synthetic clones, to
// mark them in the run manifest (they are already in the database, so
// the DB read above has their content). Accepted shapes, tolerant on
// purpose so the two scripts can evolve separately: `clones: [{ id }]`,
// `createdIds: [id]`, `created: [{ id } | id]`, or `items` / `rows`
// entries flagged `clone: true` / `fixture: true`.
export function fixtureIdsOf(j) {
  const ids = new Set();
  const take = (x) => { if (x != null && (typeof x === "string" || typeof x === "number")) ids.add(String(x)); else if (x && x.id != null) ids.add(String(x.id)); };
  for (const k of ["clones", "createdIds", "created", "cloneIds"]) if (Array.isArray(j?.[k])) j[k].forEach(take);
  for (const k of ["items", "rows"]) if (Array.isArray(j?.[k])) for (const x of j[k]) if (x && (x.clone === true || x.fixture === true)) take(x);
  return ids;
}

// ─── run manifest: expected rendered rows ───

// The rows the live page must render, in DOM order, from the run
// manifest (DB rows: { id, position, isEncore, songs: [{ songId, order }] }).
// <ActualSetlist> renders the non-encore rows by position, then the
// encore rows by position (two <ol>s); inside a row <SetlistRow> renders
// one song link per SetlistItemSong in `order` (a medley = several
// links), and NO link for a blank / non-song row. So the expected
// signature of row i is its ordered song-id list, and the rows compare
// by ORDER and MULTIPLICITY (a fixture clones rows with the same songs —
// a set comparison would pass with only the originals rendered).
//
// `alternatives`: rowId → list of accepted signatures besides the DB
// state at manifest time — the anchor row, whose song changes with every
// admission save ("" blank, then marker 1, 2, …): a page that loads
// after a save legitimately shows the newer marker.
export function expectedRows(manifestRows, alternatives = {}) {
  const sorted = [...manifestRows].sort((a, b) => (a.isEncore === b.isEncore ? a.position - b.position : a.isEncore ? 1 : -1));
  return sorted.map((r) => {
    const sig = [...(r.songs || [])].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity)).map((s) => String(s.songId)).join("+");
    const alts = alternatives[String(r.id)] || [];
    return { id: String(r.id), accept: [...new Set([sig, ...alts.map(String)])] };
  });
}

// Compare one rendered signature list (["123", "45+46", "", …], DOM
// order) with the expected rows. Returns { matched, total, complete }:
// matched = positions whose signature is accepted (index-wise — a missing
// or extra row shifts every later one and is meant to); complete = every
// row matched AND no extra row rendered.
export function matchRows(rendered, expected) {
  const total = expected.length;
  let matched = 0;
  for (let i = 0; i < Math.min(rendered.length, total); i++) if (expected[i].accept.includes(rendered[i])) matched++;
  return { matched, total, complete: matched === total && rendered.length === total };
}

// First time a page's row log ([t, signatures[]], in order) showed the
// complete expected setlist, before `until` (the first post-admission
// edit: after it the expected rows change). Also the best partial match
// (for "ordered rows matched n/m").
export function completeAt(rowsLog, expected, until = Infinity) {
  let best = { matched: 0, total: expected.length, complete: false };
  for (const [t, sigs] of rowsLog || []) {
    if (t >= until) break;
    const m = matchRows(sigs, expected);
    if (m.matched > best.matched || m.complete) best = m;
    if (m.complete) return { t, ...m };
  }
  return { t: null, ...best };
}

// ─── SDK connection timelines ───

// The client's connection transitions [[t, up 1|0, status]]. Records
// from subs-worker.mjs carry `connLog`; an older record is rebuilt from
// its SUBSCRIBED times and its disconnected episodes (`fallbacks`).
export function connOf(rec) {
  if (Array.isArray(rec.connLog)) return rec.connLog;
  const ev = [
    ...(rec.subscribedAt || []).map((t) => [t, 1, "SUBSCRIBED"]),
    ...(rec.fallbacks || []).map(([t, s]) => [t, 0, s]),
  ];
  return ev.sort((a, b) => a[0] - b[0]);
}

// Up at instant t: the last transition at or before t was "up".
export function connectedAt(conn, t) {
  let up = false;
  for (const [x, u] of conn) {
    if (x > t) break;
    up = u === 1;
  }
  return up;
}

// Up at `a` and no "down" transition in (a, b].
export function connectedThrough(conn, a, b) {
  if (!connectedAt(conn, a)) return false;
  return !conn.some(([x, u]) => x > a && x <= b && u !== 1);
}

// When the CURRENT connection at t began (the last up transition ≤ t),
// null when not connected at t.
export function upSince(conn, t) {
  let since = null;
  for (const [x, u] of conn) {
    if (x > t) break;
    since = u === 1 ? (since ?? x) : null;
  }
  return since;
}

export const firstSub = (rec) => (rec.subscribedAt && rec.subscribedAt.length ? rec.subscribedAt[0] : null);

// ─── exposure (design §1.3) ───

// SDK exposure of one save: at the save (PUT start → PUT response on this
// host), how many clients were SUBSCRIBED and stayed connected through
// it, and how many had NOT subscribed yet (they join afterwards — their
// first read and their convergence are the admission case). Clients that
// had subscribed but were disconnected during the save are counted apart
// (neither). Clients stopped before the save (I3 retirement) are out.
export function sdkExposure(sdk, save, { min = 100 } = {}) {
  let connected = 0, notYet = 0, disconnected = 0, stopped = 0;
  for (const c of sdk) {
    if (c.stoppedAt != null && c.stoppedAt <= save.putStart) { stopped++; continue; }
    const conn = connOf(c);
    const fs = firstSub(c);
    if (connectedThrough(conn, save.putStart, save.putEnd)) connected++;
    else if (fs == null || fs > save.putEnd) notYet++;
    else disconnected++;
  }
  return { connected, notYet, disconnected, stopped, total: sdk.length - stopped, min, exposed: connected >= min && notYet >= min };
}

// Page exposure of one save (separate from SDK, design §1.3): pages whose
// navigation had started by the PUT start and whose complete setlist came
// LATER than the PUT start (still loading / hydrating while the save
// committed). Pages not launched yet are future arrivals; pages complete
// before the save are "settled".
export function pageExposure(pages, save, { min = 5 } = {}) {
  let inflight = 0, future = 0, settled = 0;
  for (const p of pages) {
    if (p.navStart == null || p.navStart > save.putStart) future++;
    else if (p.completeAt == null || p.completeAt > save.putStart) inflight++;
    else settled++;
  }
  return { inflight, future, settled, total: pages.length, min, exposed: inflight >= min };
}

export function exposureLabel(sdkX, pageX) {
  if (sdkX.exposed && pageX.exposed) return "SDK + page admission save";
  if (sdkX.exposed) return "SDK admission save";
  if (pageX.exposed) return "page admission save";
  return "after admission";
}

// ─── convergence (design §1.4) ───

// First applied snapshot with rev ≥ R: [t, rev, reason, capturedAt] or null.
export const firstApplied = (appliedAll, rev) => (appliedAll || []).find((a) => a[1] >= rev) ?? null;

// Per save, SDK clients split by when they joined:
//   joined-before = first SUBSCRIBED ≤ PUT start; clock = PUT start;
//   joined-after  = first SUBSCRIBED later; clock = max(subscribedAt, PUT
//                   response) — a client cannot be asked to know a save
//                   before it exists for it; an apply before that clock
//                   (its first read already carried the save) counts 0;
//   not joined    = never SUBSCRIBED: listed apart (the join gate fails).
// Missing = no apply with rev ≥ R within `timeoutMs` of the clock.
// Clients stopped before the save are out of its population.
export function sdkConvergence(sdk, save, { timeoutMs }) {
  const before = { lat: [], missing: 0, missingIdx: [] };
  const after = { lat: [], missing: 0, missingIdx: [] };
  let notJoined = 0;
  for (const c of sdk) {
    if (c.stoppedAt != null && c.stoppedAt <= save.putStart) continue;
    const fs = firstSub(c);
    if (fs == null) { notJoined++; continue; }
    const isBefore = fs <= save.putStart;
    const clock = isBefore ? save.putStart : Math.max(fs, save.putEnd);
    const a = firstApplied(c.applied, save.rev);
    const b = isBefore ? before : after;
    if (a && a[0] <= clock + timeoutMs) b.lat.push(Math.max(0, a[0] - clock));
    else { b.missing++; if (b.missingIdx.length < 20) b.missingIdx.push(c.idx); }
  }
  // `values` = the raw latencies, so a run can pool them across saves.
  return {
    before: { ...dist(before.lat), values: before.lat, missing: before.missing, missingIdx: before.missingIdx },
    after: { ...dist(after.lat), values: after.lat, missing: after.missing, missingIdx: after.missingIdx },
    notJoined,
  };
}

// Marker → the time a page showed this save's state: the save's marker or
// any LATER marker on the same row (a later save on the anchor replaces
// it — "marker checks follow the returned revision").
export function pageSeenFor(seen, save, replacedBy) {
  let t = seen[String(save.songId)] ?? null;
  for (const id of replacedBy?.get(String(save.songId)) || []) {
    const x = seen[id];
    if (x != null && (t == null || x < t)) t = x;
  }
  return t;
}

// Same split for pages, by the page's channel join (the R2 hook's
// SUBSCRIBED = its first `phx_reply` ok for the event topic):
// joined-before = joined ≤ PUT start (clock PUT start); joined-after =
// clock max(join, PUT response); a page whose SSR already carried the
// marker counts 0. A page that never joined but shows the marker is
// counted converged at max(0, seen − clock) with clock = PUT response.
export function pageConvergence(pages, save, { timeoutMs, replacedBy }) {
  const before = { lat: [], missing: 0 };
  const after = { lat: [], missing: 0 };
  for (const p of pages) {
    const j = p.joinAt && p.joinAt.length ? p.joinAt[0] : null;
    const isBefore = j != null && j <= save.putStart;
    const clock = isBefore ? save.putStart : Math.max(j ?? save.putEnd, save.putEnd);
    const seen = pageSeenFor(p.seen || {}, save, replacedBy);
    const b = isBefore ? before : after;
    if (seen != null && seen <= clock + timeoutMs) b.lat.push(Math.max(0, seen - clock));
    else b.missing++;
  }
  return { before: { ...dist(before.lat), values: before.lat, missing: before.missing }, after: { ...dist(after.lat), values: after.lat, missing: after.missing } };
}

// Stale first answers (design §1.4, RECORDED, not inferred and not a gate
// by itself): a client whose FIRST read started after the save's PUT
// response, yet whose first answer carried a lower revision. The
// candidate guarantees consistent snapshots and monotonic acceptance —
// not that every post-commit initial read sees the head (a generic read
// can join an older in-flight build, and the commit precedes the route's
// invalidation).
//   SDK: the client's first request (its `initial` fetch);
//   pages: the SSR seed (`initialRev` in the HTML) — the page's first
//          answer — for pages whose navigation started after the PUT
//          response; a page without a live seed is judged by its first
//          /api/setlist response instead.
export function staleFirstAnswers(sdk, pages, save) {
  const s = { eligible: 0, stale: 0, unknown: 0, staleRevs: {} };
  for (const c of sdk) {
    const q = c.first;
    if (!q || q.reqStart == null || q.reqStart <= save.putEnd) continue;
    s.eligible++;
    if (q.rev == null) s.unknown++;
    else if (q.rev < save.rev) { s.stale++; s.staleRevs[q.rev] = (s.staleRevs[q.rev] || 0) + 1; }
  }
  const p = { eligible: 0, stale: 0, unknown: 0, staleRevs: {} };
  for (const pg of pages) {
    if (pg.navStart == null || pg.navStart <= save.putEnd) continue;
    p.eligible++;
    const rev = pg.seed?.rev ?? pg.firstFetch?.rev ?? null;
    if (rev == null) p.unknown++;
    else if (rev < save.rev) { p.stale++; p.staleRevs[rev] = (p.staleRevs[rev] || 0) + 1; }
  }
  return { sdk: s, pages: p };
}

// Raw broadcast receipt of THIS save's rev vs the fetch that applied it
// (design §1.4: reported separately — a client can apply a save through a
// periodic or catch-up fetch without ever receiving its broadcast).
export function receiptVsReason(sdk, save) {
  let received = 0, population = 0;
  const reasons = {};
  const receivedReasons = {};
  for (const c of sdk) {
    if (c.stoppedAt != null && c.stoppedAt <= save.putStart) continue;
    population++;
    const got = (c.bcasts || []).some(([, rev, w]) => rev === save.rev && w !== "x");
    if (got) received++;
    const a = firstApplied(c.applied, save.rev);
    const k = a ? a[2] : "never";
    reasons[k] = (reasons[k] || 0) + 1;
    if (got) receivedReasons[k] = (receivedReasons[k] || 0) + 1;
  }
  return { population, received, reasons, receivedReasons };
}

// ─── the admission verdict ───

// Gate rows → verdict vocabulary (design §0): INVALID (host) outranks
// everything; then each aspect needs its exposure (no SDK-admission save
// → the SDK aspect is NOT EXERCISED; same for pages); a run with neither
// is NOT EXERCISED as a whole; otherwise VALID + PASS / VALID + FAIL on
// the gates (pass === false fails; null = n/a).
export function admissionVerdict({ invalid, sdkExercised, pageExercised, gates }) {
  if (invalid) return { verdict: "INVALID", sdk: "INVALID", page: "INVALID" };
  const failed = gates.filter((g) => g.pass === false);
  const base = failed.length ? "VALID + FAIL" : "VALID + PASS";
  const sdk = sdkExercised ? base : "NOT EXERCISED";
  const page = pageExercised ? base : "NOT EXERCISED";
  const verdict = !sdkExercised && !pageExercised ? "NOT EXERCISED" : base;
  return { verdict, sdk, page, failed: failed.map((g) => g.name) };
}

// ─── idle-broadcast eligibility (design §1.5) ───

// A client is eligible for save S when it was connected for at least 6 s
// and at most `maxAgeS` at the save, without interruption, through the
// PUT response: the "first save shortly after join" condition, not a
// longer readiness period. `since` = when its current connection began.
// Cohort start spread = max − min of the clients' first SUBSCRIBED (the
// cohort must have joined together, ≤ 30 s).
export function idleEligibility(clients, save, { maxAgeS = 90, minAgeS = 6, spreadMaxS = 30 } = {}) {
  const per = clients.map((c) => {
    const conn = connOf(c);
    const since = upSince(conn, save.putStart);
    const through = connectedThrough(conn, save.putStart, save.putEnd);
    const ageS = since == null ? null : (save.putStart - since) / 1000;
    const why = since == null ? "not connected at the save"
      : !through ? "disconnected during the save"
        : ageS < minAgeS ? `connected only ${ageS.toFixed(1)} s before the save (< ${minAgeS} s)`
          : ageS > maxAgeS ? `connected ${ageS.toFixed(1)} s before the save (> --max-age ${maxAgeS} s)`
            : null;
    return { idx: c.idx, cohort: c.cohort ?? null, since, ageS, eligible: why === null, why };
  });
  const subs = clients.map(firstSub).filter((t) => t != null);
  const spreadS = subs.length ? (Math.max(...subs) - Math.min(...subs)) / 1000 : null;
  const spreadOk = spreadS != null && spreadS <= spreadMaxS;
  const eligible = per.filter((p) => p.eligible).length;
  // Predeclared: EVERY client of the cohort eligible and the cohort
  // joined together. Anything else is a different experiment (a longer
  // readiness period, a reconnect) and is NOT EXERCISED, never silently
  // reported as this one.
  const exercised = clients.length > 0 && eligible === clients.length && spreadOk;
  return { per, eligible, total: clients.length, spreadS, spreadOk, exercised };
}

// Per client, per save: raw broadcast receipt (ms after the PUT response;
// null = never), the reason of the fetch that applied the save, and the
// repair time (apply − PUT start) when it was NOT applied by its own
// notification. Healthy repair is the periodic poll, 20 s ± 4 s — a
// measured value, never a bound.
//
// Population: clients that existed and had subscribed by the save's PUT
// response and were not stopped before it — a client created (or first
// SUBSCRIBED) after the save would otherwise show up as a "repair" that
// is really its own join.
// `clockMarginMs`: how far BEFORE the save's PUT start a receipt may be
// stamped and still count as this save's broadcast. 50 ms for clients on
// the harness host (one clock); the join passes a larger margin for the
// observer's clients, whose runner clock is only NTP-close to this one.
export function idleArrivals(clients, save, { timeoutMs = 60000, clockMarginMs = 50 } = {}) {
  const inPop = (c) => {
    if (c.stoppedAt != null && c.stoppedAt <= save.putStart) return false;
    if (c.attemptAt != null && c.attemptAt > save.putEnd) return false;
    const fs = firstSub(c);
    return !(fs != null && fs > save.putEnd);
  };
  return clients.filter(inPop).map((c) => {
    const b = (c.bcasts || []).find(([t, rev, w]) => rev === save.rev && w !== "x" && t >= save.putStart - clockMarginMs);
    const a = firstApplied(c.applied, save.rev);
    const applied = a && a[0] <= save.putStart + timeoutMs ? a : null;
    return {
      idx: c.idx, cohort: c.cohort ?? null,
      bcastMs: b ? b[0] - save.putEnd : null,
      reason: applied ? applied[2] : "never",
      applyMs: applied ? applied[0] - save.putStart : null,
      repairMs: applied && !b ? applied[0] - save.putStart : null,
    };
  });
}

export const summarizeArrivals = (rows) => ({
  n: rows.length,
  received: rows.filter((r) => r.bcastMs != null).length,
  applied: rows.filter((r) => r.reason !== "never").length,
  reasons: rows.reduce((a, r) => ((a[r.reason] = (a[r.reason] || 0) + 1), a), {}),
  bcast: dist(rows.map((r) => r.bcastMs).filter((v) => v != null)),
  repair: dist(rows.map((r) => r.repairMs).filter((v) => v != null)),
});
