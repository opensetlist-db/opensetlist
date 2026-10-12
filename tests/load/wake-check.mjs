// Wake check (n14 qualification step 8, check B; the runbook's T−10
// check, production side): real Chromium pages on the event page, per
// locale, waiting for the operator's check save — read-only.
//
//   node tests/load/wake-check.mjs --base=<origin> --event-id=<n>
//        [--prod-readonly] [--event-path=/events/<id>/<slug>]
//        [--locales=ja,ko,en] [--pages=2] [--poll-only=1] [--wait-s=600]
//        [--deployment=<dpl_… | deployment URL>] [--stop-file=<path>]
//        [--out=<dir>] [--label=<name>] [--headed]
//
// --prod-readonly is required for any base other than the dev alias /
// localhost (prod-readonly.mjs `validateWakeCheck`); only the flags above
// are accepted — anything write-capable is refused before a browser
// starts. There is no admin, no login and no key: the pages use the
// deployment's own public config, exactly like a visitor.
//
// Page roles:
//   live      `pages` per locale — the continuity population: they must
//             receive the check save's broadcast frame, show it within
//             3 s of the frame, keep one websocket for the whole window,
//             and receive the second save too ("stays connected");
//   poll      --poll-only pages (default 1, locale = the first locale)
//             whose Realtime websocket is BLOCKED (pages.mjs routeMode
//             "blocked": every connection attempt is closed before it
//             reaches Supabase). The page must fall back to polling and
//             still show the save within the repair budget
//             (POLL_REPAIR_BUDGET_MS, measured from the first frame any
//             live page received — the best stand-in for the save time);
//   postsave  one page per locale opened ~5 s after the first observed
//             rev change — "a viewer who (re)loads after the save". It
//             must be SSR-seeded at rev ≥ R1 and its first paint must
//             match what the live pages of its locale show (row-text
//             fingerprint), i.e. the save is in the server render, not
//             only in client updates. It is a NEW page rather than a
//             reload of a live page so the live pages' continuity
//             (no reload, socket never closed) stays measurable.
//
// Foreground: the live hook tears its channel down when
// `document.hidden` (src/hooks/useRealtimeEventChannel.ts). Every page
// here is its own browser context launched with Chromium's background /
// occlusion throttling disabled (pages.mjs) and headless pages report
// "visible"; the page table records `visibilityState` per page so a
// hidden page would show, not silently skew the result.
//
// Flow: resolve the canonical event path (GET /ja/events/<id>, redirect
// manual — also proves the event exists) → open live + poll pages
// (pages.mjs `launchPages` with admission + transition recorders, plus
// the step-8 options `rowText` and `readOnly`: every non-GET request a
// page tries is aborted and counted) → settle 10 s → baseline rev →
// `[wake-check] READY …` (the operator saves now) → watch until --wait-s
// or the STOP file; the first rev above the baseline is R1 (check save),
// the next R2 (second save) → verdict → <stamp>-wake-check[-label].{json,md}.
//
// The save must change something VISIBLE in a row (add a row / change
// its song / its status): the DOM side of every check is "the rows'
// visible text changed" (reaction counts excluded). The README's
// operator sequence uses "add a row" (R1) and "delete that row" (R2).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, validateWakeCheck } from "./prod-readonly.mjs";
import { FALLBACK_POLL_MS, FALLBACK_POLL_SPREAD_MS } from "../../src/lib/liveScheduler.ts";
import { reqIdOf } from "./transition-join.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DOM_BUDGET_MS = 3000;
// A websocket-less page polls every FALLBACK_POLL_MS ± SPREAD; the save
// lands at a random point of that cycle, then the fetch + render get the
// same DOM budget as a broadcast page.
export const POLL_REPAIR_BUDGET_MS = FALLBACK_POLL_MS + FALLBACK_POLL_SPREAD_MS + DOM_BUDGET_MS;
const SETTLE_MS = 10_000;
const POSTSAVE_DELAY_MS = 5_000;
// Node-side response timestamps come from CDP events and can trail the
// page clock by a few ms; a DOM change this much before the recorded
// response is still attributed to it.
const RESP_SLACK_MS = 200;

const iso = (t) => (t == null ? "–" : new Date(t).toISOString().slice(11, 23));

