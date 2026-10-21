// @vitest-environment node
//
// scripts/db-ro.mjs runs ad-hoc SQL inside `BEGIN READ ONLY … ROLLBACK`
// and refuses, before connecting, anything that writes, changes session
// state, or ends that transaction early. Session state set through the
// transaction pooler leaks to other clients (the 2026-10-18 read-only
// incident), so the refusals are the part pinned here. No database.
import { describe, it, expect } from "vitest";
import { parseArgs, refusalReason } from "../../../scripts/db-ro.mjs";
import { DEV_PROJECT_REF, pointsAtDevProject } from "../../../scripts/dev-db-guard.mjs";

describe("refusalReason", () => {
  it.each([
    ["a plain select", "select 1 as ok"],
    ["a trailing semicolon and comments", "-- count\n/* events */ select count(*) from \"Event\";\n"],
    ["a CTE read", "with e as (select id from \"Event\") select count(*) from e"],
    ["a parenthesised query", "(select 1) union (select 2)"],
    ["a transaction-scoped setting", "set local work_mem = '64MB'"],
    ["a column named like a keyword", "select \"update\", \"delete\" from t"],
  ])("allows %s", (_name, sql) => {
    expect(refusalReason(sql)).toBeNull();
  });

  it.each([
    ["insert", "insert into t values (1)"],
    ["update after a comment", "-- fix\nupdate t set a = 1"],
    ["delete", "DELETE FROM t"],
    ["alter", "alter table t add column a int"],
    ["drop", "drop table t"],
    ["create", "create index on t (a)"],
    ["truncate", "truncate t"],
    ["set session", "set session characteristics as transaction read only"],
    ["plain set (session-scoped)", "set statement_timeout = 0"],
    ["set_config inside a select", "select set_config('x.y', '1', false)"],
    ["set session behind a block comment", "/* x */ set session characteristics as transaction read only"],
    ["commit behind a block comment", "/**/commit"],
  ])("refuses %s", (_name, sql) => {
    expect(refusalReason(sql)).toMatch(/only reads|session setting/);
  });

  // A session advisory lock stays held after ROLLBACK; through the
  // transaction pooler it would sit on a backend other clients share.
  it.each([
    ["pg_advisory_lock", "select pg_advisory_lock(1)"],
    ["pg_try_advisory_lock_shared", "SELECT PG_TRY_ADVISORY_LOCK_SHARED(1, 2)"],
  ])("refuses a session advisory lock: %s", (_name, sql) => {
    expect(refusalReason(sql)).toMatch(/advisory lock outlives/);
  });

  it("allows a transaction-scoped advisory lock", () => {
    expect(refusalReason("select pg_advisory_xact_lock(1)")).toBeNull();
  });

  // A second statement could be a COMMIT that ends BEGIN READ ONLY and
  // lets what follows persist. The script also sends the query with the
  // extended protocol, where Postgres itself refuses a second statement;
  // this is the early, readable refusal.
  it.each([
    ["a commit that escapes the read-only transaction", "select 1; commit; insert into t values (1)"],
    ["a hidden commit", "select 1; /**/ commit; /**/ insert into t values (1)"],
    ["two reads", "select 1; select 2"],
  ])("refuses %s (more than one statement)", (_name, sql) => {
    expect(refusalReason(sql)).toMatch(/one statement per argument/);
  });

  it("refuses a statement left behind an unclosed comment", () => {
    expect(refusalReason("/* commit")).toMatch(/does not start with a keyword/);
  });

  it("refuses an empty script", () => {
    expect(refusalReason("  -- nothing\n ;")).toBe("no SQL statement given");
  });
});

describe("parseArgs", () => {
  const files: Record<string, string> = { "a.sql": "select 1", "b.sql": "select 2" };
  const readFile = (p: string) => files[p];

  it("keeps positional statements and files in order", () => {
    expect(parseArgs(["select 0", "--file", "a.sql", "--json", "--file", "b.sql"], readFile)).toEqual({
      sqls: ["select 0", "select 1", "select 2"],
      json: true,
    });
  });

  it("defaults to table output", () => {
    expect(parseArgs(["select 1"], readFile).json).toBe(false);
  });

  it("keeps SQL that starts with a -- comment as a statement", () => {
    expect(parseArgs(["-- count\nselect 1"], readFile).sqls).toEqual(["-- count\nselect 1"]);
  });

  it.each([
    ["no statement", []],
    ["only --json", ["--json"]],
    ["--file without a path", ["--file"]],
    ["--file followed by a flag", ["--file", "--json"]],
    ["an unknown option", ["--force", "select 1"]],
  ])("refuses %s", (_name, argv) => {
    expect(() => parseArgs(argv, readFile)).toThrow();
  });
});

// The guard both the integration setup and db-ro.mjs rely on to never
// touch anything but the dev project. Fake hosts and refs only.
describe("pointsAtDevProject", () => {
  it.each([
    ["the direct host", `postgresql://postgres:pw@db.${DEV_PROJECT_REF}.supabase.co:5432/postgres`],
    ["the pooler user", `postgresql://postgres.${DEV_PROJECT_REF}:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`],
  ])("accepts %s", (_name, url) => {
    expect(pointsAtDevProject(url)).toBe(true);
  });

  it.each([
    ["another project's pooler user", "postgresql://postgres.otherref:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres"],
    ["the dev ref only in the password", `postgresql://postgres.otherref:${DEV_PROJECT_REF}@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`],
    ["the dev ref only in the query string", `postgresql://postgres:pw@db.otherref.supabase.co:5432/postgres?x=${DEV_PROJECT_REF}`],
    ["the dev pooler user on a non-Supabase host", `postgresql://postgres.${DEV_PROJECT_REF}:pw@evil.example.com:5432/postgres`],
    ["localhost", "postgresql://postgres:pw@localhost:5432/postgres"],
    ["an unparseable string", "not a url"],
    ["an empty string", ""],
  ])("refuses %s", (_name, url) => {
    expect(pointsAtDevProject(url)).toBe(false);
  });
});
