#!/usr/bin/env node
// Guarded HARD delete of QA fixture rows in the dev DB — the rows an agent
// created through the admin UI / API during browser QA.
//
//   node scripts/db-fixture-rm.mjs --prefix "[QA] " --expect 3 \
//     --series 41,42 --events 901 [--albums 77] \
//     [--assets <uuid>,… --asset-prefix dev/event-series-logo/] [--dry-run]
//
// --expect counts every row named by id, assets included. Exit status:
// 0 done (or dry run passed), 2 refused / bad arguments (nothing deleted),
// 1 any other error — missing env, connection, SQL (rolled back).
//
// Why this exists: the admin API only soft-deletes (and some entities not
// at all), and scripts/db-ro.mjs is read-only by design, so every QA pass
// that left fixtures behind wrote its own one-off `pg` delete script. A
// one-off script is where the dangerous mistakes happen (a missing WHERE,
// a prefix that also matches real data, a child row silently SET NULL),
// so this is the one reviewed version. What it guarantees:
//   - dev only: refuses, before connecting, any URL that is not the dev
//     Supabase project (scripts/dev-db-guard.mjs, the rule the
//     integration tests and db-ro use). The prod DB is never touched
//     locally.
//   - session pooler only: DATABASE_URL_UNPOOLED (port 5432, one backend
//     per client), with no fallback to the transaction pooler. The only
//     settings it issues are `SET LOCAL` (they end with the transaction);
//     a session-level SET through Supavisor leaks to other clients (the
//     2026-10-18 read-only incident).
//   - explicit ids AND a name prefix AND an expected count: every row's
//     original name (Album: original title; asset: objectKey against
//     --asset-prefix) must start with the prefix, and --expect must equal
//     both the number of ids typed and the number of rows found — so a
//     mistyped id list or a prefix that doesn't fit the rows refuses the
//     run. The ids are the selector; the prefix and count only confirm it.
//   - nothing outside the fixture set may reference a fixture row. The FK
//     part reads the foreign keys from pg_catalog instead of a hand-kept
//     list, so a table that gains an FK later is covered without editing
//     this file. References WITHOUT an FK are hand-checked and must be
//     added here when the schema grows one: Album.imageUrl = an asset's
//     publicUrl, and Comment's string / roll-up event and series columns.
//     A reference from another fixture row is fine (an event inside a
//     fixture series, a fixture series' logo asset); a reference from
//     anywhere else — a real event under the series, a setlist item, an
//     album track, a comment — refuses the whole run. This matters beyond
//     Restrict FKs: Prisma's default for an optional relation is
//     SET NULL, so deleting a series a real event pointed at would
//     silently detach that event instead of failing.
//   - owned rows go with their parent: translations, plus the two pure
//     link tables the admin create forms write (EventPerformer,
//     AlbumArtist). They hold nothing of their own, only the link to an
//     existing artist / stage identity, which stays. Any FK pointing at
//     an owned row refuses the run too (none exists today).
//   - one transaction, fixture rows locked FOR UPDATE (which blocks a
//     concurrent insert of an FK child row; the hand-checked non-FK
//     references are a snapshot, which is enough on the dev DB), every
//     UPDATE / DELETE row count checked against the plan; any mismatch →
//     ROLLBACK and a message.
//   - --dry-run runs every check and prints the plan, then rolls back.
//
// It never touches R2. A deleted ImageAsset's object stays in the bucket
// (objects are immutable and may still be served from a cache), so the
// script prints the keys: list them in the QA handoff.
//
// Env: `.env.local` first, then `.env`, both from the repo root (dotenv
// never overrides a value already set). Runs from any task worktree.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pointsAtDevProject } from "./dev-db-guard.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The fixture entity tables, in DELETE order: Event first (it points at
// EventSeries, Album and ImageAsset), ImageAsset last (both logo FKs point
// at it). `prefixColumn` is the column the prefix is checked against; `owned` are
// the child tables deleted with the parent (found by their FK to it).
const ENTITIES = [
  { flag: "events", table: "Event", idType: "bigint", prefixColumn: "originalName", owned: ["EventTranslation", "EventPerformer"] },
  { flag: "series", table: "EventSeries", idType: "bigint", prefixColumn: "originalName", owned: ["EventSeriesTranslation"] },
  { flag: "albums", table: "Album", idType: "bigint", prefixColumn: "originalTitle", owned: ["AlbumTranslation", "AlbumArtist"] },
  { flag: "assets", table: "ImageAsset", idType: "text", prefixColumn: "objectKey", owned: [] },
];

