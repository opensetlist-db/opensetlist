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
//     the ImageAsset rows of their logos, and nothing else: no existing
//     row is updated. References go from a fixture row to another fixture
//     row of the same spec (by key) or to an existing, not-deleted Artist
//     (by id, checked first) — never the other way, so db-fixture-rm can
//     later delete the set without detaching anything real.
//   - never touches R2. A logo's ImageAsset row points at a URL that is
//     either unresolvable by design (`https://images.test.invalid/…`, the
//     failed-image state) or an object already in the dev bucket under
//     `test/` (checked with a HEAD request first); nothing is uploaded.
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
// and defaults to the key. `name` must be a single line of at most 100
// characters (the run prefix in front of it makes the full title), and
// every `fixture` value must be a scalar — string, number or boolean —
// with a letters-and-digits key: page-qa substitutes them into URLs.
//   {
//     "fixture": { "artistId": "4", "slug": "kozue-solo" },   // passed through to the output
//     "albums": [ { "key": "cover", "type": "single", "releaseDate": "2099-01-01",
//                   "imageUrl": "https://…", "labelName": "…", "artistIds": ["4"] } ],
//     "series": [ { "key": "tour", "type": "concert_tour", "artistId": "1",
//                   "parentSeries": "<earlier series key>", "organizerName": "…",
//                   "logoMode": "custom", "logoAsset": { "width": 400, "height": 200 } } ],
//     "events": [ { "key": "day1", "startTime": "2099-01-01T09:00:00Z", "type": "concert",
//                   "status": "scheduled", "date": "2099-01-01", "series": "tour",
//                   "artistId": "1", "bdAlbum": "cover", "organizerName": "…",
//                   "originalVenue": "…", "originalCity": "…", "posterUrl": "https://…",
//                   "logoMode": "inherit" } ]
//   }
// Defaults: album type single, series type standalone, event type concert
// and status scheduled; dates / URLs / links are null unless given (an
// album or event without a date is the "undated" state). Enum values are
// checked by the database's own enum types; a value it rejects (or a date
// it can't store) is reported as a refusal, exit 2, like any spec mistake.
//
// Logos (series and events). `logoMode` is inherit (the default) |
// typography | custom, and `logoAsset` is given exactly when the mode is
// custom (left out, the mode of a row with a `logoAsset` is custom) — the
// pairing post-deploy.sql's CHECK enforces. `logoAsset` creates a NEW
// ImageAsset row for that one row:
//   { "publicUrl": "…", "width": 400, "height": 200 }
//   - width / height: positive integers up to 10000, what the page reserves.
//   - publicUrl: optional. Left out, it is
//     `https://images.test.invalid/<slug>.png` — unique per run, never
//     resolves (the failed-image state). Given, it must be under
//     `https://images.test.invalid/`, or an object already in the dev
//     bucket under `test/` (`<R2_PUBLIC_BASE_URL>/test/…`, the base an
//     `*.r2.dev` host) that answers a HEAD request with an image — for the
//     state where the logo loads. Anything else is refused. The path ends
//     in .png / .jpg / .jpeg / .webp, which sets the row's mimeType.
//     publicUrl is UNIQUE in ImageAsset: a dev-bucket object that already
//     has a row (or one run's URL used twice) is refused by the database.
// The asset's objectKey is `qa-fixture/<slug>.<ext>` — no R2 object has
// such a key — and its usageNote carries the run prefix.
//
// On Windows PowerShell 5.1, inline JSON loses its double quotes on the
// way to a native program: pass --spec as a file there, and hand page-qa
// the --out file rather than the printed JSON.
//
// Output (stdout, and --out when given; only after COMMIT): one JSON
// object that page-qa takes unchanged as `--fixture` — each row's key maps
// to its new id, beside the spec's `fixture` values — plus `_fixture` with
// the run prefix, the ids per table (ImageAsset ids under `assets`, and
// `logoAssets` mapping each row key to its asset id), the row count and
// the exact db-fixture-rm command that deletes this run's rows, assets
// included. Progress and that command go to stderr too.
//
// Env: `.env.local` first, then `.env`, from the checkout holding the cwd
// (its git top level; the script-relative repo root outside git), so a
// copy extracted into `.claude/tmp/` reads the worktree's env. The first
// stderr line names that checkout. dotenv never overrides a value
// already set.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkoutRoot, pointsAtDevProject } from "./dev-db-guard.mjs";

