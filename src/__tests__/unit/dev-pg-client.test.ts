// @vitest-environment node
//
// `devPgClient()` (src/__tests__/integration/devPg.ts) refuses a JS Date
// query parameter anywhere in the values — including inside an array
// parameter, which node-pg serializes element by element in local
// time. No database: the guard throws before the query is sent.
import { describe, it, expect } from "vitest";
import { devPgClient, utcParam } from "../integration/devPg";

describe("devPgClient Date guard", () => {
  const client = devPgClient();
  const d = new Date("2026-11-14T07:30:00.000Z");

  it.each([
    ["top-level Date", [d]],
    ["Date inside an array parameter", [[d]]],
    ["Date nested two levels deep", [["x", [d]]]],
  ])("throws on a %s", (_name, values) => {
    expect(() => client.query("SELECT $1", values as unknown[])).toThrow(
      /utcParam/,
    );
  });

  it("throws on a Date in a config object's values", () => {
    expect(() => client.query({ text: "SELECT $1", values: [[d]] })).toThrow(
      /utcParam/,
    );
  });

  it("utcParam gives the UTC ISO string", () => {
    expect(utcParam(d)).toBe("2026-11-14T07:30:00.000Z");
  });
});
