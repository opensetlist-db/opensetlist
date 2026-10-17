// `--drill=overlap` (n14 qualification step 4): the pure parts — flag
// parsing and refusal rules, the per-group gate anchoring, the SDK
// (rev, capturedAt) monotonicity, the page-side stall SUSPECT rule and
// the reaction ack-hold verdict. run.mjs does the I/O (saves, reloads,
// probes, the page reaction) and calls these; they are kept here, free
// of side effects, so overlap.test.mjs can pin them without a browser,
// a database or a deployment (run.mjs runs its whole measurement at
// import time and cannot be imported by a test).
//
// The drill, in one paragraph: every edit "group" fires two (or three)
// admin PUTs on three distinct anchor rows WITHOUT awaiting each other —
// save A at 0, save B `--overlap-gap` ms after A's START, optionally save
// C at `--overlap-third-at` — so their warm jobs genuinely overlap on the
// server. A group converges when a viewer shows the group's HEAD (the
// highest committed rev); intermediate revs may legitimately be skipped
// by batch merging. Whether the intended race actually happened is only
// provable from the server's log timestamps (overlap-join.mjs); this
// module judges the client side.
import { dist } from "../realtime/lib.mjs";

// The job-side fault modes the server accepts in `x-live-warm-fault`
// (src/lib/liveWarm.ts `requestWarmFault`). Lookup-side modes (absent,
// slow, getnull, geterror) are refused by the server with a 400 because a
// header on ONE save cannot sensibly change how every reader looks up;
// the harness refuses them up front so a typo does not turn into a run
// whose A saves all failed.
export const JOB_FAULT_MODES = { slowjob: "ms", slowset: "ms", slowbuild: "ms", seterror: null, setskip: null, locale: "locale" };
// The server's caps (`FAULT_MAX_DELAY_MS` = 10 s for the plain delays,
// `SLOWBUILD_MAX_MS` = 5 s because the hold sits inside the builder's
// 10 s transaction). A value above them parses here but the server
// answers 400 — for EVERY A save of the run, after the population has
// joined — so the drill refuses them up front like any other bad spec.
export const JOB_FAULT_MAX_MS = { slowjob: 10_000, slowset: 10_000, slowbuild: 5_000 };
const FAULT_LOCALES = new Set(["ko", "ja", "en"]);

// Validates a `--overlap-fault-a` spec in the server's own grammar
// (comma-separated `mode[=value]`). Returns null when acceptable, else a
// human-readable reason. The server stays the authority (it re-parses and
// answers 400 on anything it dislikes); this only catches the obvious.
export function faultSpecProblem(spec) {
  if (typeof spec !== "string" || !spec.trim()) return "empty spec";
  if (/\s/.test(spec)) return "whitespace in spec";
  for (const tok of spec.split(",")) {
    const [mode, value, extra] = tok.split("=");
    if (extra !== undefined) return `malformed token "${tok}"`;
    if (!(mode in JOB_FAULT_MODES)) return `mode "${mode}" is not a job-side mode (allowed: ${Object.keys(JOB_FAULT_MODES).join(", ")})`;
    const kind = JOB_FAULT_MODES[mode];
    if (kind === null && value !== undefined) return `mode "${mode}" takes no value`;
    if (kind === "ms" && !(value !== undefined && /^\d+$/.test(value) && Number(value) >= 1)) return `mode "${mode}" needs a positive integer ms value`;
    if (kind === "ms" && Number(value) > JOB_FAULT_MAX_MS[mode]) return `mode "${mode}" is capped at ${JOB_FAULT_MAX_MS[mode]} ms by the server; a larger value would turn every A save into a 400`;
    if (kind === "locale" && !FAULT_LOCALES.has(value)) return `mode "locale" needs ko|ja|en`;
  }
  return null;
}

const OVERLAP_KEYS = [
  "overlap-gap", "overlap-third-at", "overlap-fault-a", "overlap-reload-at", "overlap-catalog-at",
  "overlap-reactions", "overlap-page-reaction", "overlap-probes", "overlap-quiet-tail",
];

const flagTrue = (v) => v === true || v === "true" || v === "1";