// Fixture tables that carry a managed logo. A custom logo needs an asset
// (a CHECK in post-deploy.sql), so clearing the reference also resets the
// mode, as the admin "remove logo" action does.
const LOGO_TABLES = new Set(["Event", "EventSeries"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A prefix that short would match far more than one QA run's rows; the
// ids are the real selector, but the prefix must still mean something.
const MIN_PREFIX = 3;

export class UsageError extends Error {}
class Refusal extends Error {}

function idList(flag, value, idType) {
  if (!value || value.startsWith("--")) throw new UsageError(`--${flag} needs a comma-separated id list`);
  const ids = value.split(",").map((s) => s.trim()).filter(Boolean);
  for (const id of ids) {
    const ok = idType === "bigint" ? /^[1-9][0-9]{0,17}$/.test(id) : UUID.test(id);
    if (!ok) throw new UsageError(`--${flag}: "${id}" is not a valid ${idType === "bigint" ? "numeric id" : "uuid"}`);
  }
  return ids;
}

function optionValue(flag, value) {
  if (value === undefined || value.startsWith("--")) throw new UsageError(`${flag} needs a value`);
  return value;
}

/**
 * Parse and cross-check the arguments; every usage mistake fails here,
 * before any connection.
 * @param {string[]} argv
 * @returns {{ ids: Record<string, string[]>, prefix: string | null, assetPrefix: string | null, expect: number, dryRun: boolean }}
 */
export function parseArgs(argv) {
  const ids = Object.fromEntries(ENTITIES.map((e) => [e.table, []]));
  let prefix = null;
  let assetPrefix = null;
  let expect = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const entity = ENTITIES.find((e) => `--${e.flag}` === arg);
    if (entity) {
      ids[entity.table].push(...idList(entity.flag, argv[++i], entity.idType));
    } else if (arg === "--prefix") {
      prefix = optionValue(arg, argv[++i]);
    } else if (arg === "--asset-prefix") {
      assetPrefix = optionValue(arg, argv[++i]);
    } else if (arg === "--expect") {
      const v = optionValue(arg, argv[++i]);
      if (!/^[1-9][0-9]*$/.test(v)) throw new UsageError("--expect needs a positive integer");
      expect = Number(v);
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else {
      throw new UsageError(`unknown argument ${arg}`);
    }
  }
  for (const e of ENTITIES) {
    if (new Set(ids[e.table]).size !== ids[e.table].length) throw new UsageError(`--${e.flag}: duplicate id`);
  }
  const total = Object.values(ids).reduce((n, list) => n + list.length, 0);
  if (total === 0) throw new UsageError(USAGE);
  if (expect === null) {
    throw new UsageError("--expect <n> is required: the number of rows (all types, assets included) you mean to delete");
  }
  if (expect !== total) throw new UsageError(`--expect ${expect} but ${total} id${total === 1 ? "" : "s"} given`);
  const named = total - ids.ImageAsset.length;
  if (named > 0 && (prefix === null || prefix.trim().length < MIN_PREFIX)) {
    throw new UsageError(`--prefix is required (≥ ${MIN_PREFIX} non-space characters) with --series / --events / --albums`);
  }
  if (ids.ImageAsset.length > 0 && (assetPrefix === null || assetPrefix.trim().length < MIN_PREFIX)) {
    throw new UsageError(`--asset-prefix is required (≥ ${MIN_PREFIX} non-space characters) with --assets`);
  }
  return { ids, prefix, assetPrefix, expect, dryRun };
}

const USAGE =
  "usage: node scripts/db-fixture-rm.mjs --prefix <name-prefix> --expect <n> " +
  "[--series ids] [--events ids] [--albums ids] [--assets uuids --asset-prefix <objectKey-prefix>] [--dry-run]";

/** Hide any connection string that slips into an error message. */
function redact(text) {
  return String(text).replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***");
}

function describeTarget(raw) {
  const url = new URL(raw);
  return `${decodeURIComponent(url.username)}@${url.hostname}:${url.port || "5432"}${url.pathname}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Every FK pointing at `table`: child table, child column, whether the
 * child column may be NULL, and the referenced (parent) column. Composite
 * FKs and FKs from another schema don't exist here; either showing up
 * would make the reference check incomplete (the queries below address
 * tables in `public` by bare name), so it refuses instead of guessing.
 */
async function referencingKeys(client, table) {
  const r = await client.query(
    `SELECT c.conname, ns.nspname AS schema, ch.relname AS child, a.attname AS col,
            NOT a.attnotnull AS nullable, pa.attname AS pcol, cardinality(c.conkey) AS ncols
       FROM pg_constraint c
       JOIN pg_class ch ON ch.oid = c.conrelid
       JOIN pg_namespace ns ON ns.oid = ch.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
      WHERE c.contype = 'f'
        AND c.confrelid = (SELECT oid FROM pg_class WHERE relname = $1 AND relnamespace = 'public'::regnamespace)
      ORDER BY ch.relname, a.attname`,
    [table],
  );
  for (const row of r.rows) {
    if (row.ncols !== 1) throw new Refusal(`${row.child}.${row.conname} is a composite FK to ${table} — this script can't check it`);
    if (row.schema !== "public") {
      throw new Refusal(`${row.schema}.${row.child}.${row.col} references ${table} from outside the public schema — this script can't check it`);
    }
  }
  return r.rows;
}

async function run(client, { ids, prefix, assetPrefix, expect, dryRun }) {
  const q = (name) => client.escapeIdentifier(name);
  const active = ENTITIES.filter((e) => ids[e.table].length > 0);
  const byTable = Object.fromEntries(ENTITIES.map((e) => [e.table, e]));
  const prefixOf = (e) => (e.table === "ImageAsset" ? assetPrefix : prefix);
  const problems = [];

  // 1. The fixture rows themselves, locked. FOR UPDATE conflicts with the
  //    KEY SHARE lock an FK insert takes on its parent, so no new child
  //    row can appear between the checks below and the deletes.
  const rows = {};
  for (const e of active) {
    const r = await client.query(
      `SELECT id::text AS id, ${q(e.prefixColumn)} AS label, starts_with(${q(e.prefixColumn)}, $2) AS matches
         FROM ${q(e.table)} WHERE id = ANY($1::${e.idType}[]) ORDER BY id FOR UPDATE`,
      [ids[e.table], prefixOf(e)],
    );
    rows[e.table] = r.rows;
    const found = new Set(r.rows.map((x) => x.id));
    const missing = ids[e.table].filter((id) => !found.has(id));
    if (missing.length) problems.push(`${e.table}: no row with id ${missing.join(", ")}`);
    for (const x of r.rows) {
      if (!x.matches) {
        problems.push(`${e.table} ${x.id}: ${e.prefixColumn} ${JSON.stringify(x.label)} does not start with ${JSON.stringify(prefixOf(e))}`);
      }
    }
  }
  const found = Object.values(rows).reduce((n, list) => n + list.length, 0);
  if (found !== expect) problems.push(`found ${plural(found, "row")}, --expect ${expect}`);

  // 2. References. Owned children are planned for deletion; a reference
  //    from another fixture row is planned for detaching; anything else
  //    blocks the run.
  const ownedPlan = []; // { parent, child, col, count }
  const detachPlan = []; // { child, col, ids }
  for (const e of active) {
    for (const fk of await referencingKeys(client, e.table)) {
      if (e.owned.includes(fk.child)) {
        const r = await client.query(
          `SELECT count(*)::int AS n FROM ${q(fk.child)} WHERE ${q(fk.col)} = ANY($1::${e.idType}[])`,
          [ids[e.table]],
        );
        ownedPlan.push({ parent: e, child: fk.child, col: fk.col, count: r.rows[0].n });
        // One level further: an FK pointing at an owned row would be
        // nulled or block the delete, so any row behind one refuses.
        for (const gfk of await referencingKeys(client, fk.child)) {
          const g = await client.query(
            `SELECT count(*)::int AS n FROM ${q(gfk.child)}
              WHERE ${q(gfk.col)} IN (SELECT ${q(gfk.pcol)} FROM ${q(fk.child)} WHERE ${q(fk.col)} = ANY($1::${e.idType}[]))`,
            [ids[e.table]],
          );
          if (g.rows[0].n > 0) problems.push(`${gfk.child}.${gfk.col} → ${fk.child}: ${plural(g.rows[0].n, "row")} reference rows owned by the fixtures`);
        }
        continue;
      }
      // Every referencing table that isn't owned has an `id` column in
      // this schema (only the owned link tables like AlbumArtist lack
      // one); `ctid` is the fallback so an id-less table still reports.
      const inSet = byTable[fk.child] ? ids[fk.child] : [];
      const idCol = byTable[fk.child] ? "id::text" : "ctid::text";
      const r = await client.query(
        `SELECT ${idCol} AS id, (${idCol} = ANY($2::text[])) AS internal
           FROM ${q(fk.child)} WHERE ${q(fk.col)} = ANY($1::${e.idType}[])`,
        [ids[e.table], inSet],
      );
      const outside = r.rows.filter((x) => !x.internal).map((x) => x.id);
      if (outside.length) {
        const shown = outside.slice(0, 5).join(", ") + (outside.length > 5 ? ", …" : "");
        problems.push(`${fk.child}.${fk.col} → ${e.table}: ${plural(outside.length, "row")} outside the fixture set (${shown})`);
      }
      const internal = r.rows.filter((x) => x.internal).map((x) => x.id);
      if (internal.length) {
        if (!fk.nullable) problems.push(`${fk.child}.${fk.col} is NOT NULL — can't detach fixture rows ${internal.join(", ")}`);
        detachPlan.push({ child: fk.child, col: fk.col, ids: internal });
      }
    }
  }

  // Album covers point at an asset by URL, not by FK (see the ImageAsset
  // comment in schema.prisma), so the catalog scan can't see them.
  if (ids.ImageAsset.length) {
    const r = await client.query(
      `SELECT al.id::text AS album, ia.id AS asset
         FROM "ImageAsset" ia JOIN "Album" al ON al."imageUrl" = ia."publicUrl"
        WHERE ia.id = ANY($1::text[]) AND NOT (al.id = ANY($2::bigint[]))`,
      [ids.ImageAsset, ids.Album],
    );
    for (const x of r.rows) {
      problems.push(`Album ${x.album}.imageUrl is ImageAsset ${x.asset}'s publicUrl (album outside the fixture set)`);
    }
  }
  // Comments store their event / series anchors as strings (BigInt FK
  // compatibility) plus server-computed roll-up arrays, none of them FKs.
  // A comment is never a fixture row, so any match refuses: deleting the
  // event would leave the comment pointing at nothing.
  if (ids.Event.length || ids.EventSeries.length) {
    const r = await client.query(
      `SELECT id FROM "Comment"
        WHERE "eventId" = ANY($1::text[]) OR "taggedEventId" = ANY($1::text[]) OR "rollupEventIds" && $1::text[]
           OR "eventSeriesId" = ANY($2::text[]) OR "rollupEventSeriesIds" && $2::text[]`,
      [ids.Event, ids.EventSeries],
    );
    if (r.rows.length) {
      const shown = r.rows.slice(0, 5).map((x) => x.id).join(", ") + (r.rows.length > 5 ? ", …" : "");
      problems.push(`Comment: ${plural(r.rows.length, "row")} anchored to or rolled up into a fixture event / series (${shown})`);
    }
  }
  const assetKeys = (rows.ImageAsset ?? []).map((x) => x.label);

  // 3. The plan.
  console.log(`\nplan${dryRun ? " (dry run)" : ""}:`);
  for (const e of active) {
    const listed = rows[e.table].map((x) => `${x.id} ${JSON.stringify(x.label)}`).join("; ");
    console.log(`  ${e.table}: ${listed || "(none found)"}`);
  }
  for (const o of ownedPlan) console.log(`  ${o.child} (by ${o.col}): ${plural(o.count, "row")}`);
  for (const d of detachPlan) console.log(`  detach ${d.child}.${d.col} on fixture ${plural(d.ids.length, "row")}: ${d.ids.join(", ")}`);

  if (problems.length) {
    throw new Refusal(`refused — nothing deleted:\n  - ${problems.join("\n  - ")}`);
  }
  if (dryRun) return { assetKeys, committed: false };

  // 4. Detach references inside the fixture set (a child series' parent,
  //    an event's series / BD album, a logo), so no DELETE below depends
  //    on order or trips a Restrict FK. Logo columns reset the mode too.
  for (const d of detachPlan) {
    const extra = d.col === "logoAssetId" && LOGO_TABLES.has(d.child) ? `, "logoMode" = 'inherit'` : "";
    const r = await client.query(
      `UPDATE ${q(d.child)} SET ${q(d.col)} = NULL${extra} WHERE id = ANY($1::${byTable[d.child].idType}[])`,
      [d.ids],
    );
    expectCount(r.rowCount, d.ids.length, `detach ${d.child}.${d.col}`);
  }

  // 5. Owned children, then the parent, in ENTITIES order.
  for (const e of active) {
    for (const o of ownedPlan.filter((x) => x.parent === e)) {
      const r = await client.query(`DELETE FROM ${q(o.child)} WHERE ${q(o.col)} = ANY($1::${e.idType}[])`, [ids[e.table]]);
      expectCount(r.rowCount, o.count, `delete ${o.child}`);
    }
    // The prefix is re-applied on the DELETE itself, so even a bug in the
    // checks above can't delete a row that doesn't carry it.
    const r = await client.query(
      `DELETE FROM ${q(e.table)} WHERE id = ANY($1::${e.idType}[]) AND starts_with(${q(e.prefixColumn)}, $2)`,
      [ids[e.table], prefixOf(e)],
    );
    expectCount(r.rowCount, ids[e.table].length, `delete ${e.table}`);
  }
  return { assetKeys, committed: true };
}

function expectCount(actual, planned, what) {
  if (actual !== planned) throw new Refusal(`${what}: ${actual} rows affected, planned ${planned} — rolled back`);
}

async function main(argv) {
  const opts = parseArgs(argv);

  const dotenv = (await import("dotenv")).default;
  dotenv.config({ path: [join(REPO_ROOT, ".env.local"), join(REPO_ROOT, ".env")], quiet: true });

  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) {
    console.error(
      "db-fixture-rm: DATABASE_URL_UNPOOLED is not set (.env.local / .env) — the session pooler is required, there is no fallback",
    );
    return 1;
  }
  if (!pointsAtDevProject(connectionString)) {
    console.error(
      "db-fixture-rm: refused — DATABASE_URL_UNPOOLED does not point at the dev Supabase project; this script never connects anywhere else",
    );
    return 2;
  }
  // 6543 is Supavisor's transaction pooler; an UNPOOLED variable pointing
  // there is a misconfiguration this script must not paper over.
  if (new URL(connectionString).port === "6543") {
    console.error("db-fixture-rm: refused — DATABASE_URL_UNPOOLED uses port 6543 (transaction pooler); use the session pooler (5432)");
    return 2;
  }
  console.error(`db-fixture-rm: ${describeTarget(connectionString)}${opts.dryRun ? " (dry run: BEGIN … ROLLBACK)" : ""}`);

  const { Client } = (await import("pg")).default;
  const client = new Client({ connectionString });
  let result;
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '60s'");
    // Fail fast instead of queueing behind a QA browser's open
    // transaction on the same rows.
    await client.query("SET LOCAL lock_timeout = '10s'");
    result = await run(client, opts);
    await client.query(result.committed ? "COMMIT" : "ROLLBACK");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }

  console.log(result.committed ? "\nCOMMIT — done." : "\ndry run passed — ROLLBACK, nothing deleted.");
  if (result.assetKeys.length) {
    console.log(
      `\nR2 objects are NOT deleted (this script never touches storage); ${result.committed ? "they stay" : "they would stay"} in the bucket. List them in the QA handoff:\n` +
        result.assetKeys.map((k) => `  ${k}`).join("\n"),
    );
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`db-fixture-rm: ${redact(e instanceof Error ? e.message : e)}`);
      process.exit(e instanceof UsageError || e instanceof Refusal ? 2 : 1);
    },
  );
}
