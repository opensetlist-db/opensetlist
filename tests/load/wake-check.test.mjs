// node --test tests/load/wake-check.test.mjs
//
// Two live pages (ja, ko), one websocket-blocked poll page (ja), two
// post-save loads (ja, ko). Check save = rev 41, second save = rev 42.
import test from "node:test";
import assert from "node:assert/strict";
import { wakeVerdict, wakeMarkdown, observedRevs, pageRev, pagePlan, DOM_BUDGET_MS, POLL_REPAIR_BUDGET_MS } from "./wake-check.mjs";

const T = Date.UTC(2026, 10, 14, 7, 20, 0, 0);
// fetch row: [t, minRev, status, source, rev, verify, hint, reqStart, capturedAt, x-vercel-id]
const f = (t, rev, { minRev = null, hint = false, source = "cache", status = 200, vid = null } = {}) => [t, minRev, status, source, rev, hint ? "satisfied" : "none", hint, t - 100, null, vid];
const base = (idx, locale, role, extra = {}) => ({
  idx, locale, role, url: `https://x/${locale}/events/107/y`, visibility: "visible",
  openedAt: T - 30000, loadedAt: T - 27000, navStart: T - 30000, ttfbMs: 400, dclMs: 1200, docStatus: 200,
  wsOpenAt: T - 28000, wsOpens: 1, wsCloses: 0, joinAt: [T - 27500],
  navs: [[T - 29600, "https://x", 200, "icn1::icn1::doc", "dpl_NEW"]], docDplId: "dpl_NEW",
  // a font the resource diet aborted: not a site failure
  pageErrs: [], reqFailed: [[T - 29000, "/_next/static/media/a.woff2", "net::ERR_FAILED"]], assets: [[T - 29000, 200, "dpl_NEW", "/_next/a.js"]], blockedWrites: [], errors: [],
  bcasts: [], fetches: [f(T - 27000, 40)], rowTextLog: [[T - 29500, 20, "20:aaaa"]], seed: { kind: "live", rev: 40 },
  ...extra,
});
const recs = () => [
  base(0, "ja", "live", {
    bcasts: [[T + 10000, 41, "n"], [T + 400000, 42, "n"]],
    fetches: [f(T - 27000, 40), f(T + 10300, 41, { minRev: 41, hint: true, source: "warm", vid: "icn1::icn1::w1" }), f(T + 400300, 42, { minRev: 42, hint: true, source: "warm" })],
    rowTextLog: [[T - 29500, 20, "20:aaaa"], [T + 10400, 21, "21:bbbb"], [T + 400500, 20, "20:cccc"]],
  }),
  base(1, "ko", "live", {
    bcasts: [[T + 10020, 41, "n"], [T + 400010, 42, "n"]],
    fetches: [f(T - 27000, 40), f(T + 10500, 41, { minRev: 41, hint: true, source: "repair" }), f(T + 400200, 42, { minRev: 42, hint: true, source: "warm" })],
    rowTextLog: [[T - 29500, 20, "20:kkkk"], [T + 10600, 21, "21:kkk2"], [T + 400300, 20, "20:kkk3"]],
  }),
  base(2, "ja", "poll", {
    wsOpenAt: null, wsOpens: 4, wsCloses: 4, joinAt: [],
    fetches: [f(T - 27000, 40), f(T + 14000, 41, { minRev: 40 })],
    rowTextLog: [[T - 29500, 20, "20:aaaa"], [T + 14100, 21, "21:bbbb"]],
  }),
  base(3, "ja", "postsave", {
    openedAt: T + 15000, navStart: T + 15000, seed: { kind: "live", rev: 41 },
    fetches: [f(T + 17000, 41, { minRev: 41, source: "cache", vid: "icn1::icn1::p1" })],
    // streamed HTML: a partial paint first, the full list by DCL
    rowTextLog: [[T + 15300, 14, "14:part"], [T + 15800, 21, "21:bbbb"]],
  }),
  base(4, "ko", "postsave", {
    openedAt: T + 15000, navStart: T + 15000, seed: { kind: "live", rev: 41 },
    fetches: [f(T + 17000, 41, { minRev: 41 })],
    rowTextLog: [[T + 15800, 21, "21:kkk2"]],
  }),
];

test("plan: live per locale, then poll-only, then one post-save per locale", () => {
  assert.deepEqual(pagePlan({ locales: ["ja", "ko"], pages: 2, pollOnly: 1 }).map((p) => `${p.role}:${p.locale}`),
    ["live:ja", "live:ko", "live:ja", "live:ko", "poll:ja", "postsave:ja", "postsave:ko"]);
  assert.equal(POLL_REPAIR_BUDGET_MS, 9000);
});

test("revs above the baseline; frame and DOM kept apart per page", () => {
  assert.deepEqual(observedRevs(recs(), 40), [41, 42]);
  const pr = pageRev(recs()[0], 41, T);
  assert.equal(pr.frameAt, T + 10000);
  assert.equal(pr.respAt, T + 10300);
  assert.equal(pr.domAt, T + 10400);
  assert.equal(pr.frameToDomMs, 400);
  assert.equal(pr.resp.source, "warm");
});

