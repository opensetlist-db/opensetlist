#!/usr/bin/env node
// Read-only SQL against the dev DB, for ad-hoc lookups by hand or by an
// agent.
//
//   node scripts/db-ro.mjs "<sql>" ["<sql>" …]
//   node scripts/db-ro.mjs --file q.sql [--file r.sql …]
//   node scripts/db-ro.mjs --json "<sql>"     (stdout: JSON only)
//
// Each argument / file is ONE statement; several run in order inside the
// same read-only transaction. Runs from any directory and any task
// worktree (the env files are read from the repo root, and `pg` /
// `dotenv` resolve through a worktree's linked node_modules).
//
// Why this exists: on 2026-10-18 a session made itself read-only with
// `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` through the
// TRANSACTION pooler (port 6543). Supavisor hands one backend to many
// clients, so the setting outlived the session and other clients' writes
// started failing with "cannot execute … in a read-only transaction".
// Session state must never be set through that pooler. This helper does
// the safe thing instead:
//   - connects with DATABASE_URL_UNPOOLED (the SESSION pooler, port 5432:
//     one backend per client); DATABASE_URL is only a fallback, with a
//     warning;
//   - wraps the query in `BEGIN READ ONLY … ROLLBACK`, so the read-only
//     mode (and the statement timeout, `SET LOCAL`) ends with the
//     transaction and nothing is ever committed;
//   - sends the query with the EXTENDED protocol, which Postgres accepts
//     for exactly one statement. That is the real guarantee: a second
//     statement could be a `COMMIT` that ends the read-only transaction
//     and lets a write or a session SET after it persist, and no text
//     check catches every way to hide one (block comments, `--` inside a
//     string). One statement inside a read-only transaction that is
//     rolled back can neither write nor leave a setting behind (SET is
//     transactional);
//   - refuses, before connecting, statements that write, change session
//     state or control the transaction, so the mistake gets a clear
//     message instead of a Postgres error;
//   - refuses, before connecting, any URL that is not the DEV Supabase
//     project (scripts/dev-db-guard.mjs, the rule the integration tests
//     use) — the prod DB is never used locally, not even to read;
//   - prints the target (user@host:port/db, never the password) to
//     stderr, and never prints the connection string, also not inside an
//     error.
//
// Env: `.env.local` first, then `.env` (dotenv never overrides a value
// already set, so `.env.local` wins), both quiet, both from the repo
// root. A variable already in the environment wins over both.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pointsAtDevProject } from "./dev-db-guard.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Writes and DDL, transaction control (would escape BEGIN READ ONLY),
// and every session-level SET / RESET / DISCARD (only `SET LOCAL` is
// transaction-scoped). A false refusal costs a rephrased query, so the
// list is broad; a miss is still caught by the read-only transaction.
const REFUSED_START =
  /^\s*(insert|update|delete|merge|alter|drop|create|truncate|grant|revoke|copy|comment|vacuum|reindex|cluster|lock|refresh|call|do|prepare|execute|deallocate|listen|notify|unlisten|import|security|begin|start|commit|end|rollback|abort|savepoint|release|reset|discard|set(?!\s+local\b))\b/i;