// ─── analysis (pure; covered by wake-check.test.mjs) ───

// Revs above the baseline that any page saw (broadcast frame or a
// fetched body), ascending.
export function observedRevs(recs, baselineRev) {
  const s = new Set();
  for (const r of recs) {
    for (const b of r.bcasts ?? []) if (Number.isSafeInteger(b[1]) && b[1] > baselineRev) s.add(b[1]);
    for (const f of r.fetches ?? []) if (Number.isSafeInteger(f[4]) && f[4] > baselineRev) s.add(f[4]);
  }
  return [...s].sort((a, b) => a - b);
}

// Document loads that are not redirects (a 3xx hop is part of one load).
const documents = (r) => (r.navs ?? []).filter((n) => !(n[2] >= 300 && n[2] < 400));

// One page's view of rev R, frame and DOM kept apart:
//   frameAt  the `rev` broadcast frame for exactly R arrived (websocket);
//   respAt   the first 200 /api/setlist response carrying rev ≥ R;
//   domAt    the first change of the rows' visible text at/after that
//            response (and after `after` = the previous rev's DOM time,
//            or READY).
export function pageRev(r, rev, after) {
  const frame = (r.bcasts ?? []).find((b) => b[1] === rev);
  const frameAt = frame ? frame[0] : null;
  const resp = (r.fetches ?? []).filter((f) => f[2] === 200 && Number.isSafeInteger(f[4]) && f[4] >= rev).sort((a, b) => a[0] - b[0])[0] ?? null;
  const respAt = resp ? resp[0] : null;
  const from = Math.max(after ?? -Infinity, respAt != null ? respAt - RESP_SLACK_MS : frameAt ?? -Infinity);
  const dom = (r.rowTextLog ?? []).find((x) => x[0] > (after ?? -Infinity) && x[0] >= from);
  const domAt = dom ? dom[0] : null;
  return {
    rev, frameAt, respAt, domAt,
    frameToDomMs: frameAt != null && domAt != null ? domAt - frameAt : null,
    resp: resp ? { status: resp[2], source: resp[3], verify: resp[5], hint: resp[6] === true, minRev: resp[1], elapsedMs: resp[7] != null ? resp[0] - resp[7] : null, vercelId: resp[9] ?? null } : null,
  };
}

export function pageSummary(r, deployment) {
  const firstRows = (r.rowTextLog ?? []).find((x) => x[1] > 0);
  const t0 = r.navStart ?? r.openedAt;
  const docs = documents(r);
  const fiveXX = (r.fetches ?? []).filter((f) => f[2] >= 500).length
    + (r.navs ?? []).filter((n) => n[2] >= 500).length
    + (r.assets ?? []).filter((a) => a[1] >= 500).length;
  return {
    idx: r.idx, locale: r.locale, role: r.role ?? "live", url: r.url, visibility: r.visibility ?? null,
    docStatus: docs[0]?.[2] ?? r.docStatus ?? null,
    loadMs: r.loadedAt != null ? r.loadedAt - r.openedAt : null,
    ttfbMs: r.ttfbMs ?? null, dclMs: r.dclMs ?? null,
    firstRowsMs: firstRows ? firstRows[0] - t0 : null, rows: firstRows ? firstRows[1] : 0,
    wsOpenMs: r.wsOpenAt != null ? r.wsOpenAt - t0 : null,
    joinedMs: r.joinAt?.length ? r.joinAt[0] - t0 : null,
    wsOpens: r.wsOpens ?? 0, wsCloses: r.wsCloses ?? 0,
    reloads: Math.max(0, docs.length - 1),
    pageErrors: (r.pageErrs ?? []).length + (r.errors ?? []).filter((e) => String(e).startsWith("goto:")).length,
    // Fonts are aborted by pages.mjs's resource diet; those "failures"
    // are ours, not the site's.
    fiveXX, failedReqs: (r.reqFailed ?? []).filter((x) => !/\.(woff2?|ttf|otf)(\?|$)/.test(String(x[1]))).length, blockedWrites: (r.blockedWrites ?? []).length,
    seed: r.seed ?? null,
    dplId: r.docDplId ?? null,
    dplMatch: deployment && /^dpl_/.test(deployment) ? r.docDplId === deployment : null,
  };
}

