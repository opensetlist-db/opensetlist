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
    ["a multi-statement read", "select 1; select count(*) from \"Event\";"],
    ["a CTE read", "with e as (select id from \"Event\") select count(*) from e"],
    ["a transaction-scoped setting", "set local work_mem = '64MB'; select 1"],
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
    ["a commit that escapes the read-only transaction", "select 1; commit; insert into t values (1)"],
    ["a write in a later statement", "select 1;\n  update t set a = 1;"],
  ])("refuses %s", (_name, sql) => {
    expect(refusalReason(sql)).toMatch(/only reads|session setting/);
  });

  it("refuses an empty script", () => {
    expect(refusalReason("  -- nothing\n ;")).toBe("no SQL statement given");
  });
});
