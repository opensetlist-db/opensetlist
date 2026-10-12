// n14 qualification step 7 — 5-minute spam + real saves + background
// k6 (`run.mjs --phase=spam7`): the pure parts. run.mjs does the I/O
// (population, sender, saves, samplers) and calls these on the records;
// spam7.test.mjs covers them. Every function here is deterministic on
// its inputs — no clock, no network — so a verdict can be recomputed
// from the JSON afterwards.
//
// The experiment (design: step7-design.md §1–§4, Codex rounds 1–2):
//
//   readiness (join + settle) → baseline (--baseline-secs, 60) → spam
//   (--spam-secs, 300) → recovery (--recovery-secs, 60) → measurement
//   end → cleanup.
//
// A guest (anon key, like any visitor) sends forged `rev` broadcasts at
// --spam-rate (2/s) on a fixed slot schedule; each payload is
// `{ kind: "setlist", rev, runId, k }` — the app validates `kind` / `rev`
// and ignores the rest (useRealtimeEventChannel.ts), so `runId` / `k`
// are pure correlation fields the receivers record BEFORE the handler
// classifies the message. `k` never reaches acceptance or scheduling.
// The honest saves (12 mixed edits = 6 insert+PUT pairs + 6 standalone
// PUTs) run on their own timer from the spam start (--save-offsets).
//
// Verdict vocabulary (design §0): INVALID only for host corruption
// (lag / heartbeat, undeclared competing work, browser unresponsive);
// insufficient declared load → NOT EXERCISED for that aspect; service
// misses under valid exercised load → VALID + FAIL. Observed service
// failures stay failures even when an exposure aspect is NOT EXERCISED
// (Codex round 2): FAIL outranks NOT EXERCISED in the exit code.
import { dist } from "../realtime/lib.mjs";

// ─── flags ───
// Phase-only flags; --spam-rate / --spam-rev / --spam-secs are shared
// with --drill=spam (same meaning), but their step-7 defaults differ
// (300 s, and `none` is allowed: the P0 control keeps the schedule and
// the "attack end" without sending anything).
export const SPAM7_KEYS = ["baseline-secs", "recovery-secs", "save-offsets"];
export const DEFAULT_OFFSETS = [10, 35, 60, 85, 110, 135, 160, 185, 210, 235, 260, 285];
export const SPAM7_REVS = ["ahead", "max", "stale", "none"];

const num = (v) => (v === undefined || v === true ? NaN : Number(v));

