// node --test tests/load/overlap-join.test.mjs
//
// Synthetic history-mode logs in the step-4 field contract (every
// writer / warm / expire line carries explicit server `at*` epoch ms),
// one overlap group per case, classified by overlap-join.mjs (design
// §2.5 (i)–(iv), "indeterminate", publication = ok sets only, probes on
// the actual revs, S3, the exercised-group minimum), plus warm-join's
// explicit-`at` offsets next to its rebuilt fallback.
import test from "node:test";
import assert from "node:assert/strict";
import { join, classifyGroup, serverRecords, publicationOrder, minExercised, scenarioOf, exercisedFor, faultLabel, todToEpoch, toMarkdown } from "./overlap-join.mjs";
import { localeOffsets, join as warmJoin } from "./warm-join.mjs";
import { probePlan } from "./browsers/overlap.mjs";

const T = Date.UTC(2026, 9, 11, 14, 10, 0, 0);
const HDR = (path, method = "PUT") => `14:10:00.00  opensetlist-x.vercel.app  info     ${method} ${path}`;

// One warm job's lines. `sets` = { locale: { ok, at, txS, txE, bS, bE, cap, setS, rev, hold } } (offsets from T).
function job({ rev, inst, startAt, sets, fault = null, skipMissing = true }) {
  const L = [`[liveWarm] start event=111 rev=${rev} at=${T + startAt} instance=${inst}${fault ? ` fault=${fault} source=header` : ""}`];
  for (const [locale, x] of Object.entries(sets)) {
    L.push(`[liveWarm] set event=111 locale=${locale} atLeastRev=${rev} rev=${x.rev ?? rev} bytes=1000 buildMs=${x.bE - x.bS} setMs=5 ok=${x.ok !== false} buildStartAt=${T + x.bS} buildEndAt=${T + x.bE} txStartAt=${x.txS == null ? "-" : T + x.txS} txEndAt=${x.txE == null ? "-" : T + x.txE} holdMs=${x.hold ?? 0} captureAt=${T + (x.cap ?? x.txS ?? x.bS)} setStartAt=${T + (x.setS ?? x.bE)} at=${T + x.at} instance=${inst}`);
  }
  // Locales a fixture leaves out were skipped by the job (a complete
  // record: every locale leaves a set or a skip line). `skipMissing: false`
  // simulates a capture gap instead.
  if (skipMissing) {
    for (const locale of ["ja", "ko", "en"].filter((l) => !(l in sets))) {
      L.push(`[liveWarm] skip event=111 locale=${locale} atLeastRev=${rev} reason=fault-locale rev=- bytes=- buildMs=0 buildStartAt=${T + startAt + 1} buildEndAt=${T + startAt + 1} at=${T + startAt + 1} instance=${inst}`);
    }
  }
  L.push(`[liveWarm] done event=111 rev=${rev} ms=999 at=${T + startAt + 999} instance=${inst}`);
  return L;
}
const writer = (rev, at, inst, acquire = 3) => `[liveWriter] route=update acquireMs=${acquire} execMs=40 rev=${rev} ok=true at=${T + at} instance=${inst}`;
const entry = (lines, path = "/api/admin/setlist-items/5", method = "PUT") => [HDR(path, method), ...lines, ""].join("\n");

const set = (o) => ({ ok: true, bS: 0, bE: 100, ...o });

// Group: A rev 20 (instance a), B rev 21 (instance b) 250 ms later.
function groupLog({ aSets, bSets, aFault = null }) {
  return [
    entry([writer(20, 50, "a"), ...job({ rev: 20, inst: "a", startAt: 60, sets: aSets, fault: aFault })]),
    entry([writer(21, 300, "b"), ...job({ rev: 21, inst: "b", startAt: 310, sets: bSets })], "/api/admin/setlist-items/6"),
  ].join("\n");
}
const G = { k: 1, saves: [{ who: "A", rev: 20, status: 200 }, { who: "B", rev: 21, status: 200 }], anchor: { firstStart: T, committed: [{ who: "A", rev: 20 }, { who: "B", rev: 21 }] } };

