// Realtime reconnect storm (dev only). Builds a population of N connected
// subscribers on one broadcast channel (public or --private), then makes
// every client drop and re-establish its connection within --spread ms
// (leave channel → close socket → new socket + new join, the same work a
// tab does after a network blip or a Realtime node restart), repeated
// --storms times. After each storm it waits until everyone is back (or
// --window expires), then sends one `realtime.send` from Postgres and
// records delivery at +1/+3/+10 s.
//
// Optional background load while the storms run (the conditions the n14
// gate asks for):
//   --load-rps=50   open-loop GET <BASE_URL>/api/setlist?eventId=<id>&locale=ja
//   --admin         one admin create+delete on the event per storm, started
//                   together with the storm (row is deleted again)
//
// Flags:
//   --n=500 --topic=event:111 --private
//   --ramp-batch=100 --ramp-every=2000 --ramp-timeout=60000
//   --storms=3 --spread=1500 --window=30000 --pause=5000 (between storms)
//   --load-rps=0 --event-id=111 --admin --label=...
//   BASE_URL env (default: the dev preview) for --load-rps / --admin
//
// Usage: ENV_DIR=<checkout with .env> \
//   node tests/load/realtime/reconnect-storm.mjs --n=500 --storms=3 --load-rps=50 --admin
import { createClient } from "@supabase/supabase-js";
import { loadEnv, assertDev, parseArgs, dist, fmt, sleep, pgClient, startSnapshotLoad, adminCreateDelete } from "./lib.mjs";

loadEnv();
process.env.BASE_URL = process.env.BASE_URL || "https://opensetlist-git-dev-opensetlist-projects.vercel.app";
assertDev({ requireBase: true });
const args = parseArgs(process.argv.slice(2));
const N = parseInt(args.n ?? "500", 10);
const TOPIC = args.topic ?? "event:111";
const PRIVATE = !!args.private;
const RAMP_BATCH = parseInt(args["ramp-batch"] ?? "100", 10);
const RAMP_EVERY = parseInt(args["ramp-every"] ?? "2000", 10);
const RAMP_TIMEOUT = parseInt(args["ramp-timeout"] ?? "60000", 10);
const STORMS = parseInt(args.storms ?? "3", 10);
const SPREAD = parseInt(args.spread ?? "1500", 10);
const WINDOW = parseInt(args.window ?? "30000", 10);
const PAUSE = parseInt(args.pause ?? "5000", 10);
const LOAD_RPS = parseFloat(args["load-rps"] ?? "0");
const EVENT_ID = args["event-id"] ?? "111";
const BASE = process.env.BASE_URL;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const errorMessages = {};
const received = new Map(); // `${k}:${i}` → ms after sentAt[k]
const sentAt = {};
const subs = []; // { c, ch, gen, joinedAt: {gen → ms}, startedAt: {gen → t} }