// Returns { cfg } (cfg null without --phase=spam7) or { error }.
// Refusals (checked before anything is created):
//   - a step-7 flag without --phase=spam7;
//   - --phase=spam7 with a --drill (two experiments in one run);
//   - non-positive / non-finite durations or rate;
//   - offsets not strictly increasing, before the baseline start, or
//     after the recovery end (a save the measurement cannot see);
//   - stale with a save inside the spam block: the ignore-path control
//     holds the head fixed while the stale hints flow (Codex round 2
//     item 3), so a save there would turn the control into an `ahead`
//     run for every client that has not fetched it yet;
//   - --edit-mode other than mixed (the design's 18 measured writes
//     come from the mixed shape: pair on odd edits, standalone on even).
export function parseSpam7Flags(args, { phase, drill }) {
  const given = SPAM7_KEYS.filter((k) => args[k] !== undefined);
  if (phase !== "spam7") {
    if (given.length) return { error: `${given.map((k) => `--${k}`).join(", ")} need(s) --phase=spam7` };
    return { cfg: null };
  }
  if (drill) return { error: `--phase=spam7 runs no drill (got --drill=${drill}); the spam is part of the phase` };
  if (args["edit-mode"] !== undefined && args["edit-mode"] !== "mixed") return { error: "--phase=spam7 uses --edit-mode=mixed (6 insert+PUT pairs + 6 standalone PUTs)" };
  const baselineSecs = args["baseline-secs"] === undefined ? 60 : num(args["baseline-secs"]);
  const spamSecs = args["spam-secs"] === undefined ? 300 : num(args["spam-secs"]);
  const recoverySecs = args["recovery-secs"] === undefined ? 60 : num(args["recovery-secs"]);
  const spamRate = args["spam-rate"] === undefined ? 2 : num(args["spam-rate"]);
  const spamRev = args["spam-rev"] === undefined ? "ahead" : String(args["spam-rev"]);
  for (const [k, v] of [["baseline-secs", baselineSecs], ["spam-secs", spamSecs], ["recovery-secs", recoverySecs], ["spam-rate", spamRate]]) {
    if (!(Number.isFinite(v) && v > 0)) return { error: `--${k} must be > 0 (got ${args[k]})` };
  }
  if (!SPAM7_REVS.includes(spamRev)) return { error: `--spam-rev must be ${SPAM7_REVS.join("|")} under --phase=spam7` };
  let offsets = DEFAULT_OFFSETS;
  if (args["save-offsets"] !== undefined) {
    const raw = String(args["save-offsets"]).split(",").map((s) => s.trim()).filter(Boolean);
    offsets = raw.map(Number);
    if (!offsets.length || offsets.some((x) => !Number.isFinite(x))) return { error: `--save-offsets must be a comma list of seconds (got ${args["save-offsets"]})` };
  }
  for (let i = 1; i < offsets.length; i++) if (!(offsets[i] > offsets[i - 1])) return { error: "--save-offsets must be strictly increasing" };
  if (offsets[0] < -baselineSecs) return { error: `--save-offsets: ${offsets[0]} s is before the baseline start (-${baselineSecs} s)` };
  if (offsets[offsets.length - 1] >= spamSecs + recoverySecs) return { error: `--save-offsets: ${offsets[offsets.length - 1]} s is at/after the recovery end (+${spamSecs + recoverySecs} s)` };
  if (spamRev === "stale" && offsets.some((x) => x >= 0 && x < spamSecs)) return { error: "--spam-rev=stale holds the head fixed during the spam block: no --save-offsets in [0, --spam-secs) (e.g. --save-offsets=-20,70)" };
  return { cfg: { baselineSecs, spamSecs, recoverySecs, spamRate, spamRev, offsets, edits: offsets.length } };
}

// ─── sender schedule ───
// Slot k (1-based) is due at start + (k − 1) / rate. Fixed schedule: a
// late loop skips a slot instead of bursting to catch up (the claim is
// "N messages per second", see run.mjs runSpam).
export function slotSchedule(start, rate, secs) {
  const total = Math.round(rate * secs);
  const interval = 1000 / rate;
  return Array.from({ length: total }, (_, j) => ({ k: j + 1, slotAt: Math.round(start + j * interval) }));
}

// The forged rev of one message. `ahead` = the latest COMMITTED rev the
// sender knows + 1 — its base is the post-preparation head (NOT the run's
// startRev: the anchor insert already moved the head, Codex round 1),
// refreshed from every real save's response; `max` = 2^53 − 1; `stale`
// = the latest known committed rev itself.
export function forgedRev(mode, latest) {
  if (mode === "max") return Number.MAX_SAFE_INTEGER;
  if (mode === "stale") return latest;
  return latest + 1;
}

// ─── receipts ───
// First receipt time per k of one client's rows ([k, receivedAt, …]);
// duplicates (the same (runId, k) twice) are counted apart.
export function firstReceipts(rows) {
  const first = new Map();
  let dup = 0;
  for (const r of rows) {
    const [k, t] = r;
    if (k == null) continue;
    if (first.has(k)) {
      dup++;
      if (t < first.get(k)) first.set(k, t);
    } else first.set(k, t);
  }
  return { first, dup };
}

// ─── exposure (design §1; predeclared) ───
export const EXPOSURE_MIN = { send: 0.95, ack: 0.99, timely: 0.95, perClient: 0.95 };
export const TIMELY_MS = 2000;