test("(i) B during A — publication = ok sets only", () => {
  const bSets = { ja: set({ bS: 320, bE: 420, txS: 330, txE: 420, at: 430 }) };
  // A's last ok set at 900 > B commit 300 → yes.
  let c = classifyGroup(G, serverRecords(groupLog({ aSets: { ja: set({ bS: 70, bE: 200, txS: 80, txE: 200, at: 900 }) }, bSets })));
  assert.equal(c.i, true);
  // A's only set failed (ok=false) at 900: publication never happened →
  // (i) is not "yes", it is n/a with the reason.
  c = classifyGroup(G, serverRecords(groupLog({ aSets: { ja: set({ ok: false, bS: 70, bE: 200, txS: 80, txE: 200, at: 900 }) }, bSets })));
  assert.equal(c.i, null);
  assert.match(c.iWhy, /published nothing/);
  // A published before B committed → no.
  c = classifyGroup(G, serverRecords(groupLog({ aSets: { ja: set({ bS: 70, bE: 200, txS: 80, txE: 200, at: 250 }) }, bSets })));
  assert.equal(c.i, false);
});

test("(ii) tx-interval overlap excludes queued time; build overlap reported apart", () => {
  // A holds a connection 80..200; B's build starts at 150 but only gets
  // its connection (txStart) at 250 → DB occupancy did not overlap.
  const c = classifyGroup(G, serverRecords(groupLog({
    aSets: { ja: set({ bS: 70, bE: 200, txS: 80, txE: 200, at: 210 }) },
    bSets: { ja: set({ bS: 150, bE: 350, txS: 250, txE: 340, at: 360 }) },
  })));
  assert.equal(c.ii, false);
  assert.equal(c.iiBuild, true);
  const c2 = classifyGroup(G, serverRecords(groupLog({
    aSets: { ja: set({ bS: 70, bE: 1700, txS: 80, txE: 1700, at: 1710, hold: 1500 }) },
    bSets: { ja: set({ bS: 320, bE: 500, txS: 330, txE: 490, at: 510 }) },
  })));
  assert.equal(c2.ii, true);
  assert.equal(c2.holdMs, 1500);
  assert.equal(exercisedFor("S6", c2), true);
});

test("(iii) reversed / in order / indeterminate (< 100 ms across instances)", () => {
  const c = classifyGroup(G, serverRecords(groupLog({
    aSets: {
      ja: set({ bS: 70, bE: 200, txS: 80, txE: 200, setS: 210, at: 1700 }), // slowset: late
      ko: set({ bS: 70, bE: 200, txS: 80, txE: 200, at: 450 }), // 50 ms before B's ko → indeterminate
      en: set({ bS: 200, bE: 300, txS: 210, txE: 300, at: 310 }),
    },
    bSets: {
      ja: set({ bS: 320, bE: 420, txS: 330, txE: 420, at: 430 }),
      ko: set({ bS: 320, bE: 490, txS: 330, txE: 490, at: 500 }),
      en: set({ bS: 420, bE: 600, txS: 430, txE: 600, at: 610 }),
    },
  })));
  assert.deepEqual(c.iii, { ja: "reversed", ko: "indeterminate", en: "in order" });
  assert.equal(exercisedFor("S2", c), true);
  // Same instance = one clock: 50 ms is an order.
  assert.equal(publicationOrder({ at: 150 }, { at: 100 }, { sameInstance: true }), "reversed");
  assert.equal(publicationOrder({ at: 150 }, { at: 100 }, { sameInstance: false }), "indeterminate");
  assert.equal(publicationOrder(null, { at: 100 }), "n/a");
});

test("(iv) catalog race per locale, B gone, stale content-proven + censored", () => {
  // expire-warm of the catalog PUT on song 900: start 500, done 560.
  const log = [
    groupLog({
      aSets: {
        ja: set({ bS: 70, bE: 200, txS: 80, txE: 200, cap: 85, setS: 1700, at: 1710 }), // captured before, set after → race
        ko: set({ bS: 70, bE: 200, txS: 80, txE: 200, cap: 85, setS: 210, at: 220 }), // set before the expiry → no race
        en: set({ bS: 600, bE: 700, txS: 610, txE: 700, cap: 610, setS: 1700, at: 1710 }), // captured after → no
      },
      bSets: {
        ja: set({ bS: 320, bE: 420, txS: 330, txE: 420, at: 430 }),
        ko: set({ bS: 320, bE: 420, txS: 330, txE: 420, at: 430 }),
        en: set({ bS: 320, bE: 420, txS: 330, txE: 420, at: 430 }),
      },
    }),
    entry([`[dataCache] expire-warm phase=start at=${T + 500} instance=c`, `[dataCache] expire-warm phase=done ok=true ms=60 at=${T + 560} instance=c`], "/api/admin/songs/900"),
  ].join("\n");
  const row = (t, locale, key, src, title) => [T + t, locale, key, 200, src, 21, T + t - 10, title, T + t + 50];
  const g = {
    ...G,
    catalog: { songId: "900", from: "old-title", to: "old-title-c1", startedAt: T + 400, ackAt: T + 900 },
    probes: [
      { off: 1000, who: "B", row: row(1500, "ja", 21, "build", "old-title-c1") }, // B's key gone after the expiry
      { off: 1000, who: "A", row: row(1500, "ja", 20, "build", "old-title-c1") },
      { off: 2000, who: "A", row: row(2500, "ja", 20, "warm", "old-title") }, // A's late fill: stale, by content
      { off: 4000, who: "A", row: row(4500, "ja", 20, "warm", "old-title") }, // still stale at the last probe → censored
      { off: 2000, who: "A", row: row(2500, "ko", 20, "warm", "old-title-c1") }, // warm but the NEW title: not stale
    ],
  };
  const c = classifyGroup(g, serverRecords(log));
  assert.equal(c.iv.expStartAt, T + 500);
  assert.equal(c.iv.locales.ja.race, true);
  assert.equal(c.iv.locales.ja.bGone, true);
  assert.equal(c.iv.locales.ja.staleN, 2);
  assert.equal(c.iv.locales.ja.censored, true);
  assert.equal(c.iv.locales.ko.race, false);
  assert.match(c.iv.locales.ko.why.join(";"), /set started before the expiry finished/);
  assert.equal(c.iv.locales.ko.staleN, 0);
  assert.equal(c.iv.locales.en.race, false);
  assert.match(c.iv.locales.en.why.join(";"), /captured after/);
  assert.equal(exercisedFor("S5", c), true);
});