// Parse and validate the overlap flags. `args` = parseArgs() output.
// Returns { cfg } or { error } (run.mjs prints the error and exits 2,
// before anything is created).
//
// Refusals and why:
//   - any --overlap-* flag without --drill=overlap: it would be silently
//     ignored and the run mistaken for an overlap run;
//   - --overlap-fault-a without --deployment-url: the shared dev alias is
//     never armed (LIVE_WARM_FAULT_ARMED is a per-deployment env), so the
//     server would ignore the header and the scenario would not be
//     exercised while the run looked like it had been;
//   - a fault spec outside the job-side grammar (see faultSpecProblem).
export function parseOverlapFlags(args, { drill, deploymentUrl }) {
  const given = OVERLAP_KEYS.filter((k) => args[k] !== undefined);
  if (drill !== "overlap") {
    return given.length ? { error: `${given.map((k) => `--${k}`).join(", ")} need(s) --drill=overlap` } : { cfg: null };
  }
  const intOf = (k, d, { min = 0 } = {}) => {
    if (args[k] === undefined) return d;
    const s = String(args[k]);
    if (!/^\d+$/.test(s) || Number(s) < min) throw new Error(`--${k} must be an integer ≥ ${min}, got ${args[k]}`);
    return Number(s);
  };
  try {
    const gapMs = intOf("overlap-gap", 250);
    const thirdAtMs = intOf("overlap-third-at", 0);
    if (thirdAtMs > 0 && thirdAtMs <= gapMs) throw new Error(`--overlap-third-at (${thirdAtMs}) must be later than --overlap-gap (${gapMs}) so the saves start in the order A, B, C`);
    let faultA = null;
    if (args["overlap-fault-a"] !== undefined) {
      if (args["overlap-fault-a"] === true) throw new Error("--overlap-fault-a needs a value, e.g. --overlap-fault-a=slowset=1500");
      faultA = String(args["overlap-fault-a"]);
      if (!deploymentUrl) {
        throw new Error("refusing: --overlap-fault-a needs --deployment-url (the dev alias is never armed: the header would be ignored and the scenario not exercised)");
      }
      const p = faultSpecProblem(faultA);
      if (p) throw new Error(`--overlap-fault-a=${faultA}: ${p}`);
    }
    let reloadAt = [];
    if (args["overlap-reload-at"] !== undefined) {
      const raw = args["overlap-reload-at"] === true ? "" : String(args["overlap-reload-at"]);
      reloadAt = raw.split(",").filter((x) => x !== "").map((x) => {
        if (!/^\d+$/.test(x)) throw new Error(`--overlap-reload-at must be a comma list of ms offsets, got ${raw}`);
        return Number(x);
      });
      if (!reloadAt.length) throw new Error("--overlap-reload-at needs at least one offset");
    }
    const catalogAtMs = intOf("overlap-catalog-at", 0);
    const reactions = intOf("overlap-reactions", 0);
    const pageReaction = args["overlap-page-reaction"] === undefined ? false : flagTrue(args["overlap-page-reaction"]);
    if (args["overlap-page-reaction"] !== undefined && !pageReaction && !["0", "false"].includes(String(args["overlap-page-reaction"]))) {
      throw new Error(`--overlap-page-reaction must be 0|1, got ${args["overlap-page-reaction"]}`);
    }
    const probes = args["overlap-probes"] === undefined ? true : flagTrue(args["overlap-probes"]);
    const quietTailS = args["overlap-quiet-tail"] === undefined ? 0 : Number(args["overlap-quiet-tail"]);
    if (!(Number.isFinite(quietTailS) && quietTailS >= 0)) throw new Error(`--overlap-quiet-tail must be seconds ≥ 0, got ${args["overlap-quiet-tail"]}`);
    return { cfg: { gapMs, thirdAtMs, faultA, reloadAt, catalogAtMs, reactions, pageReaction, probes, quietTailS } };
  } catch (e) {
    return { error: e.message };
  }
}

// Roles of the saves in one group, in start order.
export const rolesOf = (cfg) => (cfg.thirdAtMs > 0 ? ["A", "B", "C"] : ["A", "B"]);