// sends:    [{ k, slotAt, sentAt (null = skipped), ack ("ok" | other | null), ackMs }]
// receipts: { sdk: [{ idx, rows: [[k, receivedAt], …] }], pages: [...] }
// declared: { sdk: 470, pages: 30 } — the FIXED declared populations,
//           not "currently subscribed" (a client that dropped under the
//           attack must count against coverage, Codex round 2 item 1).
//           Clients are idx 0 … declared − 1; one without a record has
//           zero coverage.
// Checks: sends ≥ 95 % of planned slots in EVERY 10 s bucket; ack ok
// ≥ 99 % of sent; timely deliveries (first receipt ≤ 2 s after the
// actual send) ≥ 95 % of planned deliveries (slots × declared clients)
// per 10 s bucket, per population; and ≥ 95 % of actually sent messages
// per individual client over the window. Any miss → the intensity is
// NOT EXERCISED (reasons listed).
export function exposure({ sends, receipts, declared, spamStart, spamSecs, bucketMs = 10000, timelyMs = TIMELY_MS, min = EXPOSURE_MIN }) {
  if (!sends.length) return { exercised: null, reasons: ["no spam sent (P0 control or --spam-rev=none)"], buckets: [], populations: {} };
  const nb = Math.max(1, Math.ceil((spamSecs * 1000) / bucketMs));
  const bucketOf = (t) => Math.min(nb - 1, Math.max(0, Math.floor((t - spamStart) / bucketMs)));
  const byK = new Map(sends.map((s) => [s.k, s]));
  const buckets = Array.from({ length: nb }, (_, i) => ({ i, from: spamStart + i * bucketMs, planned: 0, sent: 0, skipped: 0, ackOk: 0, timely: {} }));
  for (const s of sends) {
    const b = buckets[bucketOf(s.slotAt)];
    b.planned++;
    if (s.sentAt != null) b.sent++;
    else b.skipped++;
    if (s.ack === "ok") b.ackOk++;
  }
  const sentTotal = sends.filter((s) => s.sentAt != null).length;
  const ackOk = sends.filter((s) => s.ack === "ok").length;
  const reasons = [];
  const populations = {};
  for (const [pop, n] of Object.entries(declared)) {
    if (!(n > 0)) continue;
    const recs = new Map((receipts[pop] || []).map((c) => [c.idx, c]));
    const perClient = [];
    let duplicates = 0;
    let late = 0;
    let received = 0;
    for (const b of buckets) b.timely[pop] = 0;
    const latencies = [];
    for (let idx = 0; idx < n; idx++) {
      const c = recs.get(idx);
      const { first, dup } = firstReceipts(c?.rows || []);
      duplicates += dup;
      let timely = 0;
      for (const [k, t] of first) {
        const s = byK.get(k);
        if (!s || s.sentAt == null) continue;
        received++;
        const d = t - s.sentAt;
        latencies.push(d);
        if (d <= timelyMs) {
          timely++;
          buckets[bucketOf(s.slotAt)].timely[pop]++;
        } else late++;
      }
      perClient.push({ idx, timely, share: sentTotal ? timely / sentTotal : 0, present: !!c });
    }
    const bucketShares = buckets.filter((b) => b.planned).map((b) => ({ i: b.i, share: b.timely[pop] / (b.planned * n) }));
    const bucketMin = bucketShares.reduce((a, x) => Math.min(a, x.share), Infinity);
    const below = perClient.filter((x) => x.share < min.perClient);
    const worst = [...perClient].sort((a, b) => a.share - b.share).slice(0, 10);
    populations[pop] = {
      declared: n, recorded: recs.size, received, duplicates, late, plannedDeliveries: sends.length * n,
      timelyTotal: perClient.reduce((a, x) => a + x.timely, 0),
      bucketMin: Number.isFinite(bucketMin) ? bucketMin : null, bucketShares,
      perClientMin: perClient.length ? Math.min(...perClient.map((x) => x.share)) : null,
      clientsBelow: below.length, worst, delivery: dist(latencies),
    };
    if (!(bucketMin >= min.timely)) reasons.push(`${pop}: timely deliveries ${(bucketMin * 100).toFixed(1)} % of planned in the worst 10 s bucket (< ${min.timely * 100} %)`);
    if (below.length) reasons.push(`${pop}: ${below.length}/${n} client(s) received < ${min.perClient * 100} % of the sent messages within ${timelyMs} ms`);
  }
  const sendShares = buckets.filter((b) => b.planned).map((b) => b.sent / b.planned);
  const sendMin = sendShares.length ? Math.min(...sendShares) : null;
  if (!(sendMin >= min.send)) reasons.unshift(`sender: ${(sendMin * 100).toFixed(1)} % of planned slots sent in the worst 10 s bucket (< ${min.send * 100} %)`);
  const ackShare = sentTotal ? ackOk / sentTotal : 0;
  if (!(ackShare >= min.ack)) reasons.unshift(`sender: ack ok ${(ackShare * 100).toFixed(1)} % of sent (< ${min.ack * 100} %)`);
  return {
    exercised: reasons.length === 0, reasons, buckets, populations, min, timelyMs,
    planned: sends.length, sent: sentTotal, skipped: sends.length - sentTotal, ackOk, ackShare, sendMin,
    ackMs: dist(sends.filter((s) => s.ackMs != null).map((s) => s.ackMs)),
    sendLateMs: dist(sends.filter((s) => s.sentAt != null).map((s) => s.sentAt - s.slotAt)),
  };
}