test("S3: A builds and publishes nothing, A's key misses while B warms", () => {
  const lookups = [
    HDR("/api/setlist", "GET"),
    `[setlist] warm-lookup event=111 locale=ja minRev=20 result=miss ms=5 at=${T + 400} instance=r`,
    `[setlist] warm-lookup event=111 locale=ja minRev=20 result=memo-miss ms=0 at=${T + 405} instance=r`,
    `[setlist] warm-lookup event=111 locale=ja minRev=20 result=miss ms=5 at=${T + 5000} instance=r`, // after B finished
    "",
  ].join("\n");
  const failed = (o) => set({ ok: false, ...o });
  const log = groupLog({
    aSets: { ja: failed({ txS: 80, txE: 200, at: 210 }), ko: failed({ txS: 80, txE: 200, at: 210 }), en: failed({ txS: 210, txE: 300, at: 310 }) },
    bSets: { ja: set({ bS: 320, bE: 420, txS: 330, txE: 420, at: 430 }), ko: set({ bS: 320, bE: 420, txS: 330, txE: 420, at: 600 }) },
  }) + "\n" + lookups;
  const c = classifyGroup(G, serverRecords(log));
  assert.deepEqual(c.s3, { failedSets: 3, publishedSets: 0, missesDuringB: 2, exercised: true });
  assert.equal(c.i, null); // A published nothing
  // Lookup lines without `at` fall back to the entry time (log clock +
  // add-hours, same UTC day as the reference).
  assert.equal(todToEpoch(14 * 3600 + 10 * 60, 0, T + 500), T);
  assert.equal(todToEpoch(7 * 3600 + 10 * 60, 7, T), T);
});

test("probes target the ACTUAL committed revs, never R+1", () => {
  // Lock order made B commit 22 (a third party committed 21 between).
  const plan = probePlan([{ who: "A", rev: 20 }, { who: "B", rev: 22 }], ["ja"], [1000]);
  assert.deepEqual(plan.map((x) => [x.who, x.rev]), [["A", 20], ["B", 22]]);
  assert.ok(!plan.some((x) => x.rev === 21));
});