// Session state reachable from inside a plain SELECT, which ROLLBACK does
// not undo or which outlives it — the same leak as `SET SESSION` through
// the transaction pooler (the DATABASE_URL fallback):
//   - `set_config(name, value, false)` sets a session-level setting;
//   - `pg_advisory_lock(…)` / `pg_try_advisory_lock(…)` and their
//     `_shared` forms take a SESSION lock that stays held after ROLLBACK
//     (the `pg_advisory_xact_*` forms end with the transaction and stay
//     allowed).
const REFUSED_ANYWHERE = [
  [/\bset_config\s*\(/i, "set_config() changes a session setting — use SET LOCAL or nothing"],
  [
    /\bpg_(?:try_)?advisory_lock(?:_shared)?\s*\(/i,
    "a session-level advisory lock outlives the transaction — use pg_advisory_xact_lock",
  ],
];

/** Statements of a script, `/* … *\/` and `--` comments removed. Not
 *  literal-aware: a `;` or `--` inside a string splits or cuts wrongly.
 *  That only matters for the friendly message — the extended protocol
 *  still refuses a second statement. */
function statements(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Why `sql` may not run through this helper, or null when it may.
 * @param {string} sql
 * @returns {string | null}
 */
export function refusalReason(sql) {
  const stmts = statements(sql);
  if (stmts.length === 0) return "no SQL statement given";
  if (stmts.length > 1) {
    return "one statement per run — a second one could end the read-only transaction";
  }
  for (const stmt of stmts) {
    // After comment removal a statement starts with a keyword or `(`;
    // anything else (an unclosed or nested comment) can't be checked.
    if (!/^[a-z(]/i.test(stmt)) {
      return "the statement does not start with a keyword — remove the leading comment";
    }
    const start = stmt.match(REFUSED_START);
    if (start) {
      return `"${start[1].toUpperCase()}" is a write, a session-level setting or transaction control — this helper only reads`;
    }
    for (const [re, reason] of REFUSED_ANYWHERE) {
      if (re.test(stmt)) return reason;
    }
  }
  return null;
}

/** Hide any connection string that slips into an error message. */
function redact(text) {
  return String(text).replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***");
}

/**
 * Parse argv into the statements to run and the output mode. Each
 * positional argument and each `--file` is one statement, kept in order.
 * `--file` content is read here, so a missing file fails before any
 * connection.
 * @param {string[]} argv
 * @param {(path: string) => string} [readFile]
 * @returns {{ sqls: string[], json: boolean }}
 */
export function parseArgs(argv, readFile = (p) => readFileSync(p, "utf8")) {
  const sqls = [];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--file") {
      const path = argv[++i];
      if (!path) throw new UsageError("--file needs a path");
      sqls.push(readFile(path));
    } else if (arg.startsWith("--")) {
      throw new UsageError(`unknown option ${arg}`);
    } else {
      sqls.push(arg);
    }
  }
  if (sqls.length === 0) {
    throw new UsageError(
      'usage: node scripts/db-ro.mjs [--json] "<sql>" ["<sql>" …] | --file q.sql',
    );
  }
  return { sqls, json };
}

// Every timestamp column in this schema is `timestamp(3)` WITHOUT time
// zone holding UTC wall time (Prisma's convention); node-pg would parse
// it in the machine's local zone and print it hours off on a non-UTC
// laptop. Parse it as UTC (as src/__tests__/integration/devPg.ts does).
// `date` would likewise become LOCAL midnight — keep it as the plain
// 'YYYY-MM-DD' string. 'infinity' and friends stay strings too.
const TIMESTAMP_OID = 1114;
const DATE_OID = 1082;
function utcTypeParser(types) {
  return (oid, format) => {
    if (oid === TIMESTAMP_OID) {
      return (v) => {
        const d = new Date(`${v.replace(" ", "T")}Z`);
        return Number.isNaN(d.getTime()) ? v : d;
      };
    }
    if (oid === DATE_OID) return (v) => v;
    return types.getTypeParser(oid, format);
  };
}

/** One value as text for console.table / JSON: BigInt (node-pg returns
 *  int8 as a string already, but a driver change must not crash it) and
 *  Date (ISO, UTC) — console.table would print a Date as a bare object. */
function printableValue(v) {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  return v;
}
function printable(row) {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, printableValue(v)]));
}

/** user@host:port/db of a connection string — never the password. */
function describeTarget(raw) {
  const url = new URL(raw);
  return `${decodeURIComponent(url.username)}@${url.hostname}:${url.port || "5432"}${url.pathname}`;
}

async function main(argv) {
  const { sqls, json } = parseArgs(argv);

  for (const [i, sql] of sqls.entries()) {
    const reason = refusalReason(sql);
    if (reason) {
      const which = sqls.length > 1 ? ` (statement ${i + 1})` : "";
      console.error(`db-ro: refused${which} — ${reason}`);
      return 2;
    }
  }

  const dotenv = (await import("dotenv")).default;
  dotenv.config({ path: [join(REPO_ROOT, ".env.local"), join(REPO_ROOT, ".env")], quiet: true });

  let name = "DATABASE_URL_UNPOOLED";
  let connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) {
    name = "DATABASE_URL";
    connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.error("db-ro: neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set (.env.local / .env)");
      return 1;
    }
    console.error(
      "db-ro: warning — DATABASE_URL_UNPOOLED is not set; falling back to DATABASE_URL (likely the transaction pooler). Still read-only and transaction-scoped.",
    );
  }
  if (!pointsAtDevProject(connectionString)) {
    console.error(`db-ro: refused — ${name} does not point at the dev Supabase project; this helper never connects anywhere else`);
    return 2;
  }
  console.error(`db-ro: ${name} → ${describeTarget(connectionString)} (BEGIN READ ONLY … ROLLBACK)`);

  const { Client, types } = (await import("pg")).default;
  const client = new Client({ connectionString, types: { getTypeParser: utcTypeParser(types) } });
  await client.connect();
  const results = [];
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '60s'");
    for (const sql of sqls) {
      // `queryMode: "extended"` (unnamed statement, so nothing is left on
      // a pooled backend): Postgres answers "cannot insert multiple
      // commands into a prepared statement" to a second statement,
      // however hidden. Several statements are therefore several calls.
      const r = await client.query({ text: sql, queryMode: "extended" });
      const rows = r.fields?.length ? r.rows.map(printable) : null;
      if (json) {
        results.push({ sql: sql.trim(), command: r.command, rowCount: r.rowCount, rows });
        continue;
      }
      if (sqls.length > 1) console.log(`\n-- ${sql.trim()}`);
      if (rows) {
        console.table(rows);
        console.log(`(${rows.length} row${rows.length === 1 ? "" : "s"})`);
      } else {
        console.log(r.command ?? "OK");
      }
    }
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
  if (json) console.log(JSON.stringify(results, null, 2));
  return 0;
}

class UsageError extends Error {}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`db-ro: ${redact(e instanceof Error ? e.message : e)}`);
      process.exit(e instanceof UsageError ? 2 : 1);
    },
  );
}
