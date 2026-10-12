// node --test tests/load/observer-prod.test.mjs
//
// Three initial listeners + one fresh listener spawned late. Save rev 31
// reaches listeners 0 and 1 but not 2 (subscribed, yet missed it); save
// rev 32 reaches everyone incl. the fresh listener. Listener 1 has a
// CHANNEL_ERROR + rejoin between the saves; one forged payload arrives.
import test from "node:test";
import assert from "node:assert/strict";
import { summarizeProd, prodMarkdown, parseRevPayload } from "./observer-prod.mjs";

const T = Date.UTC(2026, 10, 14, 7, 20, 0, 0);
const listener = (id, sub, extra = {}) => ({
  id, locale: ["ja", "ko", "en"][id % 3], late: false, attemptAt: sub - 400,
  statusLog: [[sub, "SUBSCRIBED"]], connLog: [[sub - 300, 1]], recreates: [], stoppedAt: T + 600000, ...extra,
});
const rep = () => ({
  meta: { host: "laptop", platform: "win32", node: "v24", base: "https://opensetlist.com", baseKind: "prod", eventId: "107", listeners: 3, supabaseRefMasked: "abcd…", anonKeyEnv: "PROD_ANON", keyKind: "jwt", startedAt: "x", endedAt: "y", endReason: "duration", addListenerAfterS: 120 },
  baseline: { t: T - 10000, tEnd: T - 9900, status: 200, bodyRev: 30, source: "cache" },
  listeners: [
    listener(0, T - 5000),
    listener(1, T - 4000, {
      statusLog: [[T - 4000, "SUBSCRIBED"], [T + 30000, "CHANNEL_ERROR"], [T + 32000, "SUBSCRIBED"], [T + 600000, "CLOSED"]],
      connLog: [[T - 4300, 1], [T + 30000, 0], [T + 31500, 1]],
    }),
    listener(2, T - 3000),
    listener(3, T + 120000, { late: true }),
  ],
  receipts: [
    { listener: 0, t: T, rev: 31, dup: false },
    { listener: 1, t: T + 60, rev: 31, dup: false },
    { listener: 0, t: T + 900, rev: 31, dup: true },
    { listener: 2, t: T + 50000, rev: null, dup: false, payload: '{"kind":"setlist","rev":"999"}' },
    { listener: 3, t: T + 300000, rev: 32, dup: false },
    { listener: 0, t: T + 300020, rev: 32, dup: false },
    { listener: 1, t: T + 300030, rev: 32, dup: false },
    { listener: 2, t: T + 300045, rev: 32, dup: false },
  ],
  fetches: [
    { listener: 0, rev: 31, t: T + 5, tEnd: T + 130, status: 200, source: "warm", verify: "satisfied", bodyRev: 31, vercelId: "icn1::icn1::a-1" },
    { listener: 1, rev: 31, t: T + 65, tEnd: T + 400, status: 200, source: "repair", verify: "fresh=31", bodyRev: 31, vercelId: "icn1::icn1::a-2" },
    ...[0, 1, 2, 3].map((l) => ({ listener: l, rev: 32, t: T + 300050, tEnd: T + 300150, status: 200, source: "warm", verify: "satisfied", bodyRev: 32 })),
  ],
});

test("payload acceptance: only {kind:setlist, rev:int≥0}", () => {
  assert.equal(parseRevPayload({ kind: "setlist", rev: 5 }), 5);
  assert.equal(parseRevPayload({ kind: "setlist", rev: "5" }), null);
  assert.equal(parseRevPayload({ kind: "other", rev: 5 }), null);
  assert.equal(parseRevPayload({ kind: "setlist", rev: -1 }), null);
  assert.equal(parseRevPayload(null), null);
});

test("per-rev: received / total and among listeners subscribed before the rev", () => {
  const s = summarizeProd(rep());
  const [r31, r32] = s.revs;
  assert.equal(r31.rev, 31);
  assert.equal(r31.received, 2);
  assert.equal(r31.total, 4);
  // the fresh listener joined after rev 31 → not eligible for it
  assert.equal(r31.eligible, 3);
  assert.equal(r31.receivedEligible, 2);
  assert.deepEqual(r31.missing, [2]);
  assert.equal(r31.allReceived, false);
  assert.equal(r31.spreadMs, 60);
  assert.deepEqual(r31.sources, { warm: 1, repair: 1 });
  assert.equal(r31.fetchesOk, 2);
  assert.equal(r32.eligible, 4);
  assert.equal(r32.allReceived, true);
  assert.equal(s.verdict.everyRevReachedAll, false);
  assert.equal(s.verdict.everyHintedFetchOk, true);
});

test("per listener: subscribed before the first save, closes, rejoins, socket drops; fresh listener check", () => {
  const s = summarizeProd(rep());
  const [l0, l1, , l3] = s.listeners;
  assert.equal(l0.subscribedBeforeFirstSave, true);
  assert.equal(l0.joinMs, 400);
  assert.equal(l0.stayedConnected, true);
  assert.equal(l1.rejoins, 1);
  assert.deepEqual(l1.closes, [[T + 30000, "CHANNEL_ERROR"]]);
  assert.deepEqual(l1.socketDrops, [T + 30000]);
  // the CLOSED at stop time is ours, not a close
  assert.equal(l1.connectedAtEnd, true);
  assert.equal(l1.stayedConnected, false);
  assert.equal(l3.late, true);
  assert.equal(l3.subscribedBeforeFirstSave, false);
  assert.deepEqual(l3.revsReceived, [32]);
  assert.equal(s.verdict.allSubscribedBeforeFirstSave, true);
  assert.equal(s.verdict.allStayedConnected, false);
  assert.equal(s.verdict.lateListener, "PASS");
  assert.deepEqual(s.lateCheck, [{ id: 3, due: [32], received: [32] }]);
});

test("markdown: clock caveat, separate receipt and GET times, eligibility, invalid payload", () => {
  const r = rep();
  const md = prodMarkdown(summarizeProd(r), r);
  assert.match(md, /\*\*clock:\*\* every time below is THIS receiver host's clock, in UTC/);
  assert.match(md, /\| 31 \| 07:20:00\.000 \| 2\/4 \| 2\/3 \| 2 \| 60 \| 2\/2 \|/);
  assert.match(md, /\| 31 \| 0 \| ja \| 07:20:00\.000 \| 0 \| 07:20:00\.005 \| 07:20:00\.130 \| 200 \| warm \| satisfied \| 31 \| 125 \|/);
  assert.match(md, /Invalid payloads on the channel \(1\)/);
  assert.match(md, /\| 3 \(fresh\) \|/);
  assert.match(md, /fresh listener \(joined late\) received every later save: PASS/);
  assert.doesNotMatch(md, /eyJ/);
});

test("no save in the window: nothing to judge, explicit", () => {
  const r = { ...rep(), receipts: [], fetches: [] };
  const s = summarizeProd(r);
  assert.equal(s.verdict.broadcasts, 0);
  assert.equal(s.verdict.allSubscribedBeforeFirstSave, null);
  assert.equal(s.verdict.lateListener, "NOT EXERCISED");
  assert.match(prodMarkdown(s, r), /No `rev` broadcast arrived/);
});