const SCRIPT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// `[QA] ` and then a per-ticket tag. The character set is kept to what is
// safe inside a double-quoted shell argument, because the prefix is
// printed into the db-fixture-rm command line.
const PREFIX = /^\[QA\] [A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/;
const KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const EXTRA_KEY = /^[A-Za-z][A-Za-z0-9]*$/;
const BIGINT_ID = /^[1-9][0-9]{0,17}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// An explicit offset is required: a bare local time would be read in the
// zone of whoever runs the script.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const ENUM = /^[a-z][a-z_]*$/;
// A QA state needs a handful of rows; a spec past this is a mistake.
// Logo ImageAsset rows count toward it.
const MAX_ROWS = 20;

// Logo assets. The test host is reserved (.invalid never resolves), so a
// URL under it can't load anything real; the dev bucket's `test/` prefix
// holds placeholder objects nothing else references. db-fixture-rm keeps
// its own copy of FIXTURE_ASSET_KEY (it is run without this file).
const LOGO_MODES = new Set(["inherit", "typography", "custom"]);
const TEST_IMAGE_BASE = "https://images.test.invalid/";
const FIXTURE_ASSET_KEY = "qa-fixture/";
const MIME_BY_EXT = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const MAX_LOGO_SIDE = 10000;

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
  // Years below 1000 are refused outright: Date.UTC maps 0–99 to 19xx,
  // and no QA state needs them.
  if (!m || +m[1] < 1000 || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw new UsageError(`${where} must be a YYYY-MM-DD date (year 1000 or later)`);
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

function logoMode(where, v) {
  if (!LOGO_MODES.has(v)) throw new UsageError(`${where} must be one of ${[...LOGO_MODES].join(", ")}`);
  return v;
}

function side(where, v) {
  if (!Number.isInteger(v) || v < 1 || v > MAX_LOGO_SIDE) throw new UsageError(`${where} must be an integer from 1 to ${MAX_LOGO_SIDE}`);
  return v;
}

/**
 * The dev bucket's public base, if the env names one: an https `*.r2.dev`
 * URL. The prod bucket is served from its own domain, so it never passes.
 * @param {string | undefined} raw R2_PUBLIC_BASE_URL
 * @returns {string | null} the base with one trailing slash
 */
export function devBucketBase(raw) {
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".r2.dev") || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}/`;
}

/**
 * Where a logo's publicUrl may point: the reserved test host, or the dev
 * bucket's `test/` prefix (`needsHead`: the object must exist). The
 * extension picks the mimeType.
 */
function logoUrl(where, v, bucketBase) {
  text(where, v, 2000);
  let url;
  try {
    url = new URL(v);
  } catch {
    throw new UsageError(`${where} is not a URL`);
  }
  // Compare the parsed form, so `..` segments or an encoded host can't
  // walk out of the allowed prefix.
  const href = url.href;
  // WHATWG URL leaves %2F / %5C encoded, so `test/..%2Fdev/x` would pass
  // the prefix test while a server may decode it to another prefix.
  if (href !== v || url.search || url.hash || /%(?:2f|5c)/i.test(url.pathname)) {
    throw new UsageError(`${where} must be a plain normalized URL (no query, fragment, .., or encoded slash)`);
  }
  let needsHead;
  if (href.startsWith(TEST_IMAGE_BASE)) needsHead = false;
  else if (bucketBase && href.startsWith(`${bucketBase}test/`)) needsHead = true;
  else {
    throw new UsageError(
      `${where} must be under ${TEST_IMAGE_BASE}${bucketBase ? ` or ${bucketBase}test/` : " (no dev-bucket R2_PUBLIC_BASE_URL in the env)"}`,
    );
  }
  const ext = /\.([a-z]+)$/i.exec(url.pathname)?.[1]?.toLowerCase();
  if (!ext || !(ext in MIME_BY_EXT)) throw new UsageError(`${where} must end in .${Object.keys(MIME_BY_EXT).join(" / .")}`);
  return { publicUrl: href, ext, mimeType: MIME_BY_EXT[ext], needsHead };
}

function logoAsset(where, v, ctx) {
  if (!isObject(v)) throw new UsageError(`${where} must be an object { publicUrl?, width, height }`);
  for (const k of Object.keys(v)) {
    if (!["publicUrl", "width", "height"].includes(k)) throw new UsageError(`${where}: unknown field "${k}" (publicUrl, width, height)`);
  }
  return {
    width: side(`${where}.width`, v.width),
    height: side(`${where}.height`, v.height),
    url: v.publicUrl === undefined ? null : logoUrl(`${where}.publicUrl`, v.publicUrl, ctx.bucketBase),
  };
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
      logoMode,
      logoAsset,
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
      logoMode,
      logoAsset,
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
 * @param {{ prefix: string, ms: number, bucketBase?: string | null }} run
 *   bucketBase: devBucketBase(R2_PUBLIC_BASE_URL), or null/absent when
 *   only the test host is allowed for logo URLs
 */
export function buildPlan(spec, { prefix, ms, bucketBase = null }) {
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
  const plan = { prefix: name, slugPrefix, ms, extras, albums: [], series: [], events: [], assets: [], artistIds: [] };
  const ctx = { bucketBase };

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
          values[field] = def.fields[field](`${where}.${field}`, v, ctx);
        } else {
          throw new UsageError(`${where}: unknown field "${field}" (${["key", "name", ...Object.keys(def.fields)].join(", ")})`);
        }
      }
      const slug = `${slugPrefix}${row.key}`;
      // custom ⇔ an asset, as the DB CHECK has it; checked here so the
      // mistake is a usage error naming the row, not a constraint name.
      const { logoAsset: asset, ...rest } = values;
      if (asset) {
        if (rest.logoMode !== undefined && rest.logoMode !== "custom") {
          throw new UsageError(`${where}.logoAsset needs logoMode "custom" (got "${rest.logoMode}")`);
        }
        rest.logoMode = "custom";
        const url = asset.url ?? logoUrl(`${where}.logoAsset.publicUrl`, `${TEST_IMAGE_BASE}${slug}.png`, bucketBase);
        plan.assets.push({
          owner: row.key,
          objectKey: `${FIXTURE_ASSET_KEY}${slug}.${url.ext}`,
          publicUrl: url.publicUrl,
          mimeType: url.mimeType,
          needsHead: url.needsHead,
          width: asset.width,
          height: asset.height,
        });
      } else if (rest.logoMode === "custom") {
        throw new UsageError(`${where}.logoMode "custom" needs a logoAsset`);
      }
      plan[kind].push({ key: row.key, slug, title: `${name}${values.name ?? row.key}`, ...rest });
    });
  }

  const count = plan.albums.length + plan.series.length + plan.events.length + plan.assets.length;
  if (count === 0) throw new UsageError("spec has no rows (albums / series / events)");
  if (count > MAX_ROWS) throw new UsageError(`spec has ${count} rows (logo assets included); the limit is ${MAX_ROWS}`);
  const urls = new Set(plan.assets.map((a) => a.publicUrl));
  if (urls.size !== plan.assets.length) throw new UsageError("two logoAssets share a publicUrl (ImageAsset.publicUrl is unique)");

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

/** The objectKey prefix of one run's logo assets — db-fixture-rm's --asset-prefix. */
export function assetKeyPrefix(slugPrefix) {
  return `${FIXTURE_ASSET_KEY}${slugPrefix}`;
}

/**
 * The db-fixture-rm command line that deletes exactly this run's rows.
 * @param {string} prefix the run prefix
 * @param {{ series: string[], events: string[], albums: string[], assets?: string[] }} ids
 * @param {string | null} assetPrefix assetKeyPrefix(slugPrefix), required with assets
 */
export function rmCommand(prefix, ids, assetPrefix = null) {
  const assets = ids.assets ?? [];
  const parts = ["node scripts/db-fixture-rm.mjs", `--prefix "${prefix}"`];
  const count = ids.series.length + ids.events.length + ids.albums.length + assets.length;
  parts.push(`--expect ${count}`);
  if (ids.series.length) parts.push(`--series ${ids.series.join(",")}`);
  if (ids.events.length) parts.push(`--events ${ids.events.join(",")}`);
  if (ids.albums.length) parts.push(`--albums ${ids.albums.join(",")}`);
  if (assets.length) {
    if (!assetPrefix) throw new Error("rmCommand: assets need an asset prefix");
    parts.push(`--assets ${assets.join(",")}`, `--asset-prefix "${assetPrefix}"`);
  }
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
    throw new UsageError(`--prefix must be "[QA] " followed by a tag of up to 40 letters, digits, spaces, . _ - (got ${JSON.stringify(prefix)})`);
  }
  return { prefix, spec: readJson("--spec", specArg), out, dryRun };
}

/**
 * A value starting with `{` is inline JSON; anything else is a file path.
 * page-qa's --fixture applies the same rule (its own copy).
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

// SQLSTATEs for a value the database refuses to store: a bad enum label
// (22P02 invalid_text_representation), an out-of-range date / time or
// offset (22007, 22008), a logo publicUrl another ImageAsset row already
// has (23505 unique_violation), a CHECK (23514). They are spec mistakes,
// so they refuse (exit 2) instead of looking like an infrastructure
// failure.
const BAD_VALUE = new Set(["22P02", "22007", "22008", "23505", "23514"]);

async function insertOne(client, sql, params, what) {
  let r;
  try {
    r = await client.query(sql, params);
  } catch (e) {
    if (BAD_VALUE.has(e?.code)) throw new Refusal(`refused — nothing written: ${what}: ${e.message}`);
    throw e;
  }
  if (r.rowCount !== 1) throw new Refusal(`${what}: ${r.rowCount} rows inserted, planned 1 — rolled back`);
  return r.rows[0]?.id;
}

async function run(client, plan) {
  // 1. Linked artists must exist and not be soft-deleted: a link to a
  //    deleted artist would render a state no real page has. FOR SHARE
  //    holds them until COMMIT, so a concurrent soft delete (an UPDATE)
  //    waits instead of landing between this check and the inserts.
  if (plan.artistIds.length) {
    const r = await client.query(`SELECT id::text AS id FROM "Artist" WHERE id = ANY($1::bigint[]) AND NOT "isDeleted" FOR SHARE`, [
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
  // Logo assets before the series / events that point at them. The id
  // has no DB default (Prisma generates it client-side), so it is made
  // here. byteSize is the HEAD's Content-Length for a dev-bucket object,
  // else 1: the column must be positive and nothing renders it.
  const assetOf = new Map(); // row key → asset id
  for (const a of plan.assets) {
    const id = await insertOne(
      client,
      `INSERT INTO "ImageAsset" (id, "objectKey", "publicUrl", "mimeType", "byteSize", width, height, "usageNote")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [randomUUID(), a.objectKey, a.publicUrl, a.mimeType, a.byteSize ?? 1, a.width, a.height, `${plan.prefix}logo of ${a.owner}`],
      `ImageAsset for ${a.owner}`,
    );
    assetOf.set(a.owner, id);
  }
  for (const s of plan.series) {
    const id = await insertOne(
      client,
      `INSERT INTO "EventSeries" (slug, type, "originalName", "artistId", "parentSeriesId", "organizerName", "logoMode", "logoAssetId")
       VALUES ($1, $2::"EventSeriesType", $3, $4::bigint, $5::bigint, $6, $7::"LogoDisplayMode", $8) RETURNING id::text AS id`,
      [
        s.slug,
        s.type ?? "standalone",
        s.title,
        s.artistId ?? null,
        s.parentSeries ? idOf.get(s.parentSeries) : null,
        s.organizerName ?? null,
        s.logoMode ?? "inherit",
        assetOf.get(s.key) ?? null,
      ],
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
                            "bdAlbumId", "organizerName", "originalVenue", "originalCity", "posterUrl", "logoMode", "logoAssetId")
       VALUES ($1, $2::"EventType", $3::"EventStatus", $4, $5::date, $6::timestamptz AT TIME ZONE 'UTC', $7::bigint, $8::bigint,
               $9::bigint, $10, $11, $12, $13, $14::"LogoDisplayMode", $15) RETURNING id::text AS id`,
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
        e.logoMode ?? "inherit",
        assetOf.get(e.key) ?? null,
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
    assets: plan.assets.map((a) => assetOf.get(a.owner)),
  };
  // Assets: every row under this run's objectKey prefix is one planned
  // here and carries the run prefix in its usageNote.
  const r = await client.query(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE starts_with("usageNote", $2))::int AS named
       FROM "ImageAsset" WHERE starts_with("objectKey", $1)`,
    [assetKeyPrefix(plan.slugPrefix), plan.prefix],
  );
  if (r.rows[0].n !== ids.assets.length || r.rows[0].named !== r.rows[0].n) {
    throw new Refusal(
      `ImageAsset: ${plural(r.rows[0].n, "row")} with objectKey prefix ${assetKeyPrefix(plan.slugPrefix)}, planned ${ids.assets.length} — rolled back`,
    );
  }
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
  return { idOf, ids, assetOf, links };
}

