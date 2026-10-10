// Realtime join storm (dev only). N supabase-js clients — one websocket
// each, like N browser tabs — join one broadcast channel, optionally as a
// private channel (Realtime Authorization → RLS check on
// realtime.messages per join). Measures, per client, the time from its
// subscribe() call (which also opens the socket) to SUBSCRIBED, and
// collects CHANNEL_ERROR / TIMED_OUT / server error messages
// (too_many_joins, Unauthorized, authorization timeouts, ...).
//
// Then optionally:
//   --send     one `SELECT realtime.send(payload,'rev',topic,<private>)`
//              from Postgres (the R1 writer path) → delivery count and
//              latency at +1/+3/+10 s.
//   --neg      negative checks on a private channel:
//                a) a guest client publishes over the websocket (ack on)
//                b) a guest client publishes via the REST broadcast API
//                c) realtime.send(..., private=false) on the same topic
//                d) a public-channel client publishes on the same topic
//              none of these may reach the private subscribers; a public
//              control subscriber shows c)/d) really were delivered on
//              the public side.
//
// Flags:
//   --n=500                 clients
//   --topic=event:111       channel topic
//   --private               join with config: { private: true }
//   --batch=100 --every=2000  start `batch` joins every `every` ms;
//                           --batch=0 starts all joins at once
//   --window=20000          how long after the last attempt to wait for joins
//   --send --neg            see above
//   --spam-rps=2 --spam-secs=120
//                           sustained broker spam: one guest client sends
//                           client broadcasts at that rate; per-message
//                           delivery counts, send results, subscriber
//                           closes/errors (would reveal rate limiting)
//   --label=...             free text echoed into the JSON summary
//
// Usage (from the repo root; see README.md):
//   ENV_DIR=<checkout with .env> \
//     node tests/load/realtime/join-storm.mjs --n=500 --private --batch=100 --every=2000 --send
import { createClient } from "@supabase/supabase-js";
import { loadEnv, assertDev, parseArgs, dist, fmt, sleep, pgClient } from "./lib.mjs";

loadEnv();
assertDev();
const args = parseArgs(process.argv.slice(2));
const N = parseInt(args.n ?? "500", 10);
const TOPIC = args.topic ?? "event:111";
const PRIVATE = !!args.private;
const BATCH = parseInt(args.batch ?? "100", 10);
const EVERY = parseInt(args.every ?? "2000", 10);
const WINDOW = parseInt(args.window ?? "20000", 10);
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Server-side failure signals worth counting even when the client later
// recovers on its own (realtime-js rejoins after TIMED_OUT / errors).
const SIGNALS = /too_many|unauthori|timeout|timed out|IncreaseConnectionPool|connection pool|rate|limit|denied|permission/i;

const clients = []; // { c, ch, attemptAt, subscribedAt, statuses[], errors[] }
const signalCounts = {};
const errorMessages = {};
const received = new Map(); // `${k}:${i}` → ms after sentAt[k]
const sentAt = {};

function noteSignal(msg) {
  const m = String(msg).match(SIGNALS);
  if (!m) return;
  const key = String(msg).slice(0, 160);
  signalCounts[key] = (signalCounts[key] || 0) + 1;
}

function makeClient() {
  return createClient(SUPABASE_URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: {
      // Only server replies/errors are interesting; realtime-js logs every
      // push/receive through this, so keep it a cheap string test.
      logger: (kind, msg, data) => {
        if (kind === "receive" && data && data.status === "error") noteSignal(JSON.stringify(data.response ?? data));
        else if (kind === "error" || kind === "transport") noteSignal(`${kind}: ${msg}`);
      },
    },
  });
}

function openOne(i) {
  const c = makeClient();
  const rec = { c, ch: null, attemptAt: Date.now(), subscribedAt: null, statuses: [], errors: [] };
  clients[i] = rec;
  const ch = c.channel(TOPIC, { config: { private: PRIVATE } });
  rec.ch = ch;
  ch.on("broadcast", { event: "rev" }, (m) => {
    const k = m.payload?.k ?? 0;
    if (!received.has(`${k}:${i}`) && sentAt[k]) received.set(`${k}:${i}`, Date.now() - sentAt[k]);
  });
  ch.on("system", {}, (p) => {
    if (p?.status === "error") noteSignal(`system: ${p.message ?? JSON.stringify(p)}`);
  });
  ch.subscribe((s, err) => {
    rec.statuses.push(s);
    if (s === "SUBSCRIBED" && rec.subscribedAt === null) rec.subscribedAt = Date.now();
    if (err) {
      const msg = err.message || String(err);
      rec.errors.push(msg);
      errorMessages[msg.slice(0, 160)] = (errorMessages[msg.slice(0, 160)] || 0) + 1;
    }
  });
}

function joinSummary() {
  const lat = clients.filter((r) => r && r.subscribedAt !== null).map((r) => r.subscribedAt - r.attemptAt);
  const statusCounts = {};
  for (const r of clients) for (const s of r?.statuses ?? []) statusCounts[s] = (statusCounts[s] || 0) + 1;
  return {
    joined: lat.length,
    notJoined: clients.filter((r) => r && r.subscribedAt === null).length,
    joinedWithin5s: lat.filter((x) => x <= 5000).length,
    latency: dist(lat),
    statusCounts,
  };
}