export const isOkSave = (s) => s && s.status >= 200 && s.status < 300 && Number.isSafeInteger(s.rev);

// Gate anchoring for one group (design §0 / §2.6). `saves` = every
// INTENDED save of the group, failed ones included: [{ who, startedAt,
// ms, status, rev }].
//   head       the highest committed rev — what every viewer must reach;
//              the commit order is decided by the Event row lock, not by
//              the start order, so it is NOT necessarily the last save's;
//   lastStart  the chronologically last ORIGINAL request start among the
//              intended saves — the gate's clock: the operator's last
//              click; a viewer cannot be expected to show the head before
//              the save that produced it was even sent;
//   firstStart the first save's start — the informational clock;
//   lastResponse  the last response's arrival — the probes' clock;
//   committed  [{ who, rev }] ascending by rev; older = all but the head.
export function groupAnchor(saves) {
  const ok = saves.filter(isOkSave);
  const starts = saves.map((s) => s.startedAt).filter(Number.isFinite);
  const ends = saves.filter((s) => Number.isFinite(s.startedAt) && Number.isFinite(s.ms)).map((s) => s.startedAt + s.ms);
  const committed = ok.map((s) => ({ who: s.who, rev: s.rev })).sort((a, b) => a.rev - b.rev);
  const head = committed.length ? committed[committed.length - 1].rev : null;
  return {
    head,
    headWho: committed.length ? committed[committed.length - 1].who : null,
    lastStart: starts.length ? Math.max(...starts) : null,
    firstStart: starts.length ? Math.min(...starts) : null,
    lastResponse: ends.length ? Math.max(...ends) : null,
    allOk: saves.length > 0 && ok.length === saves.length,
    committed,
    older: committed.slice(0, -1),
  };
}

// Page convergence for one group: the DOM shows every committed save's
// marker of the group (they sit on distinct anchor rows, so the final
// state shows all of them). Latency = the LAST marker's first appearance
// − `from`. Markers are group-specific songs, so a first appearance is
// this group's. Returns { ok, lat, latFirst } (lat null when missing).
export function pageGroupConvergence(seen, markerIds, { from, firstStart, deadline }) {
  if (!markerIds.length) return { ok: false, lat: null, latFirst: null, missing: [] };
  const ts = markerIds.map((id) => seen?.[id] ?? null);
  const missing = markerIds.filter((_, i) => ts[i] == null || ts[i] > deadline);
  if (missing.length) return { ok: false, lat: null, latFirst: null, missing };
  const t = Math.max(...ts);
  return { ok: true, lat: t - from, latFirst: firstStart == null ? null : t - firstStart, missing: [] };
}

// SDK convergence for one group: the first applied snapshot with rev ≥
// the head. `applied` rows = [t, rev, …] in order.
export function sdkGroupConvergence(applied, head, { from, firstStart, deadline }) {
  const a = (applied || []).find((x) => x[1] >= head);
  if (!a || a[0] > deadline) return { ok: false, lat: null, latFirst: null };
  return { ok: true, lat: a[0] - from, latFirst: firstStart == null ? null : a[0] - firstStart };
}

// SDK monotonicity by (rev, capturedAt) — the acceptance rule's own
// order. `appliedAll` rows = [t, rev, reason, capturedAtMs | null]. A
// regression is an applied snapshot that is older than one applied
// before it: a lower rev, or the same rev with an earlier capturedAt (a
// re-application of an older read of the same revision — e.g. a warm
// entry captured before a reaction landed replacing a newer read). Rows
// without capturedAt (an older server) compare by rev only.
export function subMonotonicityRC(appliedAll) {
  let maxRev = -Infinity;
  let maxCap = null;
  const regressions = [];
  for (const [t, rev, reason, cap] of appliedAll || []) {
    if (rev < maxRev) regressions.push({ t, what: `applied rev ${rev} after ${maxRev} (${reason})` });
    else if (rev === maxRev && cap != null && maxCap != null && cap < maxCap) {
      regressions.push({ t, what: `applied rev ${rev} capturedAt ${new Date(cap).toISOString()} after ${new Date(maxCap).toISOString()} (${reason})` });
    }
    if (rev > maxRev) { maxRev = rev; maxCap = cap ?? null; }
    else if (rev === maxRev && cap != null && (maxCap == null || cap > maxCap)) maxCap = cap;
  }
  return { regressions };
}

