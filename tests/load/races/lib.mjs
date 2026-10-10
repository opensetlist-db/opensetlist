// Shared plumbing for the n14 cache-race probes (run #2, "cache races on
// the preview"). See README.md in this folder for what each race does.
//
// Everything here talks to the DEPLOYED dev preview (real Vercel Data
// Cache, several function instances, real `revalidateTag` propagation)
// and to the dev database. The integration suite
// (`src/__tests__/integration/n14-live-path.test.ts`) proves the same
// invariants against one local process with barriers; here the timing is
// whatever the platform does, so every helper records raw timings and
// headers instead of asserting, and the race functions decide PASS/FAIL
// from the recorded evidence.
//
// Env / safety: `loadEnv` + `assertDev({ requireBase: true })` from the
// realtime probes (BASE_URL must be localhost or the dev-branch alias,
// Supabase URL + DATABASE_URL_UNPOOLED must be the dev project). Race 4
// additionally opens connections on DATABASE_URL (the 6543 transaction
// pooler), which `assertDev` does not look at, so `assertDevPooled`
// applies the same field-level check to that URL as well.

import pg from "pg";
import { loadEnv, assertDev, DEV_REF, sleep } from "../realtime/lib.mjs";

export { loadEnv, sleep, DEV_REF };

// Prisma maps `DateTime` to `timestamp(3)` WITHOUT time zone and stores
// UTC in it (the DB session TimeZone is UTC). node-pg parses that type
// as LOCAL time by default, which on a generator outside UTC shifts
// every `startTime` / `inserted_at` read here by the machine's offset
// (−7 h on the US-west laptop). Parse it as the UTC it is.
pg.types.setTypeParser(1114, (s) => new Date(`${s.replace(" ", "T")}Z`));

// The one event these probes may write to (task: "Use event 111 only").
// Hard-coded rather than an env var so a mis-set EVENT_ID can never
// point the saves at a real show.
export const EVENT_ID = 111;
// Rows created by this tool carry this note, so a crashed run's leftovers
// are findable (`--race=cleanup`).
export const NOTE = "n14-races";
// Visible rows event 111 must have before and after a run.
export const EXPECTED_BASE_ROWS = 23;
const COOKIE_NAME = "admin_session"; // mirrors src/lib/admin-session.ts

export function setup() {
  loadEnv();
  assertDev({ requireBase: true });
  assertDevPooled();
  if (!process.env.ADMIN_PASSWORD) {
    console.error("missing ADMIN_PASSWORD (read from .env)");
    process.exit(2);
  }
  return process.env.BASE_URL.replace(/\/+$/, "");
}

