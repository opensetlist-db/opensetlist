/**
 * Classification of database failures on the live path.
 *
 * Errors reach our code in three shapes, depending on where they were
 * raised (observed against the dev pooler with @prisma/client 7.7 +
 * @prisma/adapter-pg 7.7 + pg 8.20, and in the Vercel runtime logs of
 * the 500-viewer burst):
 *
 *   1. Pool acquire timeout — pg-pool rejects with a PLAIN `Error`
 *      ("timeout exceeded when trying to connect"). The adapter's
 *      `convertDriverError` doesn't recognize it and rethrows it as is,
 *      so it surfaces unwrapped (Prisma only adds `clientVersion`), both
 *      from `$transaction` and from a plain query.
 *   2. Connection refused by the pooler — `DriverAdapterError` whose
 *      `cause` is the mapped driver error: `{ kind: "postgres",
 *      code: "XX000", severity: "FATAL", message: "(EMAXCONN) max client
 *      connections reached, limit: 200" }`. Supavisor uses the generic
 *      XX000 SQLSTATE, so the adapter does NOT map it to its
 *      `TooManyConnections` kind (that only happens for Postgres' own
 *      53300); EMAXCONN is only visible in the message text.
 *   3. A statement that failed inside a query — Prisma wraps it as
 *      `PrismaClientKnownRequestError` P2010 with the adapter error under
 *      `meta.driverAdapterError` (e.g. a statement timeout: cause
 *      `{ code: "57014", message: "canceling statement due to statement
 *      timeout" }`).
 *
 * Prisma's own transaction errors are `PrismaClientKnownRequestError`
 * P2028 in two flavours that must not be confused: "Unable to start a
 * transaction in the given time." (`maxWait` exceeded — nothing ran) and
 * "A query cannot be executed on an expired transaction…" (`timeout`
 * exceeded mid-transaction — work DID run and was rolled back).
 */

type ErrorNode = Record<string, unknown>;

/**
 * The error and everything it wraps (`cause`, and Prisma's
 * `meta.driverAdapterError`), breadth-first, bounded and cycle-safe.
 */
function errorNodes(err: unknown): ErrorNode[] {
  const out: ErrorNode[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [err];
  while (queue.length > 0 && out.length < 8) {
    const cur = queue.shift();
    if (cur === null || typeof cur !== "object" || seen.has(cur)) continue;
    seen.add(cur);
    const node = cur as ErrorNode;
    out.push(node);
    queue.push(node.cause);
    const meta = node.meta;
    if (meta !== null && typeof meta === "object") {
      queue.push((meta as ErrorNode).driverAdapterError);
    }
  }
  return out;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Failures that happen BEFORE any statement of the request's work ran:
 * the request never got a database connection. Retrying such a request
 * cannot duplicate a write, which is what makes a 503 + Retry-After
 * honest for them.
 *
 *   - `pool_acquire_timeout`: no slot in this instance's pg pool within
 *     `connectionTimeoutMillis`.
 *   - `pooler_cap`: the pooler refused a new client connection
 *     (Supavisor EMAXCONN, or Postgres' own 53300 too_many_connections).
 *   - `tx_max_wait`: Prisma's `maxWait` expired before the transaction
 *     could start. Only the "Unable to start" flavour of P2028 — the
 *     expiry flavour is a mid-transaction failure and returns null.
 *
 * Callers that run a transaction must still check that the callback was
 * never entered before treating a match as pre-execution (see
 * `liveWriterTransaction`); the classifier only looks at the error.
 */
export type PreExecutionFailure =
  | "pool_acquire_timeout"
  | "pooler_cap"
  | "tx_max_wait";

export function classifyPreExecutionFailure(
  err: unknown,
): PreExecutionFailure | null {
  for (const node of errorNodes(err)) {
    const message = str(node.message);
    if (message.startsWith("timeout exceeded when trying to connect")) {
      return "pool_acquire_timeout";
    }
    const code = str(node.code) || str(node.originalCode);
    if (message.includes("EMAXCONN") && (code === "XX000" || code === "")) {
      return "pooler_cap";
    }
    if (code === "53300" || node.kind === "TooManyConnections") {
      return "pooler_cap";
    }
    if (
      code === "P2028" &&
      message.includes("Unable to start a transaction in the given time")
    ) {
      return "tx_max_wait";
    }
  }
  return null;
}

/**
 * Whether a failed read ran out of time rather than failing for another
 * reason: waiting for a pool slot, Prisma's `maxWait`/`timeout` (P2028,
 * either flavour), or Postgres cancelling the statement
 * (`statement_timeout`, SQLSTATE 57014). Used for log labelling only.
 */
export function isDbTimeout(err: unknown): boolean {
  for (const node of errorNodes(err)) {
    const message = str(node.message);
    if (message.startsWith("timeout exceeded when trying to connect")) {
      return true;
    }
    const code = str(node.code) || str(node.originalCode);
    if (code === "P2028" || code === "57014") return true;
  }
  return false;
}

/**
 * `<class>:<first 120 chars of the message>` on one line, for the
 * `err=` field of diagnostic log lines. Prisma messages start with
 * newlines and embed invocation context, so whitespace is collapsed.
 */
export function describeError(err: unknown): string {
  if (err !== null && typeof err === "object") {
    const ctor = (err as { constructor?: { name?: unknown } }).constructor;
    const name = typeof ctor?.name === "string" && ctor.name ? ctor.name : "Object";
    const message = str((err as ErrorNode).message)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    return `${name}:${message}`;
  }
  return `${typeof err}:${String(err).replace(/\s+/g, " ").trim().slice(0, 120)}`;
}