// Page-side browser stall (step 3's follow-up, made a SUSPECT flag, not
// INVALID): one save's hinted fetches come back from `warm` or `cache` on
// ≥ 80 % of the pages, yet EVERY one of those takes > 1 s. A warm or
// cache answer costs the server tens of ms, so 30 pages waiting > 1 s for
// it in lock-step points at the single Chromium process, which the
// Node-thread validity monitors do not watch. It is a suspicion, decided
// afterwards by host telemetry and independent evidence (observer, SDK
// clients on the same save) — never an automatic INVALID, and the exit
// code is unchanged. `firsts` = editStats' pages.hint.first rows [idx,
// locale, requestStart − commit, response − commit, source, …].
export function pageStallSuspect(firsts, pagesTotal, { share = 0.8, slowMs = 1000, minPages = 3 } = {}) {
  const hits = (firsts || []).filter((x) => (x[4] === "warm" || x[4] === "cache") && Number.isFinite(x[2]) && Number.isFinite(x[3]));
  const durs = hits.map((x) => x[3] - x[2]);
  const minMs = durs.length ? Math.min(...durs) : null;
  const suspect = pagesTotal >= minPages && hits.length >= share * pagesTotal && hits.length > 0 && minMs > slowMs;
  return { suspect, hits: hits.length, pages: pagesTotal, minMs, p50: dist(durs).p50 };
}

// Admin page reloads: in-window (k = group number) vs control (k =
// "control"). Hard gate on the in-window ones: status 200, the content
// check passed (a login redirect or an error page can be a 200 too), and
// total ≤ `maxMs`. The controls only give the ratio context.
export function reloadVerdict(reloads, { maxMs = 3000 } = {}) {
  const win = reloads.filter((r) => r.k !== "control");
  const ctl = reloads.filter((r) => r.k === "control");
  const bad = win.filter((r) => !(r.status === 200 && r.contentOk && r.ms != null && r.ms <= maxMs));
  const wd = dist(win.map((r) => r.ms).filter((v) => v != null));
  const cd = dist(ctl.filter((r) => r.status === 200).map((r) => r.ms).filter((v) => v != null));
  return {
    window: { ...wd, n: win.length, bad: bad.length },
    control: { ...cd, n: ctl.length, bad: ctl.filter((r) => !(r.status === 200 && r.contentOk)).length },
    ratioMedian: wd.p50 != null && cd.p50 ? wd.p50 / cd.p50 : null,
    ratioMax: wd.max != null && cd.p50 ? wd.max / cd.p50 : null,
    pass: win.length ? bad.length === 0 : null,
  };
}

// Per-role original-attempt PUT latency (A, B, C): p95 ≤ maxMs each, all
// values listed (6 groups → the p95 IS the max, so the list is the gate).
export function roleLatency(saves, { maxMs = 1500 } = {}) {
  const out = {};
  for (const s of saves) {
    (out[s.who] ||= { values: [], failed: 0 });
    if (isOkSave(s) && s.ms != null) out[s.who].values.push(s.ms);
    else out[s.who].failed++;
  }
  for (const r of Object.values(out)) {
    const d = dist(r.values);
    Object.assign(r, { p50: d.p50, p95: d.p95, max: d.max, pass: r.values.length ? r.failed === 0 && d.p95 <= maxMs : false });
  }
  return out;
}

// Raw reactions: p95 ≤ maxMs, 0 × 5xx; non-2xx counted.
export function reactionVerdict(rx, { maxMs = 1500 } = {}) {
  const ms = rx.filter((r) => r.ms != null).map((r) => r.ms);
  const d = dist(ms);
  const non2xx = rx.filter((r) => !(r.status >= 200 && r.status < 300)).length;
  const fivexx = rx.filter((r) => r.status >= 500).length;
  return { n: rx.length, ...d, non2xx, fivexx, pass: rx.length ? fivexx === 0 && d.p95 != null && d.p95 <= maxMs : null };
}