test("all good → PASS with every check", () => {
  const v = wakeVerdict({ recs: recs(), baselineRev: 40, readyAt: T, deployment: "dpl_NEW" });
  for (const [k, c] of Object.entries(v.checks)) assert.equal(c.status, "PASS", `${k}: ${c.detail}`);
  assert.equal(v.overall, "PASS");
  assert.equal(v.perRev[1].rows[0].frameToDomMs, 500);
  assert.equal(v.pollRows[0].saveToVisibleMs, 4100);
  assert.equal(v.postRows.every((x) => x.seedOk && x.contentMatch), true);
  assert.equal(v.warm.ja.status, "yes");
  assert.deepEqual(v.warm.ja.warmReqIds, ["w1"]);
  assert.equal(v.warm.ko.status, "no");
  assert.equal(v.info.gapMs, 390000);
  assert.equal(v.info.failedReqs, 0);
  assert.equal(v.postRows[0].firstPaintAt, T + 15800);
  const md = wakeMarkdown(v, { base: "https://opensetlist.com", baseKind: "prod", prod: true, eventId: "107", eventPath: "/events/107/y", locales: ["ja", "ko"], pagesPerLocale: 1, pollOnly: 1, host: "h", startedAt: "s", endedAt: "e", endReason: "wait-s", deployment: "dpl_NEW" });
  assert.match(md, /# Wake check — \*\*PASS\*\*/);
  assert.match(md, /\| 0 \| ja \| 07:20:10\.000 \| 07:20:10\.300 \| warm \/ satisfied \/ hint \| 07:20:10\.400 \| 400 \| yes \|/);
  assert.match(md, /Poll-only pages/);
  assert.match(md, /Post-save loads/);
  assert.match(md, /\| ja \| yes \| 1 \| 1 \| warm 1 \| w1 \|/);
});

test("failures: late DOM, missing frame, socket closed, reload, stale SSR, hidden tab", () => {
  const r = recs();
  r[1].rowTextLog[1] = [T + 10020 + DOM_BUDGET_MS + 1, 21, "21:kkk2"];
  r[0].bcasts = r[0].bcasts.filter((b) => b[1] !== 42);
  r[0].wsCloses = 1;
  r[1].navs.push([T + 200000, "https://x", 200, "icn1::icn1::doc2", "dpl_NEW"]);
  r[3].seed = { kind: "live", rev: 40 };
  r[4].rowTextLog = [[T + 15800, 20, "20:kkkk"]];
  r[2].visibility = "hidden";
  const v = wakeVerdict({ recs: r, baselineRev: 40, readyAt: T });
  assert.equal(v.overall, "FAIL");
  assert.equal(v.checks.firstBudget.status, "FAIL");
  assert.equal(v.checks.secondFrame.status, "FAIL");
  assert.equal(v.checks.wsNeverClosed.status, "FAIL");
  assert.equal(v.checks.noReloads.status, "FAIL");
  assert.equal(v.checks.postSave.status, "FAIL");
  assert.equal(v.checks.foreground.status, "FAIL");
  // the poll page's blocked socket attempts never count as closes
  assert.doesNotMatch(v.checks.wsNeverClosed.detail, /page 2/);
});

test("a 308 hop is not a reload; a poll page that got a frame fails", () => {
  const r = recs();
  r[0].navs = [[T - 29700, "https://x/ja/events/107", 308, null, null], ...r[0].navs];
  r[2].bcasts = [[T + 10000, 41, "n"]];
  const v = wakeVerdict({ recs: r, baselineRev: 40, readyAt: T });
  assert.equal(v.checks.noReloads.status, "PASS");
  assert.equal(v.checks.pollOnly.status, "FAIL");
});

test("only the check save observed → NOT EXERCISED (exit 4), never PASS; --expect-saves=1 → PASS", () => {
  const one = () => recs().map((x) => ({
    ...x,
    bcasts: x.bcasts.filter((b) => b[1] !== 42),
    fetches: x.fetches.filter((q) => q[4] !== 42),
    rowTextLog: x.rowTextLog.filter((t) => t[0] < T + 300000),
  }));
  const v = wakeVerdict({ recs: one(), baselineRev: 40, readyAt: T });
  assert.equal(v.checks.firstBudget.status, "PASS");
  assert.equal(v.checks.secondSeen.status, "NOT EXERCISED");
  assert.equal(v.overall, "NOT EXERCISED");
  assert.deepEqual(v.info.savesObserved, [41]);
  const md = wakeMarkdown(v, { base: "b", baseKind: "dev", eventId: "111", eventPath: "/events/111", locales: ["ja", "ko"], pagesPerLocale: 1, pollOnly: 1, host: "h", startedAt: "s", endedAt: "e", endReason: "wait-s" });
  assert.match(md, /saves observed: 1 of 2 expected \(check save R1: rev 41 · second save R2: \*\*not observed\*\*\)/);
  assert.match(md, /NOT EXERCISED because:\*\* 1 of 2 expected save\(s\) observed/);
  assert.equal(wakeVerdict({ recs: one(), baselineRev: 40, readyAt: T, expectSaves: 1 }).overall, "PASS");
});

test("no websocket-blocked page → poll check and overall NOT EXERCISED", () => {
  const v = wakeVerdict({ recs: recs().filter((x) => x.role !== "poll"), baselineRev: 40, readyAt: T });
  assert.equal(v.checks.pollOnly.status, "NOT EXERCISED");
  assert.equal(v.overall, "NOT EXERCISED");
  assert.deepEqual(v.info.notExercised, ["no websocket-blocked page"]);
});

test("no save in the window → NOT EXERCISED (not FAIL), timing out gracefully", () => {
  const r = recs().filter((x) => x.role !== "postsave").map((x) => ({ ...x, bcasts: [], fetches: [x.fetches[0]], rowTextLog: [x.rowTextLog[0]] }));
  const v = wakeVerdict({ recs: r, baselineRev: 40, readyAt: T });
  assert.equal(v.overall, "NOT EXERCISED");
  assert.equal(v.checks.firstSeen.status, "NOT EXERCISED");
  assert.equal(v.checks.pollOnly.status, "NOT EXERCISED");
  assert.equal(v.checks.postSave.status, "NOT EXERCISED");
  assert.equal(v.checks.noReloads.status, "PASS");
});