test("exercised-group minimum, scenario detection, verdict", () => {
  assert.equal(minExercised("S1", 6), 4);
  assert.equal(minExercised("S5", 6), 3);
  assert.equal(minExercised("S0", 6), null);
  assert.equal(scenarioOf({ gapMs: 250, thirdAtMs: 0, faultA: null, catalogAtMs: 0 }), "S1");
  assert.equal(scenarioOf({ gapMs: 3000, thirdAtMs: 0, faultA: null, catalogAtMs: 0 }), "S0");
  assert.equal(scenarioOf({ gapMs: 250, thirdAtMs: 500, faultA: null, catalogAtMs: 0 }), "S4");
  assert.equal(scenarioOf({ gapMs: 250, thirdAtMs: 0, faultA: "slowset=1500", catalogAtMs: 400 }), "S5");
  assert.equal(scenarioOf({ gapMs: 250, thirdAtMs: 0, faultA: "slowset=1500", catalogAtMs: 0 }), "S2");
  assert.equal(scenarioOf({ gapMs: 250, thirdAtMs: 500, faultA: "slowbuild=1500", catalogAtMs: 0 }), "S6");
  assert.equal(faultLabel("slowset=300,locale=ja"), "slowset:300+locale:ja");

  // A run of 6 groups where only the first 3 had overlapping builds: S1
  // needs 4 → NOT EXERCISED; the fault evidence and acquire gate per group.
  const logs = [];
  const groups = [];
  for (let k = 0; k < 6; k++) {
    const ra = 20 + 2 * k;
    const off = k * 10000;
    const overlap = k < 3;
    logs.push(entry([writer(ra, off + 50, "a"), ...job({ rev: ra, inst: "a", startAt: off + 60, sets: { ja: set({ bS: off + 70, bE: off + 700, txS: off + 80, txE: off + 700, at: off + 710 }) } })]));
    const bS = overlap ? off + 320 : off + 800;
    logs.push(entry([writer(ra + 1, off + 300, "b", k === 5 ? 900 : 3), ...job({ rev: ra + 1, inst: "b", startAt: off + 310, sets: { ja: set({ bS, bE: bS + 100, txS: bS + 10, txE: bS + 100, at: bS + 110 }) } })], "/api/admin/setlist-items/6"));
    groups.push({ k: k + 1, saves: [{ who: "A", rev: ra, status: 200 }, { who: "B", rev: ra + 1, status: 200 }], anchor: { firstStart: T + off, committed: [{ who: "A", rev: ra }, { who: "B", rev: ra + 1 }] } });
  }
  const json = { config: { overlap: { gapMs: 250, thirdAtMs: 0, faultA: null, catalogAtMs: 0 } }, overlap: { groups, gates: [], pass: true }, probe: { groups: [] } };
  const j = join(json, logs.join("\n"));
  assert.equal(j.scenario, "S1");
  assert.equal(j.exercisedN, 3);
  assert.equal(j.min, 4);
  assert.match(j.verdict, /^NOT EXERCISED \(3\/6 < 4\)/);
  assert.equal(j.groups[5].acquireOk, false);
  assert.equal(j.groups[0].faultOk, true); // no fault intended, none logged
  assert.match(toMarkdown(j), /Scenario \*\*S1\*\*: \*\*NOT EXERCISED/);
});

test("writer `at` alone is not classifiable: warm lines without at/txStartAt → UNCLASSIFIABLE, never NOT EXERCISED", () => {
  // Writer lines carry `at`, the job lines do not (a server with only the
  // writer half of the field contract, or a capture that lost the fields).
  const bare = (rev, inst, startAt) => [
    `[liveWarm] start event=111 rev=${rev} instance=${inst}`,
    `[liveWarm] set event=111 locale=ja atLeastRev=${rev} rev=${rev} bytes=1000 buildMs=100 setMs=5 ok=true instance=${inst}`,
    `[liveWarm] done event=111 rev=${rev} ms=200 instance=${inst}`,
  ];
  const logs = [];
  const groups = [];
  for (let k = 0; k < 6; k++) {
    const ra = 40 + 2 * k;
    const off = k * 10000;
    logs.push(entry([writer(ra, off + 50, "a"), ...bare(ra, "a", off + 60)]));
    logs.push(entry([writer(ra + 1, off + 300, "b"), ...bare(ra + 1, "b", off + 310)], "/api/admin/setlist-items/6"));
    groups.push({ k: k + 1, saves: [{ who: "A", rev: ra, status: 200 }, { who: "B", rev: ra + 1, status: 200 }], anchor: { firstStart: T + off, committed: [{ who: "A", rev: ra }, { who: "B", rev: ra + 1 }] } });
  }
  const json = { config: { overlap: { gapMs: 250, thirdAtMs: 0, faultA: null, catalogAtMs: 0 } }, overlap: { groups, gates: [], pass: true }, probe: { groups: [] } };
  const j = join(json, logs.join("\n"));
  assert.match(j.verdict, /^UNCLASSIFIABLE/);
  assert.equal(j.server.unclassifiable, 6);
  assert.ok(j.groups.every((g) => g.classifiable === false && g.exercised === null));
  assert.match(toMarkdown(j), /n\/a \(unclassifiable\)/);
});