/**
 * A dev-bucket logo URL must name an object that exists and is an image,
 * or the page would show the failed state the test host already gives.
 * Fills in byteSize from Content-Length. Runs before connecting.
 */
async function checkBucketObjects(assets) {
  for (const a of assets.filter((x) => x.needsHead)) {
    let res;
    try {
      res = await fetch(a.publicUrl, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(15000) });
    } catch (e) {
      throw new Refusal(`refused — nothing written: HEAD ${a.publicUrl}: ${e instanceof Error ? e.message : e}`);
    }
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) {
      throw new Refusal(`refused — nothing written: HEAD ${a.publicUrl} → ${res.status} ${type || "(no content-type)"}; not an existing image`);
    }
    const size = Number(res.headers.get("content-length"));
    if (Number.isSafeInteger(size) && size > 0) a.byteSize = size;
  }
}

async function main(argv) {
  // The cwd picks the checkout whose env is read (see checkoutRoot): say
  // which one first, so a run from the wrong directory shows it.
  const root = checkoutRoot(SCRIPT_ROOT);
  console.error(`checkout: ${root}`);
  const opts = parseArgs(argv);

  const dotenv = (await import("dotenv")).default;
  dotenv.config({ path: [join(root, ".env.local"), join(root, ".env")], quiet: true });
  const plan = buildPlan(opts.spec, { prefix: opts.prefix, ms: Date.now(), bucketBase: devBucketBase(process.env.R2_PUBLIC_BASE_URL) });

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
  await checkBucketObjects(plan.assets);
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

  const assetPrefix = assetKeyPrefix(plan.slugPrefix);
  const rm = rmCommand(plan.prefix, result.ids, assetPrefix);
  const output = {
    ...plan.extras,
    ...Object.fromEntries(result.idOf),
    _fixture: {
      prefix: plan.prefix,
      slugPrefix: plan.slugPrefix,
      ...result.ids,
      ...(plan.assets.length ? { assetPrefix, logoAssets: Object.fromEntries(result.assetOf) } : {}),
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
  for (const a of plan.assets) console.error(`  ImageAsset ${result.assetOf.get(a.owner)} ${a.objectKey} → ${a.publicUrl} (logo of ${a.owner})`);
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
