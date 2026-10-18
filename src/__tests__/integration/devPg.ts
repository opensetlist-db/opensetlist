import { Client, types } from "pg";

/**
 * The raw `pg` client the integration suites use for fixtures, restores
 * and cleanup (beside the code under test, which goes through Prisma).
 *
 * Why not a bare `new Client(...)`: every timestamp column in this
 * schema is `timestamp(3)` WITHOUT time zone holding UTC wall time
 * (Prisma's convention), and node-pg converts both ways in the
 * MACHINE'S LOCAL zone:
 *   - a JS `Date` passed as a parameter is serialized as local time
 *     with an offset, and Postgres drops the offset for this type — the
 *     row lands hours off on any non-UTC laptop (the board picks lock-boundary
 *     fixture, 2026-10-18);
 *   - a `timestamp` read back is parsed as local time, so a value read
 *     and written back (n14's "restore with the same startTime") moves.
 *
 * This client fixes both deterministically:
 *   - reads: `timestamp` (OID 1114) parses as UTC;
 *   - writes: a `Date` parameter THROWS — pass `utcParam(date)` (the
 *     UTC ISO string, whose wall time is what the column holds).
 * Prisma calls are unaffected (the adapter does its own conversion).
 */

const TIMESTAMP_OID = 1114;

/** A `Date` as a query parameter for a `timestamp` column: the UTC ISO
 *  string. */
export function utcParam(d: Date): string {
  return d.toISOString();
}

export function devPgClient(): Client {
  const client = new Client({
    connectionString: process.env.DATABASE_URL_UNPOOLED,
    types: {
      getTypeParser: ((oid: number, format?: "text" | "binary") =>
        oid === TIMESTAMP_OID
          ? (v: string) => new Date(`${v.replace(" ", "T")}Z`)
          : types.getTypeParser(oid, format)) as typeof types.getTypeParser,
    },
  });
  const query = client.query.bind(client) as (...args: unknown[]) => unknown;
  client.query = ((...args: unknown[]) => {
    const values = Array.isArray(args[1])
      ? args[1]
      : (args[0] as { values?: unknown[] } | undefined)?.values;
    if (values?.some((v) => v instanceof Date)) {
      throw new Error(
        "devPgClient: a Date query parameter would be written in local time; pass utcParam(date) instead",
      );
    }
    return query(...args);
  }) as typeof client.query;
  return client;
}