test("a committed save without any warm-job lines makes its group unclassifiable (no vacuous pass)", () => {
  // A's job is complete, B's job lines are missing from the capture: the
  // group must be n/a, not "the race did not happen".
  const logs = [
    entry([writer(60, 50, "a"), ...job({ rev: 60, inst: "a", startAt: 60, sets: { ja: set({ bS: 70, bE: 700, txS: 80, txE: 700, at: 710 }) } })]),
    entry([writer(61, 300, "b")], "/api/admin/setlist-items/6"),
  ].join("\n");
  const groups = [{ k: 1, saves: [{ who: "A", rev: 60, status: 200 }, { who: "B", rev: 61, status: 200 }], anchor: { firstStart: T, committed: [{ who: "A", rev: 60 }, { who: "B", rev: 61 }] } }];
  const json = { config: { overlap: { gapMs: 250, thirdAtMs: 0, faultA: null, catalogAtMs: 0 } }, overlap: { groups, gates: [], pass: true }, probe: { groups: [] } };
  const j = join(json, logs);
  assert.equal(j.groups[0].classifiable, false);
  assert.equal(j.groups[0].exercised, null);
  assert.match(j.verdict, /^UNCLASSIFIABLE/);
});

test("a job missing a locale's set/skip line (capture gap) makes its group unclassifiable", () => {
  const mk = (skipMissing) => {
    const logs = [
      entry([writer(70, 50, "a"), ...job({ rev: 70, inst: "a", startAt: 60, sets: { ja: set({ bS: 70, bE: 700, txS: 80, txE: 700, at: 710 }) }, skipMissing })]),
      entry([writer(71, 300, "b"), ...job({ rev: 71, inst: "b", startAt: 310, sets: { ja: set({ bS: 320, bE: 420, txS: 330, txE: 420, at: 430 }) } })], "/api/admin/setlist-items/6"),
    ].join("\n");
    const groups = [{ k: 1, saves: [{ who: "A", rev: 70, status: 200 }, { who: "B", rev: 71, status: 200 }], anchor: { firstStart: T, committed: [{ who: "A", rev: 70 }, { who: "B", rev: 71 }] } }];
    return join({ config: { overlap: { gapMs: 250, thirdAtMs: 0, faultA: null, catalogAtMs: 0 } }, overlap: { groups, gates: [], pass: true }, probe: { groups: [] } }, logs);
  };
  // ko/en skipped with their own lines: complete record, classifiable.
  assert.equal(mk(true).groups[0].classifiable, true);
  // ko/en lines absent altogether: a gap, not evidence.
  assert.equal(mk(false).groups[0].classifiable, false);
  assert.match(mk(false).verdict, /^UNCLASSIFIABLE/);
});

test("warm-join: explicit `at` offsets vs rebuilt fallback", () => {
  const withAt = {
    start: { t: 0, eid: 0, at: T + 60 }, done: { ms: 400, at: T + 460 },
    sets: [{ locale: "ko", buildMs: 100, setMs: 10, at: T + 200, ok: true }, { locale: "ja", buildMs: 120, setMs: 10, at: T + 350, ok: true }],
    skips: [],
  };
  // Commit (writer at) = T + 50 → offsets from the commit.
  assert.deepEqual(localeOffsets(withAt, { commitAt: T + 50 }), { offsets: { ko: 150, ja: 300 }, how: "at", unaccounted: 110 });
  // Without a writer line: from the job's own start `at`.
  assert.deepEqual(localeOffsets(withAt).offsets, { ko: 140, ja: 290 });
  // An older log (no `at`): the rebuilt reconstruction, labelled so.
  const old = { start: { t: 0, eid: 0 }, done: { ms: 260 }, sets: [{ locale: "ko", buildMs: 100, setMs: 10, ok: true, t: 0, eid: 0 }, { locale: "ja", buildMs: 120, setMs: 10, ok: true, t: 0, eid: 0 }], skips: [] };
  assert.equal(localeOffsets(old).how, "rebuilt");
  // End to end: a step-4 log + a JSON with `who` and body revs.
  const log = entry([writer(20, 50, "a"), ...job({ rev: 20, inst: "a", startAt: 60, sets: { ko: set({ bS: 70, bE: 150, txS: 75, txE: 150, at: 160, rev: 21 }) } })]);
  const putStart = T;
  const j = warmJoin({ warm: { saves: [{ k: 1, who: "A", rev: 20, putStart, putMs: 50, putEnd: T + 50, sdk: [[0, "ko", 200, 220, "warm", "satisfied", 20, 21]], pages: [] }], groups: [{ k: 1, head: 21, saves: [{ who: "A", rev: 20 }, { who: "B", rev: 21 }] }] } }, log);
  assert.equal(j.saves[0].how, "at");
  assert.deepEqual(j.saves[0].entryNewer, ["ko→21"]);
  assert.equal(j.sdk.newer, 1);
  assert.equal(j.saves[0].rows[0].complete, 110);
});
