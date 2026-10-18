#!/usr/bin/env node
// Is a `prisma migrate diff --script` purely additive?
//
//   node scripts/schema-diff-additive.mjs <diff.sql>
//     exit 0 → additive only (or empty): safe for `db push --accept-data-loss`
//     exit 3 → something else (a statement is printed): keep the normal push
//
// Why this exists: `prisma db push` reports ANY new unique constraint as
// possible data loss and refuses without `--accept-data-loss`, even when
// the constrained column is brand new and every row holds NULL (which
// never collides). The migrate workflows use this to pass the flag only
// when the generated SQL can't drop, retype or rewrite anything — so an
// additive release (the project rule) migrates in one dispatch, and a
// destructive diff still stops for a human.
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: schema-diff-additive.mjs <diff.sql>");
    process.exit(2);
  }
  const { additive, offending } = classifySchemaDiff(readFileSync(file, "utf8"));
  if (additive) {
    console.log("schema diff is additive only");
    process.exit(0);
  }
  console.log(`schema diff is NOT additive only — first such statement:\n  ${offending}`);
  process.exit(3);
}
