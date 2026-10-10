import { describe, it, expect } from "vitest";
import {
  classifyPreExecutionFailure,
  describeError,
  isDbTimeout,
} from "@/lib/dbErrors";

// Synthetic errors shaped like the ones observed against the dev pooler
// (pool acquire timeout, P2028, P2010 statement timeout) and in the
// Vercel runtime logs of the 500-viewer burst (EMAXCONN).

class DriverAdapterError extends Error {
  constructor(public cause: Record<string, unknown>) {
    super(String(cause.message ?? cause.kind));
    this.name = "DriverAdapterError";
  }
}
class PrismaClientKnownRequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public meta: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

// pg-pool's own rejection, rethrown unwrapped by the adapter; Prisma only
// adds `clientVersion` on the non-transactional path.
const acquireTimeout = () =>
  Object.assign(new Error("timeout exceeded when trying to connect"), {
    clientVersion: "7.7.0",
  });

const emaxconn = () =>
  new DriverAdapterError({
    originalCode: "XX000",
    originalMessage: "(EMAXCONN) max client connections reached, limit: 200",
    kind: "postgres",
    code: "XX000",
    severity: "FATAL",
    message: "(EMAXCONN) max client connections reached, limit: 200",
  });

const maxWait = () =>
  new PrismaClientKnownRequestError(
    "Transaction API error: Unable to start a transaction in the given time.",
    "P2028",
  );

const txExpired = () =>
  new PrismaClientKnownRequestError(
    "\nInvalid `prisma.$queryRaw()` invocation:\n\n\nTransaction API error: A query cannot be executed on an expired transaction. The timeout for this transaction was 8000 ms, however 8123 ms passed since the start of the transaction.",
    "P2028",
    { operation: "query", timeout: 8000, timeTaken: 8123 },
  );

const statementTimeout = () =>
  new PrismaClientKnownRequestError(
    "\nInvalid `prisma.$queryRaw()` invocation:\n\n\nRaw query failed. Code: `57014`. Message: `canceling statement due to statement timeout`",
    "P2010",
    {
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: {
          originalCode: "57014",
          kind: "postgres",
          code: "57014",
          severity: "ERROR",
          message: "canceling statement due to statement timeout",
        },
      },
    },
  );

describe("classifyPreExecutionFailure", () => {
  it("pool acquire timeout (plain Error from pg-pool)", () => {
    expect(classifyPreExecutionFailure(acquireTimeout())).toBe("pool_acquire_timeout");
  });

  it("pooler cap: DriverAdapterError with an XX000 / FATAL / EMAXCONN cause", () => {
    expect(classifyPreExecutionFailure(emaxconn())).toBe("pooler_cap");
  });

  it("pooler cap wrapped by Prisma as P2010 under meta.driverAdapterError", () => {
    const wrapped = new PrismaClientKnownRequestError("Raw query failed.", "P2010", {
      driverAdapterError: emaxconn(),
    });
    expect(classifyPreExecutionFailure(wrapped)).toBe("pooler_cap");
  });

  it("Postgres' own too_many_connections (53300 / TooManyConnections)", () => {
    expect(
      classifyPreExecutionFailure(
        new DriverAdapterError({ kind: "TooManyConnections", cause: "too many" }),
      ),
    ).toBe("pooler_cap");
    expect(
      classifyPreExecutionFailure(
        new DriverAdapterError({ kind: "postgres", code: "53300", message: "sorry" }),
      ),
    ).toBe("pooler_cap");
  });

  it("P2028 maxWait flavour only — the expired-transaction flavour ran work", () => {
    expect(classifyPreExecutionFailure(maxWait())).toBe("tx_max_wait");
    expect(classifyPreExecutionFailure(txExpired())).toBeNull();
  });

  it("everything else is not pre-execution", () => {
    expect(classifyPreExecutionFailure(statementTimeout())).toBeNull();
    expect(
      classifyPreExecutionFailure(
        new PrismaClientKnownRequestError("Unique constraint failed", "P2002", {
          target: ["eventId", "position"],
        }),
      ),
    ).toBeNull();
    // A different XX000 (internal error) without EMAXCONN.
    expect(
      classifyPreExecutionFailure(
        new DriverAdapterError({ kind: "postgres", code: "XX000", message: "internal" }),
      ),
    ).toBeNull();
    expect(classifyPreExecutionFailure(new Error("boom"))).toBeNull();
    expect(classifyPreExecutionFailure("string")).toBeNull();
    expect(classifyPreExecutionFailure(null)).toBeNull();
  });

  it("survives a cause cycle", () => {
    const a: Record<string, unknown> = { message: "a" };
    const b: Record<string, unknown> = { message: "b", cause: a };
    a.cause = b;
    expect(classifyPreExecutionFailure(a)).toBeNull();
  });
});

describe("isDbTimeout", () => {
  it.each([
    ["acquire timeout", acquireTimeout()],
    ["maxWait P2028", maxWait()],
    ["expired transaction P2028", txExpired()],
    ["statement_timeout 57014", statementTimeout()],
  ])("%s → true", (_label, err) => {
    expect(isDbTimeout(err)).toBe(true);
  });

  it("other failures → false", () => {
    expect(isDbTimeout(emaxconn())).toBe(false);
    expect(isDbTimeout(new Error("boom"))).toBe(false);
  });
});

describe("describeError", () => {
  it("class:message on one line, message capped at 120 chars", () => {
    expect(describeError(acquireTimeout())).toBe(
      "Error:timeout exceeded when trying to connect",
    );
    const d = describeError(statementTimeout());
    expect(d.startsWith("PrismaClientKnownRequestError:Invalid `prisma.$queryRaw()` invocation: Raw query failed.")).toBe(true);
    expect(d).not.toMatch(/\n/);
    expect(d.length).toBeLessThanOrEqual("PrismaClientKnownRequestError:".length + 120);
  });

  it("non-Error values", () => {
    expect(describeError("x y")).toBe("string:x y");
    expect(describeError(undefined)).toBe("undefined:undefined");
  });
});