// ─── stale control (design §1) ───
// The ignore rule is `rev ≤ the CLIENT's own serverRev` (snapshotAcceptance
// noteHint), not "≤ the database head": a stale value can still be news to
// a lagging client, which then correctly notes it. Only receipts whose rev
// is ≤ the client's serverRev at receipt are eligible; every eligible one
// must be ignored ("d"). rows: [k, receivedAt, outcome, serverRevAtReceipt].
export function staleEligibility(clients, sendsByK) {
  let eligible = 0;
  let ignored = 0;
  let notedEligible = 0;
  let nonEligible = 0;
  let nonEligibleNoted = 0;
  let unknown = 0;
  const examples = [];
  for (const c of clients) {
    for (const [k, t, o, srv] of c.rows || []) {
      const s = sendsByK.get(k);
      if (!s) continue;
      if (srv == null) { unknown++; continue; }
      if (s.rev <= srv) {
        eligible++;
        if (o === "n") {
          notedEligible++;
          if (examples.length < 10) examples.push({ idx: c.idx, k, t, rev: s.rev, serverRev: srv });
        } else ignored++;
      } else {
        nonEligible++;
        if (o === "n") nonEligibleNoted++;
      }
    }
  }
  return { eligible, ignored, notedEligible, nonEligible, nonEligibleNoted, unknown, examples, pass: eligible === 0 ? null : notedEligible === 0 };
}

// A page exposes no serverRev; the proxy is the highest body rev among
// its 200 responses that arrived before `t` (page fetch rows: [tResponse,
// minRev, status, source, bodyRev, …]). Reported as a proxy, never gated.
export function pageServerRevAt(fetches, t) {
  let best = null;
  for (const f of fetches || []) {
    if (f[0] > t || f[2] !== 200 || !Number.isSafeInteger(f[4])) continue;
    if (best == null || f[4] > best) best = f[4];
  }
  return best;
}

// ─── strata at each save's PUT start (design §2) ───
// s = one SDK client's live state, sampled right at the PUT dispatch:
// the acceptance batch (pendingHint), the scheduler's carried ticket +
// phase, and the worker's active request record (the in-flight request's
// reason + ticket — getState() exposes `inFlight` but not that flight's
// hint, Codex round 2 item 2).
//   inflight-ticket     a notification / recheck request carrying a ticket is in flight
//   other-ticket-fetch  another request (generic, retry, catch-up) carries a ticket
//   queued-ticket       no ticket in flight, but one is carried (either
//                       phase) or waiting in the batch
//   none
export const STRATA = ["none", "queued-ticket", "inflight-ticket", "other-ticket-fetch"];
export function classifyStratum(s) {
  if (!s) return null;
  const q = s.inFlightReq;
  if (s.inFlight && q && q.hint != null) return q.reason === "notification" || q.reason === "recheck" ? "inflight-ticket" : "other-ticket-fetch";
  if (s.carriedHint != null || s.pendingHint != null) return "queued-ticket";
  return "none";
}

// ─── honest latency (design §2) ───
// Every edit × client pair counts; nothing is excluded. Missing = not
// within the timeout. Gate per save per population: p95 ≤ gate, 0 missing.
export function latSummary(values, missing, gateMs = 3000) {
  const d = dist(values);
  const over = values.filter((v) => v > gateMs).length;
  const all = values.length + missing;
  return { ...d, missing, over, overShare: all ? over / all : null, pass: all === 0 ? null : missing === 0 && d.p95 != null && d.p95 <= gateMs };
}