// The page reaction ack-hold verdict (design §2.4). `tr`:
//   clickAt      page clock of the click
//   ack          { recvAt, ackAtMs, count, reactionId, status } — the
//                POST response (recvAt = this machine's clock; ackAtMs =
//                the server's clock_timestamp(), Postgres clock)
//   held         { reqAt, capturedAtMs, count, releasedAt, rev } — the
//                ONE genuine hinted response held back from before the
//                click until after the ack
//   responses    [[t, capturedAtMs, count, rev]] every /api/setlist
//                response the page received (this machine's clock)
//   samples      [[t, displayedCount, ariaPressed, songId]] the button
//                as rendered, sampled every 20 ms in the page
// Exposure (all required, else "not exercised"): the ack succeeded, the
// held snapshot predates it (capturedAt ≤ ackAt — the SAME Postgres
// clock on both sides) with a LOWER count, and it was released after the
// ack arrived, i.e. it reached the component while the acknowledged
// display was held. Gate: from the ack on, the displayed count never
// drops below the acknowledged one until a response with capturedAt >
// ackAt arrives (the release); 1 s after that arrival the display equals
// that response's count.
export function ackHoldVerdict(tr, { settleMs = 1000 } = {}) {
  const notEx = (reason) => ({ exercised: false, pass: null, reason });
  if (!tr) return notEx("no trace");
  if (tr.error) return notEx(tr.error);
  const { ack, held } = tr;
  if (!ack || !(ack.status >= 200 && ack.status < 300) || ack.count == null || ack.ackAtMs == null) return notEx("acknowledgement missing or failed");
  if (!held || held.capturedAtMs == null) return notEx("no hinted response was held");
  if (!(held.capturedAtMs <= ack.ackAtMs)) return notEx(`held snapshot captured after the ack (${held.capturedAtMs} > ${ack.ackAtMs})`);
  if (!(held.count < ack.count)) return notEx(`held snapshot count ${held.count} is not below the acknowledged ${ack.count}`);
  if (!(held.releasedAt != null && held.releasedAt >= ack.recvAt)) return notEx("held response released before the ack arrived");
  const samples = tr.samples || [];
  if (!samples.some((s) => s[1] != null)) return notEx("reaction button not found in the DOM (selector unstable?)");
  const rel = (tr.responses || []).find((r) => r[0] >= ack.recvAt && r[1] != null && r[1] > ack.ackAtMs) ?? null;
  const until = rel ? rel[0] : Infinity;
  const drops = samples.filter((s) => s[0] >= ack.recvAt && s[0] < until && s[1] != null && s[1] < ack.count);
  let finalShown = null;
  if (rel) {
    const before = samples.filter((s) => s[0] <= rel[0] + settleMs && s[1] != null);
    finalShown = before.length ? before[before.length - 1][1] : null;
  }
  const finalOk = rel ? finalShown === rel[2] : false;
  return {
    exercised: true,
    pass: drops.length === 0 && !!rel && finalOk,
    released: !!rel,
    releaseAt: rel ? rel[0] : null,
    releaseCount: rel ? rel[2] : null,
    finalShown,
    drops: drops.length,
    firstDrop: drops[0] ?? null,
    heldCount: held.count,
    ackCount: ack.count,
    reason: !rel ? "no snapshot with capturedAt > ackAt arrived in the window (hold never released)" : drops.length ? `display dropped below the acknowledged ${ack.count} before the release` : !finalOk ? `display ${finalShown} ≠ releasing snapshot's ${rel[2]}` : "ok",
  };
}

// The probe plan of one group: every committed rev (ACTUAL returned revs,
// never arithmetic) × locales × offsets after the last response.
export function probePlan(committed, locales = ["ja", "ko", "en"], offsetsMs = [1000, 2000, 4000]) {
  const out = [];
  for (const off of offsetsMs) for (const c of committed) for (const locale of locales) out.push({ off, rev: c.rev, who: c.who, locale });
  return out;
}
