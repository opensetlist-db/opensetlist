// n15 release A2 dev smoke: subscribe to event:<id> on the DEV Supabase
// project, make ONE admin save on the dev Preview (insert an MC row),
// time the broadcast arrival, issue the hinted GET the page would send
// (minRev=<rev>&hint=1) and report x-snapshot-source / x-snapshot-verify,
// then delete the row (second save, second broadcast). Dev only.
import { config as dotenvConfig } from "dotenv"; dotenvConfig({ path: [".env.local", ".env"], quiet: true });
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2];
const EVENT = process.argv[3] ?? "111";
if (!BASE || !/vercel\.app$|localhost/.test(new URL(BASE).host)) throw new Error("base must be a vercel.app preview");
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!/nddawybyuedsrshhxikx/.test(SUPA_URL)) throw new Error("refusing: not the dev Supabase project");
const log = (...a) => console.log(new Date().toISOString(), ...a);

// 1. login (password read from .env, never printed)
const loginRes = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
if (!loginRes.ok) throw new Error(`login ${loginRes.status}`);
const cookie = loginRes.headers.get("set-cookie").split(";")[0];
log("login ok");

// 2. baseline snapshot
const t0 = Date.now();
const base = await fetch(`${BASE}/api/setlist?eventId=${EVENT}&locale=ja`);
const baseBody = await base.json();
log(`baseline GET ${base.status} ${Date.now() - t0}ms source=${base.headers.get("x-snapshot-source")} rev=${baseBody.rev} items=${baseBody.items.length}`);
const maxPos = Math.max(0, ...baseBody.items.map((i) => i.position)); const anyEncore = baseBody.items.some((i) => i.isEncore);

// 3. subscribe
const supa = createClient(SUPA_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const arrivals = [];
let resolveSub;
const subscribed = new Promise((r) => (resolveSub = r));
supa.channel(`event:${EVENT}`)
  .on("broadcast", { event: "rev" }, (m) => { arrivals.push({ t: Date.now(), payload: m.payload }); log("broadcast", JSON.stringify(m.payload)); })
  .subscribe((s) => { log("channel", s); if (s === "SUBSCRIBED") resolveSub(); });
await Promise.race([subscribed, new Promise((_, rej) => setTimeout(() => rej(new Error("subscribe timeout")), 15000))]);

const waitArrival = async (n, ms = 10000) => { const end = Date.now() + ms; while (arrivals.length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 25)); return arrivals.length >= n; };

// 4. save 1: insert an MC row
const saveT = Date.now();
const ins = await fetch(`${BASE}/api/admin/setlist-items`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ eventId: Number(EVENT), position: maxPos + 1, type: "mc", isEncore: anyEncore, note: "n15 release smoke — ignore", status: "confirmed" }) });
const insBody = await ins.json();
const saveMs = Date.now() - saveT;
log(`save1 POST ${ins.status} ${saveMs}ms id=${insBody.id ?? insBody.item?.id} rev=${insBody.rev}`);
if (!ins.ok) { console.error(insBody); process.exit(1); }
const itemId = insBody.id ?? insBody.item?.id;
const got1 = await waitArrival(1);
const rev1 = arrivals[0]?.payload?.rev;
log(`broadcast1 ${got1 ? "received" : "MISSING"} rev=${rev1} +${got1 ? arrivals[0].t - saveT : "-"}ms after save start`);

// 5. hinted GET as the page does
const h0 = Date.now();
const hinted = await fetch(`${BASE}/api/setlist?eventId=${EVENT}&locale=ja&minRev=${rev1}&hint=1`);
const hb = await hinted.json();
log(`hinted GET ${hinted.status} ${Date.now() - h0}ms source=${hinted.headers.get("x-snapshot-source")} verify=${hinted.headers.get("x-snapshot-verify")} rev=${hb.rev} items=${hb.items.length}`);
const h1 = Date.now();
const hinted2 = await fetch(`${BASE}/api/setlist?eventId=${EVENT}&locale=ja&minRev=${rev1}&hint=1`);
const hb2 = await hinted2.json();
log(`hinted GET#2 ${hinted2.status} ${Date.now() - h1}ms source=${hinted2.headers.get("x-snapshot-source")} verify=${hinted2.headers.get("x-snapshot-verify")} rev=${hb2.rev}`);

// 6. save 2: delete the row (cleanup; also a save → broadcast)
const delT = Date.now();
const del = await fetch(`${BASE}/api/admin/setlist-items/${itemId}`, { method: "DELETE", headers: { cookie } });
log(`save2 DELETE ${del.status} ${Date.now() - delT}ms`);
const got2 = await waitArrival(2);
log(`broadcast2 ${got2 ? "received" : "MISSING"} rev=${arrivals[1]?.payload?.rev} +${got2 ? arrivals[1].t - delT : "-"}ms after delete start`);
const fin = await fetch(`${BASE}/api/setlist?eventId=${EVENT}&locale=ja&minRev=${arrivals[1]?.payload?.rev}&hint=1`);
const fb = await fin.json();
log(`final GET ${fin.status} source=${fin.headers.get("x-snapshot-source")} verify=${fin.headers.get("x-snapshot-verify")} rev=${fb.rev} items=${fb.items.length} (baseline ${baseBody.items.length})`);
await supa.removeAllChannels();
process.exit(0);
