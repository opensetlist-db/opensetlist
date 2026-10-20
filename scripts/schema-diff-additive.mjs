#!/usr/bin/env node
// Is a `prisma migrate diff --script` purely additive? And does it drop
// anything a human must see first?
//
//   node scripts/schema-diff-additive.mjs <diff.sql>
//     exit 0 → additive only (or empty): safe for `db push --accept-data-loss`
//     exit 3 → something else (a statement is printed): keep the normal push
//
//   node scripts/schema-diff-additive.mjs --drops <diff.sql>
//     exit 0 → no DROP COLUMN / DROP TABLE / DROP INDEX in the diff
//     exit 1 → at least one (each is printed): the migrate workflows stop
//              here unless the operator dispatched with accept_data_loss
//
// Why this exists: `prisma db push` reports ANY new unique constraint as
// possible data loss and refuses without `--accept-data-loss`, even when
// the constrained column is brand new and every row holds NULL (which
// never collides). The migrate workflows use this to pass the flag only
// when the generated SQL can't drop, retype or rewrite anything — so an
// additive release (the project rule) migrates in one dispatch, and a
// destructive diff still stops for a human.
//
// Why the `--drops` mode: `db push` warns about data loss only when a
// dropped column or table holds rows. An EMPTY column goes silently —
// which is exactly what a feature branch's column looks like on the dev
// DB until that branch merges. When another PR merged to dev first, the
// dev push dropped the branch-only column without a word, and the
// branch's integration tests and Preview then ran against a DB missing
// it. So a DROP is refused outright (the diff is shown, with a hint)
// and the operator re-runs migrate-dev on the branch, or dispatches with
// accept_data_loss when the drop is intended.
//
// Rule: every statement must START with an additive form AND contain no
// destructive keyword anywhere. A false "not additive" is cheap (the push
// falls back to today's behaviour); a false "additive" is not — so the
// allow-list is short and the deny-list is broad.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ADDITIVE_START = [
  /^CREATE TABLE\b/i,
  /^CREATE (UNIQUE )?INDEX\b/i,
  /^CREATE TYPE\b/i,
  /^ALTER TYPE\s+\S+\s+ADD VALUE\b/i,
  /^ALTER TABLE\s+\S+\s+ADD\b/i,
];

// Statement-level data changes (UPDATE / DELETE / TRUNCATE) never pass the
// allow-list above, so the deny-list only has to catch destructive
// CLAUSES inside an additive-looking statement (`ADD …, DROP …`). Words
// that also appear in harmless clauses stay out: `ON DELETE SET NULL` /
// `ON UPDATE CASCADE` on a new FK, `USING gin` on a new index. Postgres
// lets a later clause drop the COLUMN keyword (`ADD a INT, ALTER b TYPE
// …`), so any `ALTER` after a comma counts; Prisma always prints the long
// form, but the deny-list must not rely on that.
const DESTRUCTIVE =
  /\b(DROP|RENAME|ALTER\s+COLUMN|SET\s+DATA\s+TYPE|SET\s+NOT\s+NULL)\b|,\s*ALTER\b/i;

/** Statements of a SQL script, comments and blank space removed. */
function statements(sql) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

/**
 * @param {string} sql
 * @returns {{ additive: boolean, offending: string | null }}
 */
export function classifySchemaDiff(sql) {
  for (const stmt of statements(sql)) {
    const startsAdditive = ADDITIVE_START.some((re) => re.test(stmt));
    if (!startsAdditive || DESTRUCTIVE.test(stmt)) {
      return { additive: false, offending: stmt };
    }
  }
  return { additive: true, offending: null };
}

const DROP_TABLE = /^DROP TABLE\s+(?:IF EXISTS\s+)?"?([^"\s;]+)"?/i;
const DROP_INDEX = /^DROP INDEX\s+(?:CONCURRENTLY\s+)?(?:IF EXISTS\s+)?"?([^"\s;]+)"?/i;
// A DROP clause of `ALTER TABLE` starts right after the table name or
// after a comma (`ADD COLUMN "a" INT, DROP COLUMN "b"` is one statement).
// Anchoring on that keeps `ALTER COLUMN "x" DROP DEFAULT` / `DROP NOT
// NULL` out (DROP follows a column name there), and the lookahead keeps
// `DROP CONSTRAINT` out: neither loses a column. COLUMN itself is
// optional in Postgres, so it is not required here.
const DROP_COLUMN = /^ALTER TABLE\s+\S+\s+(?:.*,\s*)?DROP\s+(?!CONSTRAINT\b)/i;

/**
 * The statements that drop a column, a table, or an index of a table the
 * diff keeps. A `DROP INDEX` is not data loss by itself, but on a table
 * that stays it has the same cause as a dropped column (a branch-only
 * schema being reverted), so it is reported too. Postgres `DROP INDEX`
 * does not name the table; Prisma names every index `<Table>_<cols>_idx`
 * / `_key`, so an index whose name starts with a dropped table's name is
 * taken as that table's and left out (its DROP TABLE is reported instead).
 *
 * @param {string} sql
 * @returns {string[]}
 */
export function findDropStatements(sql) {
  const stmts = statements(sql);
  const droppedTables = stmts
    .map((s) => s.match(DROP_TABLE)?.[1])
    .filter((t) => t !== undefined);
  const drops = [];
  for (const stmt of stmts) {
    if (DROP_TABLE.test(stmt) || DROP_COLUMN.test(stmt)) {
      drops.push(stmt);
      continue;
    }
    const index = stmt.match(DROP_INDEX)?.[1];
    if (index !== undefined && !droppedTables.some((t) => index.startsWith(`${t}_`))) {
      drops.push(stmt);
    }
  }
  return drops;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dropsMode = process.argv[2] === "--drops";
  const file = dropsMode ? process.argv[3] : process.argv[2];
  if (!file) {
    console.error("usage: schema-diff-additive.mjs [--drops] <diff.sql>");
    process.exit(2);
  }
  const sql = readFileSync(file, "utf8");
  if (dropsMode) {
    const drops = findDropStatements(sql);
    if (drops.length === 0) {
      console.log("schema diff drops nothing");
      process.exit(0);
    }
    console.log("schema diff DROPS a column, table or index:");
    for (const stmt of drops) console.log(`  ${stmt};`);
    process.exit(1);
  }
  const { additive, offending } = classifySchemaDiff(sql);
  if (additive) {
    console.log("schema diff is additive only");
    process.exit(0);
  }
  console.log(`schema diff is NOT additive only — first such statement:\n  ${offending}`);
  process.exit(3);
}