// The fingerprint page `r` showed at time t (last rowText report ≤ t).
const fingerprintAt = (r, t) => {
  let cur = null;
  for (const x of r.rowTextLog ?? []) { if (x[0] <= t) cur = x[2]; else break; }
  return cur;
};

const check = (status, detail) => ({ status, detail });

function firstFrame(pr) {
  const ts = pr.rows.map((x) => x.frameAt).filter((t) => t != null);
  return ts.length ? Math.min(...ts) : null;
}

// `recs` = page records (pages.mjs, snapshotted BEFORE the pages close —
// closing them closes the websockets) with `role` set; `baselineRev`,
// `readyAt`.
export function wakeVerdict({ recs, baselineRev, readyAt, deployment = null }) {
  const revs = observedRevs(recs, baselineRev);
  const [r1, r2] = revs;
  const roleOf = (r) => r.role ?? "live";
  const live = recs.filter((r) => roleOf(r) === "live");
  const poll = recs.filter((r) => roleOf(r) === "poll");
  const post = recs.filter((r) => roleOf(r) === "postsave");
  const pages = recs.map((r) => pageSummary(r, deployment));
  const perRev = [];
  const prevDom = new Map(live.map((r) => [r.idx, readyAt]));
  for (const rev of [r1, r2].filter((x) => x != null)) {
    const rows = live.map((r) => {
      const pr = pageRev(r, rev, prevDom.get(r.idx));
      if (pr.domAt != null) prevDom.set(r.idx, pr.domAt);
      return { idx: r.idx, locale: r.locale, ...pr };
    });
    perRev.push({ rev, rows });
  }
  const N = live.length;
  const checks = {};
  const loaded = (p) => p.docStatus === 200 && p.rows > 0;
  const nonPost = pages.filter((p) => p.role !== "postsave");
  checks.pagesLoaded = check(nonPost.every(loaded) ? "PASS" : "FAIL", `${nonPost.filter(loaded).length}/${nonPost.length} live/poll pages 200 with rows painted`);
  const revCheck = (pr, label) => {
    if (!pr) return { seen: check("NOT EXERCISED", `no ${label} observed`), frames: check("NOT EXERCISED", `no ${label}`), budget: check("NOT EXERCISED", `no ${label}`) };
    const vis = pr.rows.filter((x) => x.domAt != null).length;
    const fr = pr.rows.filter((x) => x.frameAt != null).length;
    const inBudget = pr.rows.filter((x) => x.frameToDomMs != null && x.frameToDomMs <= DOM_BUDGET_MS).length;
    const worst = Math.max(...pr.rows.map((x) => x.frameToDomMs ?? -Infinity));
    return {
      seen: check(vis === N ? "PASS" : "FAIL", `rev ${pr.rev}: DOM updated on ${vis}/${N} live pages`),
      frames: check(fr === N ? "PASS" : "FAIL", `rev ${pr.rev}: broadcast frame received at ${fr}/${N} live pages`),
      budget: check(inBudget === N ? "PASS" : "FAIL", `rev ${pr.rev}: DOM ≤ ${DOM_BUDGET_MS} ms after the frame on ${inBudget}/${N} live pages (worst ${Number.isFinite(worst) ? worst : "–"} ms)`),
    };
  };
  const c1 = revCheck(perRev[0], "rev change (check save)");
  const c2 = revCheck(perRev[1], "second rev change");
  checks.firstSeen = c1.seen;
  checks.firstFrame = c1.frames;
  checks.firstBudget = c1.budget;
  checks.secondSeen = c2.seen;
  checks.secondFrame = c2.frames;
  checks.secondBudget = c2.budget;

  // Poll-only pages: the save by polling within the repair budget.
  const saveProxy = perRev[0] ? firstFrame(perRev[0]) : null;
  const pollRows = r1 == null ? [] : poll.map((r) => {
    const pr = pageRev(r, r1, readyAt);
    return { idx: r.idx, locale: r.locale, ...pr, frames: (r.bcasts ?? []).length, saveToVisibleMs: saveProxy != null && pr.domAt != null ? pr.domAt - saveProxy : null };
  });
  if (poll.length) {
    if (r1 == null) checks.pollOnly = check("NOT EXERCISED", "no save observed");
    else {
      const ok = pollRows.filter((x) => x.saveToVisibleMs != null && x.saveToVisibleMs <= POLL_REPAIR_BUDGET_MS && x.frames === 0).length;
      checks.pollOnly = check(ok === poll.length ? "PASS" : "FAIL", `${ok}/${poll.length} websocket-blocked page(s) showed rev ${r1} ≤ ${POLL_REPAIR_BUDGET_MS} ms after the first live frame (${pollRows.map((x) => `${x.saveToVisibleMs ?? "–"} ms${x.frames ? `, ${x.frames} frame(s) leaked` : ""}`).join("; ")})`);
    }
  }

  // Post-save loads: SSR seed at ≥ R1 and first paint = the live pages'
  // content of the same locale at that moment.
  const postRows = post.map((r) => {
    // The server-rendered paint: the last row-text report at or before
    // DOMContentLoaded (the HTML is fully parsed; a client fetch cannot
    // have applied yet). Not simply the first non-empty report — the
    // streamed HTML can paint a partial list first (seen on dev: 14 of
    // 23 rows, then 23).
    const nonEmpty = (r.rowTextLog ?? []).filter((x) => x[1] > 0);
    const dclAt = r.navStart != null && r.dclMs != null ? r.navStart + r.dclMs : null;
    const fp = (dclAt != null ? nonEmpty.filter((x) => x[0] <= dclAt).at(-1) : null) ?? nonEmpty[0] ?? null;
    const peers = live.filter((x) => x.locale === r.locale);
    const peerFps = fp ? [...new Set(peers.map((x) => fingerprintAt(x, fp[0])).filter(Boolean))] : [];
    const first = (r.fetches ?? []).filter((f) => f[2] != null).sort((a, b) => a[0] - b[0])[0] ?? null;
    return {
      idx: r.idx, locale: r.locale, seed: r.seed ?? null, firstPaintAt: fp?.[0] ?? null,
      seedOk: r1 != null && r.seed?.kind === "live" && Number.isSafeInteger(r.seed.rev) && r.seed.rev >= r1,
      contentMatch: fp != null && peerFps.length === 1 && peerFps[0] === fp[2],
      firstFetch: first ? { status: first[2], source: first[3], verify: first[5], hint: first[6] === true, bodyRev: first[4], vercelId: first[9] ?? null } : null,
    };
  });
  if (r1 == null) checks.postSave = check("NOT EXERCISED", "no save observed — no post-save load");
  else if (!post.length) checks.postSave = check("FAIL", "no post-save page was opened");
  else {
    const ok = postRows.filter((x) => x.seedOk && x.contentMatch).length;
    checks.postSave = check(ok === post.length ? "PASS" : "FAIL", `${ok}/${post.length} post-save load(s) SSR-seeded at rev ≥ ${r1} with first paint = live content (${postRows.map((x) => `${x.locale}: seed ${x.seed?.kind ?? "?"} ${x.seed?.rev ?? "–"}, content ${x.contentMatch ? "match" : "differs"}`).join("; ")})`);
  }

  // Warm publication per locale (informational): was a hinted fetch for
  // R1 answered `x-snapshot-source: warm`? WHICH instance served it is
  // not in any header — x-vercel-id is `<edge PoP>::<function region>::
  // <request id>` — so "a different instance than the writer" needs the
  // request ids joined with `vercel logs` (the `[liveWriter] instance=`
  // line vs the read's own lines); the ids are listed for that join.
  const warm = {};
  if (perRev[0]) {
    for (const loc of [...new Set(live.map((r) => r.locale))]) {
      const hinted = live.filter((r) => r.locale === loc).flatMap((r) => (r.fetches ?? []).filter((f) => f[6] === true && Number.isSafeInteger(f[4]) && f[4] >= r1 && (f[1] == null || f[1] <= r1)));
      const w = hinted.filter((f) => f[3] === "warm");
      warm[loc] = {
        status: !hinted.length ? "NOT EXERCISED" : w.length ? "yes" : "no",
        hinted: hinted.length, warm: w.length,
        sources: hinted.reduce((a, f) => ({ ...a, [f[3] ?? "–"]: (a[f[3] ?? "–"] || 0) + 1 }), {}),
        warmReqIds: w.map((f) => reqIdOf(f[9])).filter(Boolean),
      };
    }
  }

  const sum = (k, list = pages) => list.reduce((a, p) => a + p[k], 0);
  checks.noReloads = check(sum("reloads") === 0 ? "PASS" : "FAIL", `${sum("reloads")} reload(s)`);
  checks.noPageErrors = check(sum("pageErrors") === 0 ? "PASS" : "FAIL", `${sum("pageErrors")} page error(s)`);
  checks.no5xx = check(sum("fiveXX") === 0 ? "PASS" : "FAIL", `${sum("fiveXX")} 5xx response(s)`);
  const livePages = pages.filter((p) => p.role === "live");
  checks.wsNeverClosed = livePages.every((p) => p.wsOpens >= 1 && p.wsCloses === 0)
    ? check("PASS", `${livePages.length}/${livePages.length} live pages: one socket, never closed`)
    : check("FAIL", livePages.filter((p) => !(p.wsOpens >= 1 && p.wsCloses === 0)).map((p) => `page ${p.idx}: opens ${p.wsOpens} closes ${p.wsCloses}`).join("; "));
  const hidden = pages.filter((p) => p.visibility !== "visible");
  checks.foreground = check(hidden.length ? "FAIL" : "PASS", hidden.length ? `not visible: ${hidden.map((p) => `page ${p.idx} (${p.visibility ?? "?"})`).join(", ")}` : `${pages.length}/${pages.length} pages visibilityState=visible`);
  if (deployment && /^dpl_/.test(deployment)) {
    const ok = pages.filter((p) => p.dplMatch).length;
    checks.deployment = check(ok === pages.length ? "PASS" : "FAIL", `${ok}/${pages.length} pages served by ${deployment}`);
  }
  // Informational (never gates): a non-GET the page tried and readOnly
  // aborted; failed /api or /_next requests.
  const f1 = perRev[0] ? firstFrame(perRev[0]) : null;
  const f2 = perRev[1] ? firstFrame(perRev[1]) : null;
  const info = { blockedWrites: sum("blockedWrites"), failedReqs: sum("failedReqs"), revsObserved: revs, gapMs: f1 != null && f2 != null ? f2 - f1 : null };
  const statuses = Object.values(checks).map((c) => c.status);
  const overall = statuses.includes("FAIL") ? "FAIL" : r1 == null ? "NOT EXERCISED" : "PASS";
  return { overall, checks, pages, perRev, pollRows, postRows, warm, baselineRev, readyAt, info };
}

