#!/usr/bin/env node
// Guarded INSERT of QA fixture rows in the dev DB — the counterpart of
// scripts/db-fixture-rm.mjs, for the cover / undated / empty states a page
// ticket can only show with rows that don't exist in the seed data.
//
//   node scripts/db-fixture-add.mjs --prefix "[QA] AlbumListQA" \
//     --spec <file.json | '{"albums":[…]}'> [--out <file.json>] [--dry-run]
//
// Exit status: 0 done (or dry run passed), 2 refused / bad arguments or
// spec (nothing written), 1 any other error — missing env, connection,
// SQL (rolled back).
//
// Why this exists: every ticket that needed fixture rows wrote its own
// one-off `pg` insert, and a one-off script is where the mistakes happen
// (a guard left out, a name db-fixture-rm's prefix won't match, ids copied
// by hand into the delete command). What it guarantees, mirroring
// db-fixture-rm:
//   - dev only: refuses, before connecting, any URL that is not the dev
//     Supabase project (scripts/dev-db-guard.mjs). The prod DB is never
//     touched locally.
//   - session pooler only: DATABASE_URL_UNPOOLED (port 5432), no fallback
//     to the transaction pooler. The only settings it issues are
//     `SET LOCAL` (they end with the transaction); a session-level SET
//     through Supavisor leaks to other clients (the 2026-10-18 read-only
//     incident).
//   - new rows only. It writes the fixture rows, their AlbumArtist links,
//     and nothing else: no existing row is updated. References go from a
//     fixture row to another fixture row of the same spec (by key) or to
//     an existing, not-deleted Artist (by id, checked first) — never the
//     other way, so db-fixture-rm can later delete the set without
//     detaching anything real.
//   - every name is marked: each row's originalTitle / originalName is
//     `<--prefix> <run ms> <name>`, the prefix must start with `[QA] `,
//     and each slug is `<prefix tag>-<run ms>-<key>`. The run timestamp
//     makes the slugs unique and gives db-fixture-rm a prefix that matches
//     this run's rows and no other run's.
//   - one transaction; after the inserts it re-counts, per table, the rows
//     carrying this run's slug prefix and checks every name against the
//     run prefix. Any mismatch → ROLLBACK and a message.
//   - --dry-run performs the inserts and checks, prints what it would
//     output, then rolls back. (Sequence values it drew stay consumed —
//     harmless gaps in the ids.)
//
// Spec (JSON object; unknown fields are refused, so a typo can't be
// silently dropped). Every row needs a `key` (lowercase, digits, hyphens),
// unique across the whole spec; `name` is the readable tail of the title
// and defaults to the key.
//   {
//     "fixture": { "artistId": "4", "slug": "kozue-solo" },   // passed through to the output
//     "albums": [ { "key": "cover", "type": "single", "releaseDate": "2099-01-01",
//                   "imageUrl": "https://…", "labelName": "…", "artistIds": ["4"] } ],
//     "series": [ { "key": "tour", "type": "concert_tour", "artistId": "1",
//                   "parentSeries": "<earlier series key>", "organizerName": "…" } ],
//     "events": [ { "key": "day1", "startTime": "2099-01-01T09:00:00Z", "type": "concert",
//                   "status": "scheduled", "date": "2099-01-01", "series": "tour",
//                   "artistId": "1", "bdAlbum": "cover", "organizerName": "…",
//                   "originalVenue": "…", "originalCity": "…", "posterUrl": "https://…" } ]
//   }
// Defaults: album type single, series type standalone, event type concert
// and status scheduled; dates / URLs / links are null unless given (an
// album or event without a date is the "undated" state). Enum values are
// checked by the database's own enum types.
//
// Output (stdout, and --out when given; only after COMMIT): one JSON
// object that page-qa takes unchanged as `--fixture` — each row's key maps
// to its new id, beside the spec's `fixture` values — plus `_fixture` with
// the run prefix, the ids per table, the row count and the exact
// db-fixture-rm command that deletes this run's rows. Progress and that
// command go to stderr too.
//
// Env: `.env.local` first, then `.env`, both from the repo root (dotenv
// never overrides a value already set). Runs from any task worktree.

