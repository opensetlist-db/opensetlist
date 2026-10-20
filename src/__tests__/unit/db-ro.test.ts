// @vitest-environment node
//
// scripts/db-ro.mjs runs ad-hoc SQL inside `BEGIN READ ONLY … ROLLBACK`
// and refuses, before connecting, anything that writes, changes session
// state, or ends that transaction early. Session state set through the
// transaction pooler leaks to other clients (the 2026-10-18 read-only
// incident), so the refusals are the part pinned here. No database.
import { describe, it, expect } from "vitest";
import { refusalReason } from "../../../scripts/db-ro.mjs";

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

  // A second statement could be a COMMIT that ends BEGIN READ ONLY and
  // lets what follows persist. The script also sends the query with the
  // extended protocol, where Postgres itself refuses a second statement;
  // this is the early, readable refusal.
  it.each([
    ["a commit that escapes the read-only transaction", "select 1; commit; insert into t values (1)"],
    ["a hidden commit", "select 1; /**/ commit; /**/ insert into t values (1)"],
    ["two reads", "select 1; select 2"],
  ])("refuses %s (more than one statement)", (_name, sql) => {
    expect(refusalReason(sql)).toMatch(/one statement per run/);
  });

  it("refuses a statement left behind an unclosed comment", () => {
    expect(refusalReason("/* commit")).toMatch(/does not start with a keyword/);
  });

  it("refuses an empty script", () => {
    expect(refusalReason("  -- nothing\n ;")).toBe("no SQL statement given");
  });
});