// ─── request-rate buckets (design §3) ───
// Each snapshot request counted ONCE, by its request-START timestamp,
// under exactly one category (no double counting across dimensions).
// SDK request rows: subs-worker `reqs` ([tStart, reason, generic 0/1,
// hint, notify 0/1, minRev, status, …]).
export function sdkReqCategory(q) {
  if (q[4] === 1) return "notification";
  if (q[1] === "recheck") return "recheck";
  if (q[2] === 1) return "generic";
  return "other";
}
// sdk: [[tStart, category, status]], pages: [[tStart, status, hinted]] →
// 1 s buckets from `from` (inclusive) to `to` (exclusive).
export function rateBuckets({ from, to, sdk, pages }) {
  const n = Math.max(0, Math.ceil((to - from) / 1000));
  const b = Array.from({ length: n }, (_, i) => ({ t: from + i * 1000, notification: 0, recheck: 0, generic: 0, other: 0, pages: 0, pagesHinted: 0, pagesGeneric: 0, s503: 0, total: 0 }));
  const at = (t) => (t >= from && t < to ? b[Math.floor((t - from) / 1000)] : null);
  for (const [t, cat, st] of sdk) {
    const x = at(t);
    if (!x) continue;
    x[cat]++;
    x.total++;
    if (st === 503) x.s503++;
  }
  for (const [t, st, hinted] of pages) {
    const x = at(t);
    if (!x) continue;
    x.pages++;
    if (hinted) x.pagesHinted++;
    else x.pagesGeneric++;
    x.total++;
    if (st === 503) x.s503++;
  }
  return b;
}
// Trailing w-second average ending at each bucket (null before w full buckets).
export function rolling(totals, w = 10) {
  const out = new Array(totals.length).fill(null);
  let s = 0;
  for (let i = 0; i < totals.length; i++) {
    s += totals[i];
    if (i >= w) s -= totals[i - w];
    if (i >= w - 1) out[i] = s / w;
  }
  return out;
}
// Baseline μ (req/s over the baseline buckets) and s₁₀ = sample SD of
// the NON-overlapping 10 s averages (the quantity the drain gate judges;
// overlapping windows would understate the noise by correlation).
export function baselineStats(totals, w = 10) {
  const n = totals.length;
  const mu = n ? totals.reduce((a, v) => a + v, 0) / n : 0;
  const windows = [];
  for (let i = 0; i + w <= n; i += w) windows.push(totals.slice(i, i + w).reduce((a, v) => a + v, 0) / w);
  let s10 = 0;
  if (windows.length >= 2) {
    const m = windows.reduce((a, v) => a + v, 0) / windows.length;
    s10 = Math.sqrt(windows.reduce((a, v) => a + (v - m) ** 2, 0) / (windows.length - 1));
  }
  return { mu, s10, windows, n };
}
// Codex round 2 item 2: μ + max(0.5 μ, 2 req/s, 2 s₁₀) — one allowance,
// never two stacked.
export const drainThreshold = (mu, s10) => mu + Math.max(0.5 * mu, 2, 2 * s10);

// The drain confirmation (design §3): the first full w-second interval
// starting at or after the last send whose average rate ≤ threshold AND
// at whose END every SDK worker reports pending batches 0, carried
// tickets 0 and in-flight ticket requests 0 (`stateAt(endT)` → the
// aggregated worker-state sample at/after endT, or null = unknown → not
// confirmed). The search continues past the deadline so the report can
// state the actual confirming interval; `withinDeadline` says whether it
// completed ≤ deadlineMs after the last send. `firstQuiet` = the first
// rate-quiet interval, even if tickets were still outstanding then.
export function confirmDrain({ totals, from, lastSend, threshold, stateAt, w = 10, deadlineMs = 30000 }) {
  const a0 = Math.max(0, Math.ceil((lastSend - from) / 1000));
  let firstQuiet = null;
  for (let a = a0; a + w <= totals.length; a++) {
    let s = 0;
    for (let i = a; i < a + w; i++) s += totals[i];
    const avg = s / w;
    if (avg > threshold) continue;
    const endT = from + (a + w) * 1000;
    const st = stateAt(endT);
    const ok = !!st && st.pending === 0 && st.carried === 0 && st.inFlightTicket === 0;
    const row = { from: from + a * 1000, to: endT, avg, state: st, stateOk: ok, completedAfterLastSendMs: endT - lastSend };
    if (!firstQuiet) firstQuiet = row;
    if (ok) return { confirm: row, withinDeadline: endT - lastSend <= deadlineMs, firstQuiet };
  }
  return { confirm: null, withinDeadline: false, firstQuiet };
}