import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pointsAtDevProject } from "./dev-db-guard.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// `[QA] ` and then a per-ticket tag. The character set is kept to what is
// safe inside a double-quoted shell argument, because the prefix is
// printed into the db-fixture-rm command line.
const PREFIX = /^\[QA\] [A-Za-z0-9][A-Za-z0-9 ._-]*$/;
const KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const EXTRA_KEY = /^[A-Za-z][A-Za-z0-9]*$/;
const BIGINT_ID = /^[1-9][0-9]{0,17}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// An explicit offset is required: a bare local time would be read in the
// zone of whoever runs the script.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const ENUM = /^[a-z][a-z_]*$/;
// A QA state needs a handful of rows; a spec past this is a mistake.
const MAX_ROWS = 20;

export class UsageError extends Error {}
class Refusal extends Error {}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function text(where, v, max = 200) {
  if (typeof v !== "string" || !v.trim() || v.length > max || /[\u0000-\u001f]/.test(v)) {
    throw new UsageError(`${where} must be a non-empty single-line string (≤ ${max} chars)`);
  }
  return v;
}

function httpUrl(where, v) {
  text(where, v, 2000);
  let url;
  try {
    url = new URL(v);
  } catch {
    throw new UsageError(`${where} is not a URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UsageError(`${where} must be http(s)`);
  return v;
}

function day(where, v) {
  const m = typeof v === "string" && DATE.exec(v);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw new UsageError(`${where} must be a YYYY-MM-DD date`);
  }
  return v;
}

function instant(where, v) {
  if (typeof v !== "string" || !INSTANT.test(v) || Number.isNaN(Date.parse(v))) {
    throw new UsageError(`${where} must be an ISO date-time with Z or an offset (e.g. 2099-01-01T09:00:00Z)`);
  }
  return v;
}

function enumValue(where, v) {
  if (typeof v !== "string" || !ENUM.test(v)) throw new UsageError(`${where} must be an enum value like "concert_tour"`);
  return v;
}

function artistId(where, v) {
  const s = typeof v === "number" && Number.isSafeInteger(v) ? String(v) : v;
  if (typeof s !== "string" || !BIGINT_ID.test(s)) throw new UsageError(`${where} must be an existing artist's numeric id`);
  return s;
}

// Per kind: the table, the column the prefix goes into, and each allowed
// field's validator. A field left out is null in the plan (or the default
// noted in the header).
const KINDS = {
  albums: {
    table: "Album",
    nameColumn: "originalTitle",
    fields: {
      type: enumValue,
      releaseDate: day,
      imageUrl: httpUrl,
      labelName: (w, v) => text(w, v),
      artistIds: (w, v) => {
        if (!Array.isArray(v) || v.length === 0) throw new UsageError(`${w} must be a non-empty array of artist ids`);
        const ids = v.map((x, i) => artistId(`${w}[${i}]`, x));
        if (new Set(ids).size !== ids.length) throw new UsageError(`${w} has a duplicate id`);
        return ids;
      },
    },
  },
  series: {
    table: "EventSeries",
    nameColumn: "originalName",
    fields: {
      type: enumValue,
      artistId,
      parentSeries: (w, v) => text(w, v),
      organizerName: (w, v) => text(w, v),
    },
  },
  events: {
    table: "Event",
    nameColumn: "originalName",
    fields: {
      startTime: instant,
      type: enumValue,
      status: enumValue,
      date: day,
      series: (w, v) => text(w, v),
      artistId,
      bdAlbum: (w, v) => text(w, v),
      organizerName: (w, v) => text(w, v),
      originalVenue: (w, v) => text(w, v),
      originalCity: (w, v) => text(w, v),
      posterUrl: httpUrl,
    },
  },
};

/** The run's name prefix: what every title starts with, and what db-fixture-rm gets as --prefix. */
export function runPrefix(prefix, ms) {
  return `${prefix.trimEnd()} ${ms} `;
}

/** The slug stem from the prefix tag: "[QA] AlbumListQA" → "albumlistqa". */
export function slugBase(prefix) {
  return prefix
    .slice("[QA] ".length)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Validate a spec and turn it into the rows to insert. Pure — every spec
 * mistake fails here, before any connection.
 * @param {unknown} spec
 * @param {{ prefix: string, ms: number }} run
 */
export function buildPlan(spec, { prefix, ms }) {
  if (!isObject(spec)) throw new UsageError("spec must be a JSON object");
  for (const k of Object.keys(spec)) {
    if (k !== "fixture" && !(k in KINDS)) throw new UsageError(`spec: unknown field "${k}" (fixture, albums, series, events)`);
  }
  const extras = spec.fixture ?? {};
  if (!isObject(extras)) throw new UsageError("spec.fixture must be an object");
  for (const [k, v] of Object.entries(extras)) {
    if (!EXTRA_KEY.test(k)) throw new UsageError(`spec.fixture: key "${k}" must be letters and digits`);
    if (!["string", "number", "boolean"].includes(typeof v)) throw new UsageError(`spec.fixture.${k} must be a string, number or boolean`);
  }

  const name = runPrefix(prefix, ms);
  const slugPrefix = `${slugBase(prefix)}-${ms}-`;
  const keys = new Set(Object.keys(extras));
  const plan = { prefix: name, slugPrefix, ms, extras, albums: [], series: [], events: [], artistIds: [] };

  for (const [kind, def] of Object.entries(KINDS)) {
    const list = spec[kind] ?? [];
    if (!Array.isArray(list)) throw new UsageError(`spec.${kind} must be an array`);
    list.forEach((row, i) => {
      const where = `spec.${kind}[${i}]`;
      if (!isObject(row)) throw new UsageError(`${where} must be an object`);
      if (typeof row.key !== "string" || !KEY.test(row.key)) {
        throw new UsageError(`${where}.key must be lowercase letters, digits and single hyphens`);
      }
      if (keys.has(row.key)) throw new UsageError(`${where}.key "${row.key}" is used twice (keys are unique across the spec and spec.fixture)`);
      keys.add(row.key);
      const values = {};
      for (const [field, v] of Object.entries(row)) {
        if (field === "key") continue;
        if (field === "name") {
          values.name = text(`${where}.name`, v, 100);
        } else if (field in def.fields) {
          values[field] = def.fields[field](`${where}.${field}`, v);
        } else {
          throw new UsageError(`${where}: unknown field "${field}" (${["key", "name", ...Object.keys(def.fields)].join(", ")})`);
        }
      }
      plan[kind].push({
        key: row.key,
        slug: `${slugPrefix}${row.key}`,
        title: `${name}${values.name ?? row.key}`,
        ...values,
      });
    });
  }

  const count = plan.albums.length + plan.series.length + plan.events.length;
  if (count === 0) throw new UsageError("spec has no rows (albums / series / events)");
  if (count > MAX_ROWS) throw new UsageError(`spec has ${count} rows; the limit is ${MAX_ROWS}`);

  // Fixture-to-fixture references by key, resolved in insert order:
  // albums, then series (a parent before its child), then events.
  const albumKeys = new Set(plan.albums.map((r) => r.key));
  const seen = new Set();
  for (const [i, s] of plan.series.entries()) {
    if (s.parentSeries !== undefined && !seen.has(s.parentSeries)) {
      throw new UsageError(`spec.series[${i}].parentSeries "${s.parentSeries}" is not the key of an earlier series in the spec`);
    }
    seen.add(s.key);
  }
  for (const [i, e] of plan.events.entries()) {
    if (e.startTime === undefined) throw new UsageError(`spec.events[${i}].startTime is required`);
    if (e.series !== undefined && !seen.has(e.series)) {
      throw new UsageError(`spec.events[${i}].series "${e.series}" is not the key of a series in the spec`);
    }
    if (e.bdAlbum !== undefined && !albumKeys.has(e.bdAlbum)) {
      throw new UsageError(`spec.events[${i}].bdAlbum "${e.bdAlbum}" is not the key of an album in the spec`);
    }
  }

  plan.artistIds = [
    ...new Set([
      ...plan.albums.flatMap((a) => a.artistIds ?? []),
      ...plan.series.map((s) => s.artistId).filter(Boolean),
      ...plan.events.map((e) => e.artistId).filter(Boolean),
    ]),
  ];
  plan.count = count;
  return plan;
}

/** The db-fixture-rm command line that deletes exactly this run's rows. */
export function rmCommand(prefix, ids) {
  const parts = ["node scripts/db-fixture-rm.mjs", `--prefix "${prefix}"`];
  const count = ids.series.length + ids.events.length + ids.albums.length;
  parts.push(`--expect ${count}`);
  if (ids.series.length) parts.push(`--series ${ids.series.join(",")}`);
  if (ids.events.length) parts.push(`--events ${ids.events.join(",")}`);
  if (ids.albums.length) parts.push(`--albums ${ids.albums.join(",")}`);
  return parts.join(" ");
}

function optionValue(flag, value) {
  if (value === undefined || value.startsWith("--")) throw new UsageError(`${flag} needs a value`);
  return value;
}

const USAGE =
  'usage: node scripts/db-fixture-add.mjs --prefix "[QA] <Tag>" --spec <file.json | {json}> [--out <file.json>] [--dry-run]';

/**
 * Parse the arguments (the spec is read but not yet validated).
 * @param {string[]} argv
 * @returns {{ prefix: string, spec: unknown, out: string | null, dryRun: boolean }}
 */
export function parseArgs(argv) {
  let prefix = null;
  let specArg = null;
  let out = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--prefix") prefix = optionValue(arg, argv[++i]);
    else if (arg === "--spec") specArg = optionValue(arg, argv[++i]);
    else if (arg === "--out") out = optionValue(arg, argv[++i]);
    else if (arg === "--dry-run") dryRun = true;
    else throw new UsageError(`unknown argument ${arg}\n${USAGE}`);
  }
  if (prefix === null || specArg === null) throw new UsageError(USAGE);
  if (!PREFIX.test(prefix)) {
    throw new UsageError(`--prefix must be "[QA] " followed by a tag of letters, digits, spaces, . _ - (got ${JSON.stringify(prefix)})`);
  }
  return { prefix, spec: readJson("--spec", specArg), out, dryRun };
}

/**
 * A value starting with `{` is inline JSON; anything else is a file path.
 * Shared rule with page-qa's --fixture.
 */
export function readJson(flag, value) {
  const inline = value.trimStart().startsWith("{");
  let raw;
  try {
    raw = inline ? value : fs.readFileSync(value, "utf8");
  } catch (e) {
    throw new UsageError(`${flag} ${value}: ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new UsageError(`${flag}${inline ? " (inline JSON)" : ` ${value}`}: ${e.message}`);
  }
}

/** Hide any connection string that slips into an error message. */
function redact(text) {
  return String(text).replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***");
}

function describeTarget(raw) {
  const url = new URL(raw);
  return `${decodeURIComponent(url.username)}@${url.hostname}:${url.port || "5432"}${url.pathname}`;
}

async function insertOne(client, sql, params, what) {
  const r = await client.query(sql, params);
  if (r.rowCount !== 1) throw new Refusal(`${what}: ${r.rowCount} rows inserted, planned 1 — rolled back`);
  return r.rows[0]?.id;
}

async function run(client, plan) {
  // 1. Linked artists must exist and not be soft-deleted: a link to a
  //    deleted artist would render a state no real page has.
  if (plan.artistIds.length) {
    const r = await client.query(`SELECT id::text AS id FROM "Artist" WHERE id = ANY($1::bigint[]) AND NOT "isDeleted"`, [
      plan.artistIds,
    ]);
    const found = new Set(r.rows.map((x) => x.id));
    const missing = plan.artistIds.filter((id) => !found.has(id));
    if (missing.length) throw new Refusal(`refused — nothing written: no live Artist with id ${missing.join(", ")}`);
  }

  // 2. Inserts. `idOf` maps a spec key to its new id, for both the
  //    references between fixture rows and the output.
  const idOf = new Map();
  let links = 0;
  for (const a of plan.albums) {
    const id = await insertOne(
      client,
      `INSERT INTO "Album" (slug, type, "originalTitle", "releaseDate", "imageUrl", "labelName")
       VALUES ($1, $2::"AlbumType", $3, $4::date, $5, $6) RETURNING id::text AS id`,
      [a.slug, a.type ?? "single", a.title, a.releaseDate ?? null, a.imageUrl ?? null, a.labelName ?? null],
      `Album ${a.key}`,
    );
    idOf.set(a.key, id);
    for (const artist of a.artistIds ?? []) {
      await insertOne(client, `INSERT INTO "AlbumArtist" ("albumId", "artistId") VALUES ($1::bigint, $2::bigint)`, [id, artist], `AlbumArtist ${a.key}`);
      links++;
    }
  }
  for (const s of plan.series) {
    const id = await insertOne(
      client,
      `INSERT INTO "EventSeries" (slug, type, "originalName", "artistId", "parentSeriesId", "organizerName")
       VALUES ($1, $2::"EventSeriesType", $3, $4::bigint, $5::bigint, $6) RETURNING id::text AS id`,
      [s.slug, s.type ?? "standalone", s.title, s.artistId ?? null, s.parentSeries ? idOf.get(s.parentSeries) : null, s.organizerName ?? null],
      `EventSeries ${s.key}`,
    );
    idOf.set(s.key, id);
  }
  for (const e of plan.events) {
    // startTime is a UTC `timestamp` column: pass the ISO string and
    // convert in SQL, never a JS Date (pg would render it in local time).
    const id = await insertOne(
      client,
      `INSERT INTO "Event" (slug, type, status, "originalName", date, "startTime", "eventSeriesId", "artistId",
                            "bdAlbumId", "organizerName", "originalVenue", "originalCity", "posterUrl")
       VALUES ($1, $2::"EventType", $3::"EventStatus", $4, $5::date, $6::timestamptz AT TIME ZONE 'UTC', $7::bigint, $8::bigint,
               $9::bigint, $10, $11, $12, $13) RETURNING id::text AS id`,
      [
        e.slug,
        e.type ?? "concert",
        e.status ?? "scheduled",
        e.title,
        e.date ?? null,
        e.startTime,
        e.series ? idOf.get(e.series) : null,
        e.artistId ?? null,
        e.bdAlbum ? idOf.get(e.bdAlbum) : null,
        e.organizerName ?? null,
        e.originalVenue ?? null,
        e.originalCity ?? null,
        e.posterUrl ?? null,
      ],
      `Event ${e.key}`,
    );
    idOf.set(e.key, id);
  }

  // 3. Re-check from the tables: this run's slug prefix matches exactly
  //    the rows inserted (no earlier row shares it), and every one of them
  //    carries the run prefix db-fixture-rm will be given.
  const ids = {
    series: plan.series.map((s) => idOf.get(s.key)),
    events: plan.events.map((e) => idOf.get(e.key)),
    albums: plan.albums.map((a) => idOf.get(a.key)),
  };
  for (const [kind, def] of Object.entries(KINDS)) {
    const r = await client.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE starts_with(${client.escapeIdentifier(def.nameColumn)}, $2))::int AS named
         FROM ${client.escapeIdentifier(def.table)} WHERE starts_with(slug, $1)`,
      [plan.slugPrefix, plan.prefix],
    );
    const { n, named } = r.rows[0];
    if (n !== ids[kind].length || named !== n) {
      throw new Refusal(
        `${def.table}: ${plural(n, "row")} with slug prefix ${plan.slugPrefix} (${named} named ${JSON.stringify(plan.prefix)}), planned ${ids[kind].length} — rolled back`,
      );
    }
  }
  return { idOf, ids, links };
}

async function main(argv) {
  const opts = parseArgs(argv);
  const plan = buildPlan(opts.spec, { prefix: opts.prefix, ms: Date.now() });

  const dotenv = (await import("dotenv")).default;
  dotenv.config({ path: [join(REPO_ROOT, ".env.local"), join(REPO_ROOT, ".env")], quiet: true });

  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) {
    console.error(
      "db-fixture-add: DATABASE_URL_UNPOOLED is not set (.env.local / .env) — the session pooler is required, there is no fallback",
    );
    return 1;
  }
  if (!pointsAtDevProject(connectionString)) {
    console.error(
      "db-fixture-add: refused — DATABASE_URL_UNPOOLED does not point at the dev Supabase project; this script never connects anywhere else",
    );
    return 2;
  }
  // 6543 is Supavisor's transaction pooler; an UNPOOLED variable pointing
  // there is a misconfiguration this script must not paper over.
  if (new URL(connectionString).port === "6543") {
    console.error("db-fixture-add: refused — DATABASE_URL_UNPOOLED uses port 6543 (transaction pooler); use the session pooler (5432)");
    return 2;
  }
  console.error(`db-fixture-add: ${describeTarget(connectionString)}${opts.dryRun ? " (dry run: BEGIN … ROLLBACK)" : ""}`);

  const { Client } = (await import("pg")).default;
  const client = new Client({ connectionString });
  let result;
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SET LOCAL lock_timeout = '10s'");
    result = await run(client, plan);
    await client.query(opts.dryRun ? "ROLLBACK" : "COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }

  const rm = rmCommand(plan.prefix, result.ids);
  const output = {
    ...plan.extras,
    ...Object.fromEntries(result.idOf),
    _fixture: {
      prefix: plan.prefix,
      slugPrefix: plan.slugPrefix,
      ...result.ids,
      albumArtists: result.links,
      count: plan.count,
      rm,
    },
  };
  const json = JSON.stringify(output);

  console.error(`\n${opts.dryRun ? "plan (dry run)" : "created"}:`);
  for (const [kind, def] of Object.entries(KINDS)) {
    for (const row of plan[kind]) console.error(`  ${def.table} ${result.idOf.get(row.key)} ${row.slug} ${JSON.stringify(row.title)}`);
  }
  if (result.links) console.error(`  AlbumArtist: ${plural(result.links, "row")}`);

  if (opts.dryRun) {
    console.error(`\ndry run passed — ROLLBACK, nothing written. The output would be (ids not reserved):\n${json}`);
    return 0;
  }
  // The rows are committed now, so the ids and the delete command reach
  // the terminal before anything else can fail (an unwritable --out).
  console.error(`\nCOMMIT — done. Delete with (dry run first):\n  ${rm} --dry-run\n  ${rm}`);
  console.log(json);
  if (opts.out) {
    fs.writeFileSync(opts.out, `${json}\n`);
    console.error(`fixture JSON written to ${opts.out}`);
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`db-fixture-add: ${redact(e instanceof Error ? e.message : e)}`);
      process.exit(e instanceof UsageError || e instanceof Refusal ? 2 : 1);
    },
  );
}