const NAMES = {
  pagesLoaded: "pages loaded with rows", firstSeen: "every live page saw the check save (DOM)", firstFrame: "broadcast frame at every live page (check save)",
  firstBudget: `DOM ≤ ${DOM_BUDGET_MS / 1000} s after the frame (check save)`, secondSeen: "second save seen by every live page (stayed connected)",
  secondFrame: "broadcast frame at every live page (second save)", secondBudget: `DOM ≤ ${DOM_BUDGET_MS / 1000} s after the frame (second save)`,
  pollOnly: `websocket-blocked page shows the save by polling ≤ ${POLL_REPAIR_BUDGET_MS / 1000} s`, postSave: "post-save load: SSR seed + content",
  noReloads: "0 reloads", noPageErrors: "0 page errors", no5xx: "0 × 5xx", wsNeverClosed: "WebSocket never closed (live pages)",
  foreground: "every page foreground (visible)", deployment: "served by the expected deployment",
};

export function wakeMarkdown(v, meta) {
  const L = [];
  L.push(`# Wake check${meta.label ? ` — ${meta.label}` : ""} — **${v.overall}**`, "");
  L.push(`- base ${meta.base} (${meta.baseKind}${meta.prod ? ", --prod-readonly" : ""}) · event ${meta.eventId} · path \`${meta.eventPath}\` · live ${meta.pagesPerLocale} × ${meta.locales.join("/")} + poll-only ${meta.pollOnly} + post-save ${v.postRows.length}`);
  L.push(`- host \`${meta.host}\` · opened ${meta.startedAt} · READY ${iso(v.readyAt)} UTC (baseline rev ${v.baselineRev}) · ended ${meta.endedAt} by ${meta.endReason}`);
  L.push("- clock: this host's clock (UTC); page-side DOM times use the same OS clock");
  if (meta.deployment) L.push(`- expected deployment ${meta.deployment}`);
  L.push(`- revs observed above the baseline: ${v.info.revsObserved.join(", ") || "none"}${v.info.gapMs != null ? ` · R1→R2 gap ${Math.round(v.info.gapMs / 1000)} s` : ""}`);
  L.push(`- informational: non-GET requests the pages tried (aborted) ${v.info.blockedWrites} · failed /api or /_next requests ${v.info.failedReqs}`);
  L.push("", "## Verdict", "", "| check | result | detail |", "|---|---|---|");
  for (const [k, c] of Object.entries(v.checks)) L.push(`| ${NAMES[k] ?? k} | ${c.status === "PASS" ? "PASS" : `**${c.status}**`} | ${c.detail} |`);
  if (Object.keys(v.warm).length) {
    L.push("", "## Warm publication (informational)", "", "Hinted fetches for the check save answered `x-snapshot-source: warm`. Which instance served them is not in any response header (x-vercel-id = edge PoP :: function region :: request id): join the request ids below with `vercel logs` (`[liveWriter] instance=` vs the read) to say \"warm read on a different instance\".", "");
    L.push("| locale | warm read observed | hinted | warm | sources | warm request ids |", "|---|---|---|---|---|---|");
    for (const [loc, w] of Object.entries(v.warm)) L.push(`| ${loc} | ${w.status} | ${w.hinted} | ${w.warm} | ${Object.entries(w.sources).map(([k, n]) => `${k} ${n}`).join(", ") || "–"} | ${w.warmReqIds.join(", ") || "–"} |`);
  }
  L.push("", "## Pages", "", "Times in ms from navigation start (this host's clock).", "");
  L.push("| page | role | locale | visibility | doc | load ms | TTFB | DCL | first rows ms (rows) | WS open ms | joined ms | sockets open / closed | reloads | page errors | 5xx | SSR seed | data-dpl-id |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const p of v.pages) {
    L.push(`| ${p.idx} | ${p.role} | ${p.locale} | ${p.visibility ?? "–"} | ${p.docStatus ?? "–"} | ${p.loadMs ?? "–"} | ${p.ttfbMs ?? "–"} | ${p.dclMs ?? "–"} | ${p.firstRowsMs ?? "–"} (${p.rows}) | ${p.wsOpenMs ?? "–"} | ${p.joinedMs ?? "–"} | ${p.wsOpens} / ${p.wsCloses} | ${p.reloads} | ${p.pageErrors} | ${p.fiveXX} | ${p.seed ? `${p.seed.kind} ${p.seed.rev ?? ""}` : "–"} | ${p.dplId ?? "–"}${p.dplMatch === false ? " **≠**" : ""} |`);
  }
  for (const pr of v.perRev) {
    L.push("", `## rev ${pr.rev} — live pages`, "", "Frame = the `rev` broadcast arrived on the page's websocket; DOM = the rows' visible text changed. Separate events, separate columns.", "");
    L.push("| page | locale | frame received (UTC) | response rev ≥ R (UTC) | source / verify / hint | DOM updated (UTC) | frame→DOM ms | ≤ budget |", "|---|---|---|---|---|---|---|---|");
    for (const x of pr.rows) {
      const h = x.resp ? `${x.resp.source ?? "–"} / ${x.resp.verify ?? "–"} / ${x.resp.hint ? "hint" : "no hint"}` : "–";
      const ok = x.frameToDomMs != null && x.frameToDomMs <= DOM_BUDGET_MS;
      L.push(`| ${x.idx} | ${x.locale} | ${iso(x.frameAt)} | ${iso(x.respAt)} | ${h} | ${iso(x.domAt)} | ${x.frameToDomMs ?? "–"} | ${ok ? "yes" : "**no**"} |`);
    }
  }
  if (v.pollRows.length) {
    L.push("", "## Poll-only pages (websocket blocked)", "", "Save→visible is measured from the first broadcast frame any live page received.", "");
    L.push("| page | locale | frames (must be 0) | response rev ≥ R (UTC) | source / verify | DOM updated (UTC) | save→visible ms |", "|---|---|---|---|---|---|---|");
    for (const x of v.pollRows) L.push(`| ${x.idx} | ${x.locale} | ${x.frames} | ${iso(x.respAt)} | ${x.resp ? `${x.resp.source ?? "–"} / ${x.resp.verify ?? "–"}` : "–"} | ${iso(x.domAt)} | ${x.saveToVisibleMs ?? "–"} |`);
  }
  if (v.postRows.length) {
    L.push("", "## Post-save loads", "", "| page | locale | first paint (UTC) | SSR seed | seed ≥ R1 | first paint = live content | first /api/setlist: status / source / verify / body rev | x-vercel-id |", "|---|---|---|---|---|---|---|---|");
    for (const x of v.postRows) L.push(`| ${x.idx} | ${x.locale} | ${iso(x.firstPaintAt)} | ${x.seed ? `${x.seed.kind} ${x.seed.rev ?? ""}` : "–"} | ${x.seedOk ? "yes" : "**no**"} | ${x.contentMatch ? "yes" : "**no**"} | ${x.firstFetch ? `${x.firstFetch.status} / ${x.firstFetch.source ?? "–"} / ${x.firstFetch.verify ?? "–"} / ${x.firstFetch.bodyRev ?? "–"}` : "–"} | ${x.firstFetch?.vercelId ?? "–"} |`);
  }
  if (!v.perRev.length) L.push("", "No rev change was observed before the window ended — the check save was not made (or did not reach any page).");
  return L.join("\n") + "\n";
}

