import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Pool } from "pg";
import {
  installOpenTransactionGuard,
  OPEN_TX_RELEASE_LOG_PREFIX,
} from "@/lib/pgPool";

// The guard against reusing a pooled client that is still inside a
// transaction (src/lib/pgPool.ts), driven with stand-ins for pg-pool's
// events and pg's per-client `connection` emitter. The real give-up path
// against the dev database is covered by
// src/__tests__/integration/prisma-pool-txleak.test.ts.

function setup() {
  const pool = new EventEmitter();
  const log = vi.fn();
  installOpenTransactionGuard(pool as unknown as Pool, log);
  const newClient = () => {
    const connection = new EventEmitter();
    const client = { connection, query: vi.fn(async () => ({})) };
    pool.emit("connect", client);
    // What pg's Connection emits for each ReadyForQuery ('Z') message.
    const ready = (status: string) =>
      connection.emit("readyForQuery", { name: "readyForQuery", length: 5, status });
    return { client, ready };
  };
  return { pool, log, newClient };
}

describe("installOpenTransactionGuard", () => {
  it("rolls back a client released inside a transaction, once, before reuse", () => {
    const { pool, log, newClient } = setup();
    const { client, ready } = newClient();
    ready("T");
    pool.emit("release", undefined, client);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(log).toHaveBeenCalledWith(expect.stringContaining(OPEN_TX_RELEASE_LOG_PREFIX));
    expect(log.mock.calls[0][0]).toContain("status=T");
  });

  it("also rolls back a failed transaction ('E')", () => {
    const { pool, newClient } = setup();
    const { client, ready } = newClient();
    ready("E");
    pool.emit("release", undefined, client);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("does nothing on a normal release (status 'I', or no status seen yet)", () => {
    const { pool, log, newClient } = setup();
    const fresh = newClient();
    pool.emit("release", undefined, fresh.client);
    const used = newClient();
    used.ready("T");
    used.ready("I"); // Prisma's own COMMIT/ROLLBACK came back
    pool.emit("release", undefined, used.client);
    expect(fresh.client.query).not.toHaveBeenCalled();
    expect(used.client.query).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("leaves a client released with an error to pg-pool, which destroys it", () => {
    const { pool, newClient } = setup();
    const { client, ready } = newClient();
    ready("T");
    pool.emit("release", new Error("boom"), client);
    expect(client.query).not.toHaveBeenCalled();
  });

  it("tracks status per client", () => {
    const { pool, newClient } = setup();
    const a = newClient();
    const b = newClient();
    a.ready("T");
    b.ready("I");
    pool.emit("release", undefined, b.client);
    pool.emit("release", undefined, a.client);
    expect(b.client.query).not.toHaveBeenCalled();
    expect(a.client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("logs, and does not throw, when the guard's ROLLBACK fails", async () => {
    const { pool, log, newClient } = setup();
    const { client, ready } = newClient();
    client.query.mockRejectedValueOnce(new Error("Connection terminated"));
    ready("T");
    pool.emit("release", undefined, client);
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith(
        "[pgPool] guard ROLLBACK failed: Connection terminated",
      ),
    );
  });

  it("disables itself with one log line if pg stops exposing `connection`", () => {
    const { pool, log } = setup();
    const bare = { query: vi.fn() };
    pool.emit("connect", bare);
    pool.emit("connect", { query: vi.fn() });
    pool.emit("release", undefined, bare);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("guard disabled");
    expect(bare.query).not.toHaveBeenCalled();
  });
});