function delivery(k) {
  const lat = [...received.entries()].filter(([key]) => key.startsWith(`${k}:`)).map(([, v]) => v);
  return dist(lat);
}

async function dbSend(k, priv, topic = TOPIC) {
  const pg = pgClient();
  await pg.connect();
  sentAt[k] = Date.now();
  let sqlMs = null;
  let error = null;
  try {
    await pg.query("select realtime.send($1::jsonb, 'rev', $2, $3)", [JSON.stringify({ k, rev: k, kind: "setlist", probe: true }), topic, priv]);
    sqlMs = Date.now() - sentAt[k];
  } catch (e) {
    error = e.message;
  } finally {
    await pg.end();
  }
  return { sqlMs, error };
}

async function deliveryAt(k, checkpoints = [1000, 3000, 10000]) {
  const out = {};
  let waited = 0;
  for (const t of checkpoints) {
    await sleep(t - waited);
    waited = t;
    const d = delivery(k);
    out[`+${t / 1000}s`] = d;
    console.log(`  msg#${k} +${t / 1000}s delivered ${d.n}/${joinSummary().joined}  ${fmt(d)}`);
  }
  return out;
}

async function negativeChecks() {
  const res = {};
  const joined = joinSummary().joined;

  // a) guest publishes over the websocket on the private channel (ack on so
  //    the server's verdict comes back instead of fire-and-forget).
  {
    const c = makeClient();
    const ch = c.channel(TOPIC, { config: { private: PRIVATE, broadcast: { ack: true } } });
    const st = await new Promise((resolve) => {
      ch.subscribe((s, err) => { if (s !== "CLOSED") resolve({ s, err: err?.message }); });
      setTimeout(() => resolve({ s: "no-reply" }), 10000);
    });
    sentAt[901] = Date.now();
    let r;
    try { r = await ch.send({ type: "broadcast", event: "rev", payload: { k: 901, rev: 999999, forged: true } }); }
    catch (e) { r = `threw: ${e.message}`; }
    await sleep(3000);
    res.wsSend = { senderJoin: st, sendResult: r, deliveredToPrivateSubs: delivery(901).n, of: joined };
    console.log("  (a) guest websocket send:", JSON.stringify(res.wsSend));

    // b) same guest via the REST broadcast endpoint.
    sentAt[902] = Date.now();
    let h;
    try { h = await ch.httpSend("rev", { k: 902, rev: 999999, forged: true }); }
    catch (e) { h = `rejected: ${e.message}`; }
    await sleep(3000);
    res.httpSend = { result: h, deliveredToPrivateSubs: delivery(902).n, of: joined };
    console.log("  (b) guest REST send:", JSON.stringify(res.httpSend));
    await c.removeAllChannels();
  }

  // Public control subscriber on the same topic name, so c)/d) prove they
  // really went out on the public side.
  const pub = makeClient();
  const pubGot = {};
  const pch = pub.channel(TOPIC, { config: { private: false } });
  pch.on("broadcast", { event: "rev" }, (m) => { pubGot[m.payload?.k] = Date.now() - (sentAt[m.payload?.k] ?? Date.now()); });
  await new Promise((resolve) => {
    pch.subscribe((s) => { if (s === "SUBSCRIBED") resolve(); });
    setTimeout(resolve, 10000);
  });
  await sleep(500);

  // c) Postgres realtime.send with private=false on the same topic.
  const c3 = await dbSend(903, !PRIVATE);
  await sleep(3000);
  res.dbSendOtherMode = { sql: c3, deliveredToSubs: delivery(903).n, of: joined, publicControlGot: 903 in pubGot };
  console.log(`  (c) realtime.send private=${!PRIVATE}:`, JSON.stringify(res.dbSendOtherMode));

  // d) a public-channel client publishes on the same topic name.
  {
    const c = makeClient();
    const ch = c.channel(TOPIC, { config: { private: false } });
    await new Promise((resolve) => { ch.subscribe((s) => { if (s === "SUBSCRIBED") resolve(); }); setTimeout(resolve, 10000); });
    sentAt[904] = Date.now();
    const r = await ch.send({ type: "broadcast", event: "rev", payload: { k: 904, rev: 999999, forged: true } });
    await sleep(3000);
    res.publicClientSend = { sendResult: r, deliveredToSubs: delivery(904).n, of: joined, publicControlGot: 904 in pubGot };
    console.log("  (d) public client send:", JSON.stringify(res.publicClientSend));
    await c.removeAllChannels();
  }
  await pub.removeAllChannels();
  return res;
}