// Locale and role of every page index, fixed up front: live pages, then
// the poll-only ones, then the post-save ones (opened later by
// `extend`). launchPages picks `localeOf[idx % length]`, so a list as
// long as the whole population maps every index directly.
export function pagePlan({ locales, pages, pollOnly }) {
  const plan = [];
  for (let i = 0; i < pages * locales.length; i++) plan.push({ role: "live", locale: locales[i % locales.length] });
  for (let i = 0; i < pollOnly; i++) plan.push({ role: "poll", locale: locales[i % locales.length] });
  for (const l of locales) plan.push({ role: "postsave", locale: l });
  return plan;
}

// ─── runner ───

// The canonical event path (after the locale), via the bare-id redirect.
async function resolveEventPath(base, eventId) {
  const res = await fetch(`${base}/ja/events/${eventId}`, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(20_000) });
  await res.arrayBuffer().catch(() => {});
  if (res.status === 200) return `/events/${eventId}`;
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location") ?? "";
    const m = /\/ja(\/events\/\d+(?:\/[a-z0-9-]+)?)$/.exec(new URL(loc, base).pathname);
    if (m && m[1].split("/")[2] === String(eventId)) return m[1];
  }
  throw new Error(`GET /ja/events/${eventId} answered ${res.status} — wrong event id or base?`);
}