function makeClient() {
  return createClient(SUPABASE_URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

// Join (or re-join) subscriber i as generation `gen`. The latency recorded
// for a generation is trigger → first SUBSCRIBED of that generation's
// channel, so realtime-js' own rejoin retries after TIMED_OUT / errors are
// included, as they would be for a real tab.
function join(i, gen, triggerAt) {
  const s = subs[i];
  s.gen = gen;
  s.startedAt[gen] = triggerAt;
  const ch = s.c.channel(TOPIC, { config: { private: PRIVATE } });
  s.ch = ch;
  ch.on("broadcast", { event: "rev" }, (m) => {
    const k = m.payload?.k ?? 0;
    if (!received.has(`${k}:${i}`) && sentAt[k]) received.set(`${k}:${i}`, Date.now() - sentAt[k]);
  });
  ch.subscribe((st, err) => {
    if (st === "SUBSCRIBED" && s.joinedAt[gen] === undefined && s.gen === gen) s.joinedAt[gen] = Date.now() - triggerAt;
    if (err) {
      const msg = (err.message || String(err)).slice(0, 160);
      errorMessages[msg] = (errorMessages[msg] || 0) + 1;
    }
  });
}

function genSummary(gen) {
  const lat = subs.map((s) => s.joinedAt[gen]).filter((x) => x !== undefined);
  return { joined: lat.length, latency: dist(lat) };
}

async function waitJoined(gen, timeout, t0) {
  let lastPrint = 0;
  while (Date.now() - t0 < timeout) {
    const g = genSummary(gen);
    if (g.joined === N) break;
    if (Date.now() - lastPrint >= 3000) {
      lastPrint = Date.now();
      console.log(`  gen ${gen}: ${g.joined}/${N} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    await sleep(100);
  }
  return genSummary(gen);
}

async function dbSendDelivery(k) {
  const pg = pgClient();
  await pg.connect();
  sentAt[k] = Date.now();
  let sqlMs = null;
  try {
    await pg.query("select realtime.send($1::jsonb, 'rev', $2, $3)", [JSON.stringify({ k, rev: k, kind: "setlist", probe: true }), TOPIC, PRIVATE]);
    sqlMs = Date.now() - sentAt[k];
  } finally {
    await pg.end();
  }
  const out = { sqlMs };
  let waited = 0;
  for (const t of [1000, 3000, 10000]) {
    await sleep(t - waited);
    waited = t;
    const lat = [...received.entries()].filter(([key]) => key.startsWith(`${k}:`)).map(([, v]) => v);
    out[`+${t / 1000}s`] = dist(lat);
    console.log(`  msg#${k} +${t / 1000}s delivered ${lat.length}/${N}  ${fmt(out[`+${t / 1000}s`])}`);
  }
  return out;
}

async function storm(gen) {
  const t0 = Date.now();
  await Promise.all(subs.map(async (s, i) => {
    await sleep(Math.random() * SPREAD);
    const trigger = Date.now();
    const old = s.ch;
    s.ch = null;
    // Leave + close the socket; don't wait for the leave reply before the
    // reconnect (a dropped tab wouldn't), but do let the socket close.
    s.c.removeChannel(old).catch(() => {});
    await s.c.realtime.disconnect().catch(() => {});
    join(i, gen, trigger);
  }));
  console.log(`  storm ${gen}: all ${N} disconnect+rejoin triggered within ${((Date.now() - t0) / 1000).toFixed(2)} s`);
  return t0;
}

(async () => {
  const summary = { label: args.label ?? null, n: N, topic: TOPIC, private: PRIVATE, spread: SPREAD, loadRps: LOAD_RPS, storms: [] };
  console.log(`reconnect-storm N=${N} topic=${TOPIC} private=${PRIVATE} storms=${STORMS} spread=${SPREAD}ms load=${LOAD_RPS}rps admin=${!!args.admin}`);

  // Population ramp (generation 0).
  const r0 = Date.now();
  for (let i = 0; i < N; i += RAMP_BATCH) {
    for (let k = i; k < Math.min(N, i + RAMP_BATCH); k++) {
      subs[k] = { c: makeClient(), ch: null, gen: 0, joinedAt: {}, startedAt: {} };
      join(k, 0, Date.now());
    }
    if (i + RAMP_BATCH < N) await sleep(RAMP_EVERY);
  }
  const g0 = await waitJoined(0, RAMP_TIMEOUT, r0);
  console.log(`ramp: ${g0.joined}/${N} joined; ${fmt(g0.latency)}`);
  summary.ramp = g0;
  if (g0.joined < N) {
    console.log("population incomplete — storms run on whoever joined; the shortfall is a failure in itself");
  }

  const stopLoad = LOAD_RPS > 0 ? startSnapshotLoad({ base: BASE, eventId: EVENT_ID, rps: LOAD_RPS }) : null;
  if (stopLoad) await sleep(3000); // let the load reach steady state

  for (let gen = 1; gen <= STORMS; gen++) {
    const adminP = args.admin ? adminCreateDelete({ base: BASE, eventId: EVENT_ID, note: `rt-reconnect-storm-${gen}` }).catch((e) => ({ error: e.message })) : null;
    const t0 = await storm(gen);
    const g = await waitJoined(gen, WINDOW, t0);
    console.log(`storm ${gen}: ${g.joined}/${N} back; resubscribe ${fmt(g.latency)}`);
    const admin = adminP ? await adminP : null;
    if (admin) console.log(`  admin save during storm: ${JSON.stringify(admin)}`);
    const delivery = await dbSendDelivery(gen);
    summary.storms.push({ gen, rejoin: g, admin, delivery });
    if (gen < STORMS) await sleep(PAUSE);
  }

  if (stopLoad) {
    summary.load = await stopLoad();
    console.log(`background load: ${JSON.stringify(summary.load)}`);
  }
  summary.errorMessages = errorMessages;
  if (Object.keys(errorMessages).length) console.log("error messages:", JSON.stringify(errorMessages, null, 1));
  console.log("SUMMARY " + JSON.stringify(summary));
  await Promise.allSettled(subs.map((s) => s.c.removeAllChannels()));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
