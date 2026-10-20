#!/usr/bin/env node
// Read-only SQL against the dev DB, for ad-hoc lookups by hand or by an
// agent.
//
//   node scripts/db-ro.mjs "<sql>"
//   node scripts/db-ro.mjs --file q.sql
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
//   - never prints the connection string, also not inside an error.
//
// Env: `.env.local` first, then `.env` (dotenv never overrides a value
// already set, so `.env.local` wins), both quiet.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Writes and DDL, transaction control (would escape BEGIN READ ONLY),
// and every session-level SET / RESET / DISCARD (only `SET LOCAL` is
// transaction-scoped). A false refusal costs a rephrased query, so the
// list is broad; a miss is still caught by the read-only transaction.
const REFUSED_START =
  /^\s*(insert|update|delete|merge|alter|drop|create|truncate|grant|revoke|copy|comment|vacuum|reindex|cluster|lock|refresh|call|do|prepare|execute|deallocate|listen|notify|unlisten|import|security|begin|start|commit|end|rollback|abort|savepoint|release|reset|discard|set(?!\s+local\b))\b/i;
// `set_config(name, value, false)` changes the setting for the SESSION
// from inside a plain SELECT — the same leak as `SET SESSION`.
const REFUSED_ANYWHERE = /\bset_config\s*\(/i;

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
    if (REFUSED_ANYWHERE.test(stmt)) {
      return "set_config() changes a session setting — use SET LOCAL or nothing";
    }
  }
  return null;
}

/** Hide any connection string that slips into an error message. */
function redact(text) {
  return String(text).replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***");
}

/** console.table can't print BigInt; node-pg returns int8 as a string
 *  already, but a custom parser or a driver change must not crash it. */
function printable(row) {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]),
  );
}

async function main(argv) {
  let sql;
  if (argv[0] === "--file") {
    if (!argv[1]) throw new UsageError("--file needs a path");
    sql = readFileSync(argv[1], "utf8");
  } else {
    sql = argv[0];
  }
  if (!sql) throw new UsageError('usage: node scripts/db-ro.mjs "<sql>" | --file q.sql');

  const reason = refusalReason(sql);
  if (reason) {
    console.error(`db-ro: refused — ${reason}`);
    return 2;
  }

  const dotenv = (await import("dotenv")).default;
  dotenv.config({ path: ".env.local", quiet: true });
  dotenv.config({ path: ".env", quiet: true });

  let connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) {
    connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.error("db-ro: neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set (.env.local / .env)");
      return 1;
    }
    console.error(
      "db-ro: warning — DATABASE_URL_UNPOOLED is not set; falling back to DATABASE_URL (likely the transaction pooler). Still read-only and transaction-scoped.",
    );
  }

  const { Client } = (await import("pg")).default;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '60s'");
    // `queryMode: "extended"` (unnamed statement, so nothing is left on a
    // pooled backend): Postgres answers "cannot insert multiple commands
    // into a prepared statement" to a second statement, however hidden.
    const r = await client.query({ text: sql, queryMode: "extended" });
    if (r.fields?.length) {
      console.table(r.rows.map(printable));
      console.log(`(${r.rows.length} row${r.rows.length === 1 ? "" : "s"})`);
    } else {
      console.log(r.command ?? "OK");
    }
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
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