// Same parse-the-field check as realtime/lib.mjs `isDevDatabaseUrl`
// (not exported there): the pooler hostname is shared by every project in
// the region, so only the `postgres.<ref>` username identifies dev.
function assertDevPooled() {
  let u = null;
  try {
    u = new URL(process.env.DATABASE_URL || "");
  } catch {
    /* handled below */
  }
  const ok =
    !!u &&
    ((u.hostname === `db.${DEV_REF}.supabase.co`) ||
      (/^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname) &&
        decodeURIComponent(u.username) === `postgres.${DEV_REF}`));
  if (!ok) {
    console.error(`refusing: DATABASE_URL is not the dev project (${DEV_REF})`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------
// clock
// ---------------------------------------------------------------------

// All recorded times are milliseconds since the start of the run on the
// generator's monotonic clock; wall-clock instants (`servedAt`,
// `capturedAt`) come from the server / database clocks and are recorded
// verbatim — they are only ever compared with each other, never with
// the generator's clock (the laptop's clock is not synced to Vercel's).
const T0 = performance.now();
export const now = () => Math.round(performance.now() - T0);

// ---------------------------------------------------------------------
// database (session pooler, observation only + race 6 fixture)
// ---------------------------------------------------------------------

let pgc = null;
export async function db() {
  if (!pgc) {
    pgc = new pg.Client({
      connectionString: process.env.DATABASE_URL_UNPOOLED,
      connectionTimeoutMillis: 20000,
    });
    await pgc.connect();
  }
  return pgc;
}
export async function closeDb() {
  if (pgc) await pgc.end().catch(() => {});
  pgc = null;
}

export async function dbRev(eventId = EVENT_ID) {
  const r = await (await db()).query(
    `SELECT "setlistRevision"::text AS rev FROM "Event" WHERE id = $1`,
    [eventId],
  );
  return r.rows.length ? Number(r.rows[0].rev) : null;
}

export async function visibleRows(eventId = EVENT_ID) {
  const r = await (await db()).query(
    `SELECT count(*)::int AS n FROM "SetlistItem" WHERE "eventId" = $1 AND "isDeleted" = false`,
    [eventId],
  );
  return r.rows[0].n;
}

/** Live (not soft-deleted) rows this tool created, e.g. after a crash. */
export async function leftoverRows() {
  const r = await (await db()).query(
    `SELECT id::text FROM "SetlistItem"
      WHERE "eventId" = $1 AND "isDeleted" = false AND note LIKE $2`,
    [EVENT_ID, `${NOTE}%`],
  );
  return r.rows.map((x) => x.id);
}

// ---------------------------------------------------------------------
// snapshot GET with full evidence
// ---------------------------------------------------------------------

/**
 * One `/api/setlist` request. Never throws: network errors, timeouts and
 * non-JSON bodies come back as a record with `error` set.
 *
 * `vercelId` is the `X-Vercel-Id` header (`<edge>::<region>::<request id>`).
 * It is per REQUEST, not per function instance — Vercel exposes no
 * instance id on the response. The instance id only exists in the
 * `[liveSnapshot] build … instance=<id>` log line, so per-instance
 * attribution needs the Vercel runtime logs for the run's time window.
 */
export async function snap(base, { eventId = EVENT_ID, locale = "ja", minRev = null, label = "", timeoutMs = 30000, throttleMs = 0 } = {}) {
  const q = `eventId=${eventId}&locale=${locale}${minRev === null ? "" : `&minRev=${minRev}`}`;
  const sentAt = now();
  const rec = { label, locale, minRev, sentAt, recvAt: null, ms: null, http: null };
  if (throttleMs) rec.throttleMs = throttleMs;
  try {
    const res = await fetch(`${base}/api/setlist?${q}`, {
      signal: AbortSignal.timeout(timeoutMs + throttleMs),
      headers: { "cache-control": "no-cache" },
    });
    // `throttleMs`: a slow downlink for THIS response — the server has
    // already produced it (its rev/capturedAt are final), only its
    // delivery to the caller is held back, like a phone on a congested
    // cell finishing the download late.
    if (throttleMs) await new Promise((r) => setTimeout(r, throttleMs));
    const text = await res.text();
    rec.recvAt = now();
    rec.ms = rec.recvAt - sentAt;
    rec.http = res.status;
    rec.source = res.headers.get("x-snapshot-source");
    rec.vercelId = res.headers.get("x-vercel-id");
    rec.vercelCache = res.headers.get("x-vercel-cache");
    try {
      const body = JSON.parse(text);
      rec.rev = typeof body.rev === "number" ? body.rev : null;
      rec.capturedAt = body.capturedAt ?? null;
      rec.servedAt = body.servedAt ?? null;
      rec.status = body.status ?? null;
      rec.startTime = body.startTime ?? null;
      rec.items = Array.isArray(body.items) ? body.items.length : null;
      // Kept (non-enumerable) for the acceptance replay in race 5, out
      // of the JSON dump.
      Object.defineProperty(rec, "body", { value: body, enumerable: false });
    } catch {
      rec.error = `non-JSON body (${text.length} B)`;
    }
  } catch (e) {
    rec.recvAt = now();
    rec.ms = rec.recvAt - sentAt;
    rec.error = e?.name === "TimeoutError" ? `timeout ${timeoutMs} ms` : String(e?.message || e);
  }
  return rec;
}

// ---------------------------------------------------------------------
// admin session + saves (all on ONE row this tool owns)
// ---------------------------------------------------------------------

/**
 * Admin session for one run: logs in ONCE (the Firewall rate-limits
 * POST /api/admin/login per IP) and owns a single scratch row appended
 * after event 111's last position. Every "save" a race needs is a PUT on
 * that row that flips its note suffix — a real setlist writer that bumps
 * `setlistRevision`, broadcasts, and expires `event:111`, without ever
 * touching the 23 pre-existing rows. `close()` soft-deletes the row (one
 * more save) and any other rows this session created.
 */
export async function adminSession(base) {
  const login = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
  });
  const setCookie = login.headers.get("set-cookie") || "";
  const m = new RegExp(`${COOKIE_NAME}=([^;]+)`).exec(setCookie);
  if (login.status !== 200 || !m) throw new Error(`admin login failed: HTTP ${login.status}`);
  const cookie = `${COOKIE_NAME}=${m[1]}`;
  const created = [];
  let row = null; // { id, position, isEncore, songId }
  let flip = 0;
  const saves = []; // every save's timing, for the report

  const json = (method, path, body) =>
    fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

  async function timed(kind, run) {
    const sentAt = now();
    const res = await run();
    const ackAt = now();
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error body */
    }
    const rec = { kind, sentAt, ackAt, ms: ackAt - sentAt, http: res.status, rev: body?.rev ?? null };
    saves.push(rec);
    if (!res.ok) throw new Error(`${kind}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
    return { ...rec, body };
  }

  // Tail of the event, read from the DB (NOT via /api/setlist: a GET
  // would warm the very cache entries the races want cold).
  //
  // `isEncore` = "does ANY visible row of the event sit in the encore":
  // the writers' encore-order check rejects a regular row after an
  // encore row, so a row appended at the tail must be an encore row as
  // soon as one exists. Copying the CURRENT tail's flag instead is
  // fragile — if another stream's transient non-encore row happens to
  // be the tail at that moment, our row becomes a regular row after the
  // real encore and every later PUT on it is rejected (seen in a smoke
  // run while the browser stream was inserting rows).
  async function tail() {
    const r = await (await db()).query(
      `SELECT max(si.position) AS position,
              bool_or(si."isEncore") AS "isEncore",
              (SELECT s."songId"::text FROM "SetlistItemSong" s
                 JOIN "SetlistItem" x ON x.id = s."setlistItemId"
                WHERE x."eventId" = $1 AND x."isDeleted" = false
                ORDER BY x.position LIMIT 1) AS "songId"
         FROM "SetlistItem" si
        WHERE si."eventId" = $1 AND si."isDeleted" = false`,
      [EVENT_ID],
    );
    return r.rows[0];
  }

  return {
    saves,
    get rowId() {
      return row?.id ?? null;
    },
    /** Append the scratch row (a save). */
    async open() {
      const t = await tail();
      const position = t.position + 1;
      const out = await timed("create", () =>
        json("POST", "/api/admin/setlist-items", {
          eventId: String(EVENT_ID),
          position,
          isEncore: !!t.isEncore,
          note: NOTE,
          songIds: t.songId ? [Number(t.songId)] : [],
        }),
      );
      row = { id: String(out.body.id), position, isEncore: !!t.isEncore, songId: t.songId };
      created.push(row.id);
      return out;
    },
    /** One save: PUT the scratch row with a toggled note. → { rev, sentAt, ackAt, ms } */
    async save() {
      if (!row) throw new Error("adminSession.open() first");
      flip ^= 1;
      const put = () =>
        timed("update", () =>
          json("PUT", `/api/admin/setlist-items/${row.id}`, {
            position: row.position,
            isEncore: row.isEncore,
            note: flip ? `${NOTE} ` : NOTE, // trailing space toggles the value; cosmetic
            songIds: row.songId ? [Number(row.songId)] : [],
          }),
        );
      // A 400 here is the PUT's encore-order validation tripping over
      // somebody else's transient rows (e.g. tests/load/admin-writes.js
      // inserting non-encore rows after the encore tail while this tool
      // runs); a 5xx is the preview under somebody else's load. Neither
      // is a race result. The PUT rewrites our own row to the same
      // content, so repeating it is safe even when a 5xx attempt did
      // commit. Retry a few times so a concurrent stream can't crash a
      // race, and leave the failed attempts in `saves` so the report's
      // save-status line shows them.
      for (let attempt = 1; ; attempt++) {
        try {
          return await put();
        } catch (e) {
          if (attempt >= 5 || !/HTTP (400|5\d\d)/.test(e.message)) throw e;
          await sleep(1000);
        }
      }
    },
    /** Soft-delete everything this session created (each a save). */
    async close() {
      const failed = [];
      for (const id of created.splice(0)) {
        try {
          await timed("delete", () => json("DELETE", `/api/admin/setlist-items/${id}`));
        } catch (e) {
          failed.push(`${id}: ${e.message}`);
        }
      }
      row = null;
      return failed;
    },
    /** Soft-delete arbitrary leftover ids (cleanup mode). */
    async deleteIds(ids) {
      const out = [];
      for (const id of ids) {
        const r = await json("DELETE", `/api/admin/setlist-items/${id}`);
        out.push({ id, http: r.status });
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------
// small analysis helpers
// ---------------------------------------------------------------------

export function countBy(list, key) {
  const out = {};
  for (const x of list) {
    const k = typeof key === "function" ? key(x) : x[key];
    out[k ?? "—"] = (out[k ?? "—"] || 0) + 1;
  }
  return out;
}

export const fmtCounts = (o) =>
  Object.entries(o)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ") || "—";

/** Markdown table of snapshot records (relative times in ms). */
export function snapTable(records, { t0 = 0, extra = [] } = {}) {
  const cols = [
    ["label", (r) => r.label],
    ["locale", (r) => r.locale],
    ["minRev", (r) => r.minRev ?? ""],
    ["sent", (r) => r.sentAt - t0],
    ["recv", (r) => r.recvAt - t0],
    ["ms", (r) => r.ms],
    ["http", (r) => r.http ?? ""],
    ["rev", (r) => r.rev ?? ""],
    ["source", (r) => r.source ?? ""],
    ["capturedAt", (r) => r.capturedAt ?? ""],
    ["servedAt", (r) => r.servedAt ?? ""],
    ["status", (r) => r.status ?? ""],
    ["x-vercel-id", (r) => r.vercelId ?? ""],
    ["error", (r) => r.error ?? ""],
    ...extra,
  ];
  const head = `| ${cols.map((c) => c[0]).join(" | ")} |\n|${cols.map(() => "---").join("|")}|`;
  const rows = records.map((r) => `| ${cols.map((c) => String(c[1](r))).join(" | ")} |`);
  return [head, ...rows].join("\n");
}

/** Load the app's real acceptance rule (Node ≥ 22.6 strips the TS types). */
export async function loadAcceptance() {
  return import("../../../src/lib/snapshotAcceptance.ts");
}
