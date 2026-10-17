import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "pg";

// `GET /api/setlist` for a soft-deleted or missing event — integration
// test against the DEV database.
//
// What only a real database can prove: the snapshot builder's LEFT JOIN
// of the event head really reports `isDeleted` / `found` for a row the
// admin delete just soft-deleted (inside its live-writer transaction,
// revision bump + broadcast included), and the route turns that into a
// 404 — then back into a 200 once the row is restored, with nothing
// cached in between (the data cache is a pass-through here, as in the
// n14 suites, so every request is a real build).
//
// Everything runs on a throwaway Event created here (slug
// `deleted404-itest-<ts>`) and hard-deleted in afterAll. It never touches
// an existing event (the load harness's event 111 in particular). The
// delete's `realtime.messages` row is left to Supabase's retention
// (72 h), like the other suites' broadcasts.

vi.mock("@/lib/admin-auth", () => ({ verifyAdminAPI: vi.fn(async () => null) }));

// `unstable_cache` and tag expiry need a Next request scope; outside one
// they throw / only log. Pass-through cache, spied expiry — same as
// n14-live-path.test.ts.
vi.mock("@/lib/dataCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dataCache")>()),
  cachedQuery:
    <A extends unknown[], R>(_name: string, fn: (...args: A) => Promise<R>) =>
    (...args: A) =>
      fn(...args),
  revalidateEventData: vi.fn(),
  revalidatePublicData: vi.fn(),
  revalidateEventImpressions: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { __resetLiveSnapshotStateForTests } from "@/lib/liveSnapshot";
import { GET as SETLIST_GET } from "@/app/api/setlist/route";
import { DELETE as ADMIN_EVENT_DELETE } from "@/app/api/admin/events/[id]/route";
import type { NextRequest } from "next/server";

const SLUG = `deleted404-itest-${Date.now()}`;
let eventId: bigint;
// Separate session-pooler connection for the restore and the cleanup,
// so they never share a backend with the code under test.
const pg = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });

function getReq(url: string): NextRequest {
  return new Request(url, { method: "GET" }) as unknown as NextRequest;
}

async function fetchSnapshot(id: bigint, query = "") {
  const res = await SETLIST_GET(
    getReq(`http://x/api/setlist?eventId=${id}&locale=ko${query}`),
  );
  return { res, body: await res.json() };
}

beforeAll(async () => {
  await pg.connect();
  const created = await prisma.event.create({
    data: {
      slug: SLUG,
      type: "concert",
      status: "ongoing",
      startTime: new Date(Date.now() - 60 * 60 * 1000),
      originalName: "deleted-404 integration test (throwaway)",
    },
    select: { id: true },
  });
  eventId = created.id;
});

afterAll(async () => {
  if (eventId !== undefined) {
    // Hard-clean: the event has no child rows (nothing in this suite
    // creates any), but clear the usual dependants anyway so a future
    // edit that adds some cannot leave a dangling FK behind.
    const id = eventId.toString();
    await pg.query("BEGIN");
    for (const sql of [
      `DELETE FROM "SetlistItem" WHERE "eventId" = $1`,
      `DELETE FROM "SongWish" WHERE "eventId" = $1`,
      `DELETE FROM "EventImpression" WHERE "eventId" = $1`,
      `DELETE FROM "EventPerformer" WHERE "eventId" = $1`,
      `DELETE FROM "EventTranslation" WHERE "eventId" = $1`,
      `DELETE FROM "Event" WHERE id = $1`,
    ]) {
      await pg.query(sql, [id]);
    }
    await pg.query("COMMIT");
  }
  await pg.end();
  await prisma.$disconnect();
});

beforeEach(() => {
  // Per-process memo / coalescing state of the snapshot path: each
  // request must read the database, not a previous answer.
  __resetLiveSnapshotStateForTests();
});

describe("GET /api/setlist — soft-deleted / missing event → 404", () => {
  it("live event → 200 with the snapshot", async () => {
    const { res, body } = await fetchSnapshot(eventId);
    expect(res.status).toBe(200);
    expect(body.status).toBe("ongoing");
    expect(Array.isArray(body.items)).toBe(true);
    expect(res.headers.get("x-snapshot-verify")).toBe("none");
  });

  it("admin soft-delete → 404 not_found (plain and hinted requests)", async () => {
    const del = await ADMIN_EVENT_DELETE(
      getReq(`http://x/api/admin/events/${eventId}`),
      { params: Promise.resolve({ id: eventId.toString() }) },
    );
    expect(del.status).toBe(200);
    const row = await pg.query<{ isDeleted: boolean }>(
      `SELECT "isDeleted" FROM "Event" WHERE id = $1`,
      [eventId.toString()],
    );
    expect(row.rows[0].isDeleted).toBe(true);

    for (const query of ["", "&minRev=1", "&minRev=1&hint=1"]) {
      __resetLiveSnapshotStateForTests();
      const { res, body } = await fetchSnapshot(eventId, query);
      expect(res.status).toBe(404);
      expect(body).toEqual({ error: "not_found" });
      expect(res.headers.get("Cache-Control")).toBe(
        "public, max-age=0, must-revalidate",
      );
      expect(res.headers.get("x-snapshot-source")).toMatch(/^(build|cache|repair|warm)$/);
      expect(res.headers.get("x-snapshot-verify")).toBeNull();
    }
  });

  it("restored → 200 again", async () => {
    await pg.query(
      `UPDATE "Event" SET "isDeleted" = false, "deletedAt" = NULL WHERE id = $1`,
      [eventId.toString()],
    );
    const { res, body } = await fetchSnapshot(eventId);
    expect(res.status).toBe(200);
    expect(body.status).toBe("ongoing");
  });

  it("an id with no Event row → 404 not_found", async () => {
    // Far above any real id; read-only.
    const { res, body } = await fetchSnapshot(BigInt("9223372036854775000"));
    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "not_found" });
  });
});