// Aggregate of one live worker-state sample (all SDK clients at one
// instant): how many clients hold a pending batch, a carried ticket (and
// in the recheck phase), any in-flight request, an in-flight request
// that carries a ticket.
export function aggregateState(t, clients, maxExamples = 5) {
  const out = { t, clients: clients.length, pending: 0, carried: 0, carriedRecheck: 0, inFlight: 0, inFlightTicket: 0, examples: [] };
  for (const c of clients) {
    const p = c.pendingHint != null;
    const k = c.carriedHint != null;
    const f = !!(c.inFlight && c.inFlightReq && c.inFlightReq.hint != null);
    if (p) out.pending++;
    if (k) out.carried++;
    if (k && c.carriedHintPhase === "recheck") out.carriedRecheck++;
    if (c.inFlight) out.inFlight++;
    if (f) out.inFlightTicket++;
    if ((p || k || f) && out.examples.length < maxExamples) out.examples.push({ idx: c.idx, pendingHint: c.pendingHint ?? null, carriedHint: c.carriedHint ?? null, phase: c.carriedHintPhase ?? null, inFlightReq: f ? c.inFlightReq : null });
  }
  return out;
}
// The first sample at/after t within `slackMs`, else null.
export function sampleAt(samples, t, slackMs = 2000) {
  for (const s of samples) if (s.t >= t) return s.t - t <= slackMs ? s : null;
  return null;
}

// Rebound after the confirming interval (design §3: "delayed forged
// deliveries after the confirming interval = not sustained recovery"):
// SDK requests in (from, to] that are a recheck or carry a ticket that
// is NOT a genuine committed revision at the request's start. Genuine
// tickets (a recovery-phase save, P3's +70 s) are listed apart.
export function reboundRequests(clients, { from, to, isGenuine }) {
  const out = { count: 0, genuine: 0, byReason: {}, examples: [] };
  for (const c of clients) {
    for (const q of c.reqs || []) {
      if (!(q[0] > from && q[0] <= to)) continue;
      if (q[3] == null && q[1] !== "recheck") continue;
      if (q[3] != null && isGenuine(q[3], q[0])) { out.genuine++; continue; }
      out.count++;
      out.byReason[q[1]] = (out.byReason[q[1]] || 0) + 1;
      if (out.examples.length < 10) out.examples.push({ idx: c.idx, t: q[0], reason: q[1], hint: q[3] });
    }
  }
  return out;
}

// Per-client cooldown (as the --drill=spam gate): every request that
// carries a hint ticket — notification, recheck, and any generic / retry
// the ticket rides on — starts ≥ cooldown apart. Over [from, to].
export function cooldownCheck(clients, { from, to, cooldownMs, toleranceMs = 5 }) {
  let tooClose = 0;
  let clientsBad = 0;
  let minGap = null;
  const examples = [];
  for (const c of clients) {
    const ts = (c.reqs || []).filter((q) => q[0] >= from && q[0] <= to && q[3] != null).map((q) => q[0]).sort((a, b) => a - b);
    let bad = 0;
    for (let i = 1; i < ts.length; i++) {
      const g = ts[i] - ts[i - 1];
      minGap = minGap == null ? g : Math.min(minGap, g);
      if (g < cooldownMs - toleranceMs) {
        bad++;
        if (examples.length < 5) examples.push({ idx: c.idx, t: ts[i], gap: g });
      }
    }
    tooClose += bad;
    if (bad) clientsBad++;
  }
  return { tooClose, clientsBad, minGap, examples, pass: tooClose === 0 };
}

