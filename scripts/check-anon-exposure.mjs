#!/usr/bin/env node
// Fails when a relation in the `public` schema is reachable by the
// Supabase `anon` / `authenticated` roles and is not on the allowlist in
// prisma/anon-exposed-tables.txt.
//
//   node scripts/check-anon-exposure.mjs                 # check (CI step)
//   node scripts/check-anon-exposure.mjs --list          # print exposed names
//   node scripts/check-anon-exposure.mjs --allowlist <f> # check against <f>
//
// Why: Supabase's default ACL on `public` grants anon and authenticated
// ALL on every table `prisma db push` creates, and RLS starts off. The
// browser holds the anon key (Realtime), so a new table is readable and
// writable through the Data API unless prisma/post-deploy.sql locks it
// down (see the ImageAsset block). migrate-dev.yml runs this right after
// post-deploy.sql, so a new table that skipped the lockdown fails the job
// on dev before it reaches prod.
//
// "Reachable" = any table privilege, or any column privilege, held by the
// role directly, through PUBLIC, or through role membership
// (has_table_privilege / has_any_column_privilege resolve all three,
// unlike information_schema.role_table_grants, which only lists grants
// the current role can see). RLS does not clear a table: enabled RLS with
// a grant still serves rows once someone adds a permissive policy, so the
// fix is the REVOKE, and RLS is only printed as context.
//
// Exit: 1 when an exposed relation is missing from the allowlist; 0
// otherwise. An allowlisted relation that is no longer exposed is only a
// note, so locking down existing tables later doesn't break the job —
// delete its line when you see the note.
//
// Read-only: one SELECT inside `BEGIN READ ONLY … ROLLBACK`, with only a
// transaction-scoped `SET LOCAL`. Never a session-level SET: dev's
// DATABASE_URL can be the shared Supavisor transaction pooler, where a
// session setting outlives this client (see scripts/db-ro.mjs).
//
// Env: DATABASE_URL_UNPOOLED, else DATABASE_URL (CI sets DATABASE_URL to
// the dev session pooler). Locally `.env.local`, then `.env`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_ALLOWLIST = fileURLToPath(new URL("../prisma/anon-exposed-tables.txt", import.meta.url));

// Roles that exist in the query's pg_roles join are checked; on a
// non-Supabase Postgres neither exists and the check passes with a note.
const EXPOSURE_SQL = `
SELECT c.relname AS name,
       c.relkind AS kind,
       c.relrowsecurity AS rls,
       array_agg(r.rolname::text ORDER BY r.rolname) AS roles
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_roles r ON r.rolname IN ('anon', 'authenticated')
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND (
    has_table_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    OR has_any_column_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
  )
GROUP BY c.relname, c.relkind, c.relrowsecurity
ORDER BY c.relname`;

const RELKIND = { r: "table", p: "partitioned table", v: "view", m: "materialized view", f: "foreign table" };

const ROLES_SQL = `SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`;

const FIX_HINT = `Fix: lock each table down in prisma/post-deploy.sql, like the ImageAsset block:
  ALTER TABLE "<Table>" ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE "<Table>" FROM PUBLIC;   -- and FROM anon, authenticated (role-guarded DO block)
Only if public exposure through the anon key is truly intended, add the
name to prisma/anon-exposed-tables.txt so the reviewer sees it in the diff.`;

/** Allowlisted names: one per line, `#` starts a comment. */
export function parseAllowlist(text) {
  return new Set(
    text
      .split("\n")
      // No `$` anchor: `.` stops at a CRLF checkout's `\r`, so `#.*$`
      // would leave the comment in place on those lines.
      .map((line) => line.replace(/#.*/, "").trim())
      .filter((line) => line.length > 0),
  );
}

/**
 * Compare exposed relations with the allowlist.
 * @param {{name: string}[]} exposed
 * @param {Set<string>} allowed
 */
export function diffAllowlist(exposed, allowed) {
  const exposedNames = new Set(exposed.map((e) => e.name));
  return {
    offending: exposed.filter((e) => !allowed.has(e.name)),
    stale: [...allowed].filter((name) => !exposedNames.has(name)).sort(),
  };
}

/** Hide any connection string that slips into an error message. */
function redact(text) {
  return String(text).replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***");
}

async function queryExposure() {
  const dotenv = (await import("dotenv")).default;
  dotenv.config({ path: ".env.local", quiet: true });
  dotenv.config({ path: ".env", quiet: true });
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!connectionString) throw new UsageError("neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set");

  const { Client } = (await import("pg")).default;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const roles = (await client.query(ROLES_SQL)).rows[0].n;
    const exposed = (await client.query(EXPOSURE_SQL)).rows;
    return { roles, exposed };
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

async function main(argv) {
  let allowlistPath = DEFAULT_ALLOWLIST;
  let listOnly = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--list") listOnly = true;
    else if (argv[i] === "--allowlist" && argv[i + 1]) allowlistPath = argv[++i];
    else throw new UsageError(`unknown argument: ${argv[i]}`);
  }

  const { roles, exposed } = await queryExposure();

  if (listOnly) {
    for (const e of exposed) console.log(e.name);
    return 0;
  }

  if (roles === 0) {
    console.log("check-anon-exposure: no anon/authenticated roles in this database — nothing to check.");
    return 0;
  }

  const allowed = parseAllowlist(readFileSync(allowlistPath, "utf8"));
  const { offending, stale } = diffAllowlist(exposed, allowed);

  console.log(
    `check-anon-exposure: ${exposed.length} public relation(s) reachable by anon/authenticated, ${allowed.size} allowlisted.`,
  );
  for (const name of stale) {
    console.log(`note: "${name}" is allowlisted but no longer exposed — delete its line from the allowlist.`);
  }
  if (offending.length === 0) {
    console.log("OK: every exposed relation is allowlisted.");
    return 0;
  }

  console.error(`\nFAIL: ${offending.length} relation(s) reachable by anon/authenticated and not allowlisted:`);
  for (const e of offending) {
    console.error(`  - "${e.name}" (${RELKIND[e.kind] ?? e.kind}, RLS ${e.rls ? "on" : "off"}, roles: ${e.roles.join(", ")})`);
  }
  console.error(`\n${FIX_HINT}`);
  return 1;
}

class UsageError extends Error {}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`check-anon-exposure: ${redact(e instanceof Error ? e.message : e)}`);
      process.exit(e instanceof UsageError ? 2 : 1);
    },
  );
}