async function plainRev(base, eventId) {
  try {
    const res = await fetch(`${base}/api/setlist?eventId=${eventId}&locale=ja`, { signal: AbortSignal.timeout(15_000) });
    const body = await res.json().catch(() => null);
    return Number.isSafeInteger(body?.rev) ? body.rev : null;
  } catch { return null; }
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const { errors, config: cfg } = validateWakeCheck(args, argv.filter((a) => !a.startsWith("--")));
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(2);
  }
  const now = new Date();
  const startedAt = Date.now();
  const outDir = cfg.out ?? path.join(HERE, "results", now.toISOString().slice(0, 10));
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const outBase = path.join(outDir, `${stamp}-wake-check${cfg.label ? `-${cfg.label}` : ""}`);
  const stopFile = cfg.stopFile ?? path.join(outDir, "wake-check.STOP");
  const log = (m) => console.log(`${new Date().toISOString().slice(11, 23)} ${m}`);

  let eventPath = cfg.eventPath;
  if (args["event-path"] === undefined) {
    try { eventPath = await resolveEventPath(cfg.base, cfg.eventId); } catch (e) {
      console.error(String(e.message));
      process.exit(2);
    }
  }
  const meta = {
    host: os.hostname(), base: cfg.base, baseKind: cfg.baseKind, prod: cfg.prod, eventId: cfg.eventId, eventPath,
    locales: cfg.locales, pagesPerLocale: cfg.pages, pollOnly: cfg.pollOnly, waitS: cfg.waitS, deployment: cfg.deployment, label: cfg.label,
    stopFile, startedAt: now.toISOString(), endedAt: null, endReason: null,
  };
  const plan = pagePlan(cfg);
  const initial = cfg.pages * cfg.locales.length + cfg.pollOnly;
  log(`wake-check: ${cfg.pages} × ${cfg.locales.join("/")} live + ${cfg.pollOnly} poll-only pages on ${cfg.base}/<locale>${eventPath} (read-only)`);

  const { launchPages } = await import("./browsers/pages.mjs");
  const pop = await launchPages({
    count: initial, base: cfg.base, eventPath, eventId: cfg.eventId,
    localeOf: plan.map((p) => p.locale),
    routeMode: (idx) => (plan[idx]?.role === "poll" ? "blocked" : "none"),
    headless: !cfg.headed, concurrency: 3, log, admission: true, transition: true, cohort: "wake",
    rowText: true, readOnly: true,
  });
  const recs = () => pop.pages.filter(Boolean).map((p) => Object.assign(p.rec, { role: plan[p.rec.idx]?.role ?? "live" }));
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const fetched = recs().flatMap((r) => r.fetches.map((f) => f[4])).filter(Number.isSafeInteger);
  const plain = await plainRev(cfg.base, cfg.eventId);
  const baselineRev = Math.max(-1, plain ?? -1, ...fetched);
  const readyAt = Date.now();
  console.log(`[wake-check] READY pages=${initial} joined=${pop.joined()}/${initial} baseline_rev=${baselineRev} at=${new Date(readyAt).toISOString()} — make the check save now; waiting up to ${cfg.waitS} s (STOP file: ${stopFile})`);

  const announced = new Set();
  let postsave = null; // the extend() promise, once started
  const endReason = await new Promise((resolve) => {
    const end = setTimeout(() => { clearInterval(tick); resolve("wait-s"); }, cfg.waitS * 1000);
    const tick = setInterval(() => {
      try {
        if (fs.statSync(stopFile).mtimeMs >= startedAt) { clearTimeout(end); clearInterval(tick); resolve("STOP file"); return; }
      } catch { /* none */ }
      const rs = recs().filter((r) => r.role === "live");
      const revs = observedRevs(rs, baselineRev);
      for (const rev of revs) {
        const framed = rs.filter((r) => r.bcasts.some((b) => b[1] === rev)).length;
        const key = `${rev}:${framed}`;
        if (!announced.has(key)) { announced.add(key); log(`rev ${rev}: broadcast frame at ${framed}/${rs.length} live pages`); }
      }
      if (revs.length && postsave == null) {
        postsave = new Promise((r) => setTimeout(r, POSTSAVE_DELAY_MS))
          .then(() => { log(`opening ${cfg.locales.length} post-save page(s)`); return pop.extend({ count: cfg.locales.length, cohort: "postsave" }); })
          .catch((e) => log(`post-save load failed: ${String(e?.message || e).slice(0, 120)}`));
      }
    }, 1000);
    const sig = () => { clearTimeout(end); clearInterval(tick); resolve("SIGINT"); };
    process.once("SIGINT", sig);
    process.once("SIGTERM", sig);
  });
  if (postsave) await postsave;

  // Snapshot BEFORE closing: closing a page closes its socket and would
  // count as a websocket close.
  const snap = JSON.parse(JSON.stringify(recs()));
  meta.endedAt = new Date().toISOString();
  meta.endReason = endReason;
  await pop.close();
  const v = wakeVerdict({ recs: snap, baselineRev, readyAt, deployment: cfg.deployment });
  fs.writeFileSync(`${outBase}.json`, JSON.stringify({ meta, verdict: v, pages: snap }, null, 2));
  const md = wakeMarkdown(v, meta);
  fs.writeFileSync(`${outBase}.md`, md);
  console.log(md);
  log(`wrote ${outBase}.{json,md}`);
  process.exit(v.overall === "FAIL" ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
