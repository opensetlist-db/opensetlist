// Shared helpers for the Realtime probes in this folder (dev only).
//
// Env loading: `.env.local` then `.env` (dotenv never overrides a key that
// is already set, so `.env.local` wins, same as Next.js). The files are
// gitignored, so a fresh worktree usually has none. Set ENV_DIR to the
// main checkout (e.g. ENV_DIR=F:/work/ClaudeCode/opensetlist4) to read
// them from there; the current directory is tried after ENV_DIR.
//
// Safety guard: every probe calls `assertDev()` before opening a socket
// or a DB connection. Both the Supabase URL (websocket target) and
// DATABASE_URL_UNPOOLED (where `realtime.send` / policy SQL runs) must
// contain the dev project ref. A probe that opens 500 sockets or applies
// policy SQL must never be able to reach prod by a mis-set env var.
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import pg from "pg";

export const DEV_REF = "nddawybyuedsrshhxikx";

export function loadEnv() {
  const dirs = [process.env.ENV_DIR, process.cwd()].filter(Boolean);
  for (const dir of dirs) {
    for (const f of [".env.local", ".env"]) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) dotenv.config({ path: p, quiet: true });
    }
  }
}

export function assertDev() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const db = process.env.DATABASE_URL_UNPOOLED || "";
  if (!url.includes(DEV_REF)) {
    console.error(`refusing: NEXT_PUBLIC_SUPABASE_URL is not the dev project (${DEV_REF})`);
    process.exit(2);
  }
  if (!db.includes(DEV_REF)) {
    console.error(`refusing: DATABASE_URL_UNPOOLED is not the dev project (${DEV_REF})`);
    process.exit(2);
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.error("missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
    process.exit(2);
  }
  // BASE_URL is only used for background HTTP load / admin saves. Refuse
  // the production hostnames explicitly; the dev preview and localhost are
  // the only intended targets.
  const base = process.env.BASE_URL || "";
  if (/(^https?:\/\/)?(www\.)?opensetlist\.com/i.test(base) || /opensetlist\.vercel\.app/i.test(base)) {
    console.error("refusing: BASE_URL points at production");
    process.exit(2);
  }
}

// Simple CLI flag parser: --key=value / --flag → { key: value, flag: true }.
export function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

// Nearest-rank percentile on an ascending-sorted array.
export function pct(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

export function dist(values) {
  const s = [...values].sort((a, b) => a - b);
  return {
    n: s.length,
    p50: pct(s, 0.5),
    p95: pct(s, 0.95),
    p99: pct(s, 0.99),
    max: s.length ? s[s.length - 1] : null,
  };
}

export const fmt = (d) => `n=${d.n} p50=${d.p50} p95=${d.p95} p99=${d.p99} max=${d.max} ms`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function pgClient() {
  const { Client } = pg;
  return new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED, connectionTimeoutMillis: 20000 });
}

// Background HTTP load: GET the snapshot at ~rps, open-loop (requests are
// started on a fixed schedule regardless of completion, like a crowd of
// independent viewers). Returns a stop() that resolves to a summary.
export function startSnapshotLoad({ base, eventId, rps }) {
  const url = `${base}/api/setlist?eventId=${eventId}&locale=ja`;
  const lat = [];
  const codes = {};
  let errors = 0;
  let inflight = 0;
  let maxInflight = 0;
  const started = Date.now();
  const interval = 1000 / rps;
  let next = Date.now();
  let stopped = false;
  const pending = new Set();
  const tick = () => {
    if (stopped) return;
    const now = Date.now();
    while (next <= now) {
      next += interval;
      const t = Date.now();
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      const p = fetch(url, { signal: AbortSignal.timeout(15000) })
        .then(async (r) => {
          await r.arrayBuffer();
          codes[r.status] = (codes[r.status] || 0) + 1;
          lat.push(Date.now() - t);
        })
        .catch(() => { errors++; })
        .finally(() => { inflight--; pending.delete(p); });
      pending.add(p);
    }
    setTimeout(tick, Math.max(1, next - Date.now()));
  };
  tick();
  return async () => {
    stopped = true;
    await Promise.allSettled([...pending]);
    const secs = (Date.now() - started) / 1000;
    return { requests: lat.length + errors, achievedRps: +((lat.length + errors) / secs).toFixed(1), codes, errors, maxInflight, latency: dist(lat) };
  };
}

// One admin save on the dev preview: login → append a row at the tail of
// the event → delete it again. Mirrors rt-cap / rt-probe3. Returns timing
// and always tries the cleanup delete.
export async function adminCreateDelete({ base, eventId, note = "rt-probe" }) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return { skipped: "no ADMIN_PASSWORD" };
  const login = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: pw }),
  });
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  if (!cookie) return { error: `login HTTP ${login.status}` };
  const snap = await (await fetch(`${base}/api/setlist?eventId=${eventId}&locale=ja`)).json();
  const last = snap.items[snap.items.length - 1];
  const songId = last?.songs?.[0]?.song?.id;
  const t = Date.now();
  const res = await fetch(`${base}/api/admin/setlist-items`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      eventId: String(eventId),
      position: (last?.position ?? 0) + 1,
      isEncore: !!last?.isEncore,
      note,
      songIds: songId ? [Number(songId)] : [],
    }),
  });
  const createMs = Date.now() - t;
  let created = null;
  try { created = await res.json(); } catch { /* non-JSON error body */ }
  let deleteStatus = null;
  if (created?.id) {
    const d = await fetch(`${base}/api/admin/setlist-items/${created.id}`, { method: "DELETE", headers: { cookie } });
    deleteStatus = d.status;
  }
  return { createStatus: res.status, createMs, rowId: created?.id ?? null, deleteStatus };
}