// Sustained broker spam: one guest client on the same channel (public, or
// private if it could publish) sends `rate` client broadcasts per second
// for `secs` seconds — the abuse case a public channel allows. Records,
// per message, how many joined subscribers got it, plus send results and
// any subscriber channel closes/errors (rate limiting would show here).
async function spam(rate, secs) {
  const c = makeClient();
  const ch = c.channel(TOPIC, { config: { private: PRIVATE } });
  await new Promise((resolve) => { ch.subscribe((s) => { if (s === "SUBSCRIBED") resolve(); }); setTimeout(resolve, 10000); });
  const joined = joinSummary().joined;
  const closedBefore = joinSummary().statusCounts.CLOSED || 0;
  const errBefore = joinSummary().statusCounts.CHANNEL_ERROR || 0;
  const sendResults = {};
  const total = Math.round(rate * secs);
  console.log(`spam: ${total} client broadcasts at ${rate}/s to ${joined} subscribers`);
  const start = Date.now();
  for (let j = 0; j < total; j++) {
    const k = 1000 + j;
    const due = start + (j * 1000) / rate;
    await sleep(Math.max(0, due - Date.now()));
    sentAt[k] = Date.now();
    let r;
    try { r = await ch.send({ type: "broadcast", event: "rev", payload: { k, rev: k, spam: true } }); }
    catch (e) { r = `threw: ${e.message}`; }
    sendResults[r] = (sendResults[r] || 0) + 1;
    if (j > 0 && j % Math.round(rate * 20) === 0) {
      const d = delivery(1000 + j - Math.round(rate * 2));
      console.log(`  t+${Math.round((Date.now() - start) / 1000)}s msg#${j - Math.round(rate * 2)} delivered ${d.n}/${joined} p95=${d.p95} ms`);
    }
  }
  await sleep(3000);
  const per = [];
  const lat = [];
  for (let j = 0; j < total; j++) {
    const entries = [...received.entries()].filter(([key]) => key.startsWith(`${1000 + j}:`));
    per.push(entries.length);
    for (const [, v] of entries) lat.push(v);
  }
  per.sort((a, b) => a - b);
  const res = {
    rate, secs, sent: total, sendResults, subscribers: joined,
    deliveredPerMsg: { min: per[0], p50: per[Math.floor(per.length / 2)], max: per[per.length - 1], full: per.filter((x) => x === joined).length },
    totalDeliveries: lat.length,
    latency: dist(lat),
    subscriberClosesDuring: (joinSummary().statusCounts.CLOSED || 0) - closedBefore,
    subscriberErrorsDuring: (joinSummary().statusCounts.CHANNEL_ERROR || 0) - errBefore,
    signals: { ...signalCounts },
  };
  console.log("spam result:", JSON.stringify(res));
  await c.removeAllChannels();
  return res;
}

(async () => {
  const t0 = Date.now();
  console.log(`join-storm N=${N} topic=${TOPIC} private=${PRIVATE} batch=${BATCH || "all"} every=${EVERY}ms`);

  if (BATCH > 0) {
    for (let i = 0; i < N; i += BATCH) {
      for (let k = i; k < Math.min(N, i + BATCH); k++) openOne(k);
      if (i + BATCH < N) await sleep(EVERY);
    }
  } else {
    for (let i = 0; i < N; i++) openOne(i);
  }
  const lastAttempt = Date.now();
  console.log(`all ${N} attempts started within ${((lastAttempt - t0) / 1000).toFixed(1)} s`);

  // Wait until everyone joined or the window closes; progress every 2 s.
  let lastPrint = 0;
  while (Date.now() - lastAttempt < WINDOW) {
    const s = joinSummary();
    if (s.joined === N) break;
    if (Date.now() - lastPrint >= 2000) {
      lastPrint = Date.now();
      console.log(`  joined ${s.joined}/${N} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    await sleep(100);
  }
  const join = joinSummary();
  console.log(`join: ${join.joined}/${N} joined, ${join.joinedWithin5s} within 5 s; ${fmt(join.latency)}`);
  console.log("status callbacks:", JSON.stringify(join.statusCounts));
  if (Object.keys(errorMessages).length) console.log("error messages:", JSON.stringify(errorMessages, null, 1));
  if (Object.keys(signalCounts).length) console.log("server/transport signals:", JSON.stringify(signalCounts, null, 1));

  const summary = { label: args.label ?? null, n: N, topic: TOPIC, private: PRIVATE, batch: BATCH, every: EVERY, join, errorMessages };

  if (args.send && join.joined > 0) {
    await sleep(1000);
    const s = await dbSend(1, PRIVATE);
    console.log(`realtime.send(private=${PRIVATE}) sql ${s.sqlMs} ms${s.error ? ` ERROR ${s.error}` : ""}`);
    summary.send = { sql: s, delivery: await deliveryAt(1) };
  }
  if (args.neg) {
    console.log("negative checks:");
    summary.neg = await negativeChecks();
  }
  if (args["spam-rps"]) {
    summary.spam = await spam(parseFloat(args["spam-rps"]), parseInt(args["spam-secs"] ?? "120", 10));
  }
  summary.signals = signalCounts;
  console.log("SUMMARY " + JSON.stringify(summary));

  await Promise.allSettled(clients.filter(Boolean).map((r) => r.c.removeAllChannels()));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