// ─── durable state (design §2) ───
// Each SDK client's server-observed watermark (serverRev) history
// ([t, rev] on every change) must only ever hold GENUINE committed
// revisions: ≤ the post-preparation head (pre-existing), or a rev a save
// of this run returned, observed no earlier than that save's request
// start (a commit cannot precede its request). A forged value (`max`, or
// an `ahead` value seen before the save that later takes it) is a
// violation. `until` = the measurement end (the clean-up's revs come later).
export function watermarkViolations(clients, { genuine, initialHead, until = Infinity }) {
  const rows = [];
  let checked = 0;
  for (const c of clients) {
    for (const [t, rev] of c.serverRevLog || []) {
      if (t > until) continue;
      checked++;
      if (rev <= initialHead) continue;
      const at = genuine.get(rev);
      if (at == null) rows.push({ idx: c.idx, t, rev, why: "not a committed revision of this run" });
      else if (t < at) rows.push({ idx: c.idx, t, rev, why: `held ${at - t} ms before the save that committed it started` });
    }
  }
  return { checked, violations: rows.length, clients: new Set(rows.map((r) => r.idx)).size, examples: rows.slice(0, 10), pass: rows.length === 0 };
}

// ─── ticket-drop recovery (design §2) ───
// A separate mechanism claim: a client whose FORGED ticket exhausted
// (two inconclusive answers) while it was behind the genuine head, and
// which then converged through a generic / periodic request WITHOUT an
// intervening save. saves: [{ rev, start, commitAt }] (commitAt = the
// PUT response, the commit's upper bound). isForged(hint, t). Each
// exhaustion is classified:
//   current          the client already had the head (nothing to repair)
//   recovered        stale, then converged by a non-ticket request before any later save
//   repaired-by-save stale, converged only after a later save started
//   ticket-path      stale, converged by a notification / recheck before any later save
//   not-converged    stale until `until`
export function ticketDropRecovery(clients, { saves, initialHead, isForged, until = Infinity }) {
  const rows = [];
  const counts = { forgedExhausted: 0, current: 0, recovered: 0, "repaired-by-save": 0, "ticket-path": 0, "not-converged": 0 };
  const sorted = [...saves].sort((a, b) => a.start - b.start);
  for (const c of clients) {
    const applied = c.appliedAll || [];
    for (const [t, hint] of c.exhausted || []) {
      if (t > until || !isForged(hint, t)) continue;
      counts.forgedExhausted++;
      const head = sorted.filter((s) => s.commitAt != null && s.commitAt <= t).reduce((a, s) => Math.max(a, s.rev), initialHead);
      const have = applied.filter(([at]) => at <= t).reduce((a, [, r]) => Math.max(a, r), -Infinity);
      if (have >= head) { counts.current++; continue; }
      const conv = applied.find(([at, r]) => at > t && at <= until && r >= head);
      const nextSave = sorted.find((s) => s.start > t);
      let cls;
      if (!conv) cls = "not-converged";
      else if (nextSave && nextSave.start <= conv[0]) cls = "repaired-by-save";
      else if (conv[2] === "notification" || conv[2] === "recheck") cls = "ticket-path";
      else cls = "recovered";
      counts[cls]++;
      if (rows.length < 20 || cls === "recovered") rows.push({ idx: c.idx, exhaustedAt: t, hint, appliedRev: have === -Infinity ? null : have, head, cls, convergedAt: conv?.[0] ?? null, reason: conv?.[2] ?? null, delayMs: conv ? conv[0] - t : null });
    }
  }
  return { counts, rows: rows.slice(0, 40), exercised: counts.recovered > 0 };
}

// ─── declared process (design §0 / §4) ───
// procs: [{ pid, ppid }]. The declared pid plus its descendants by parent
// PID (k6 may fork helpers); a pid whose parent chain is not listed is
// not a descendant.
export function processTree(procs, root) {
  const out = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of procs) if (!out.has(p.pid) && out.has(p.ppid)) { out.add(p.pid); grew = true; }
  }
  return out;
}

// ─── verdict ───
// gates: [{ name, pass: true | false | null }]; notExercised: [aspect…].
// INVALID (3) > FAIL (1) > NOT EXERCISED (4) > PASS (0).
export function spam7Verdict({ invalid, gates, notExercised }) {
  const failed = gates.filter((g) => g.pass === false).map((g) => g.name);
  if (invalid) return { verdict: "INVALID", exit: 3, failed, notExercised };
  if (failed.length) return { verdict: "VALID + FAIL", exit: 1, failed, notExercised };
  if (notExercised.length) return { verdict: "NOT EXERCISED", exit: 4, failed, notExercised };
  return { verdict: "VALID + PASS", exit: 0, failed, notExercised };
}
