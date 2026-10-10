import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

// n14 live path — integration tests against the DEV database.
//
// What only a real database can prove (the unit suites mock all of it):
//   1. writer matrix — every setlist writer produces exactly one
//      revision increment and exactly one `realtime.messages` row per
//      logical save (and the non-writers produce none);
//   2. a transaction that sent and then rolled back leaves no revision
//      and no message;
//   3. a failing `realtime.send` does not abort the save;
//   4. two overlapping same-event saves serialize on the row lock;
//   5. the snapshot builder is one consistent REPEATABLE READ snapshot;
//   6. the reaction ack watermark orders correctly against snapshots;
//   7. the repair check's revision read works through the pooler with
//      its transaction-local statement_timeout.
//
// Everything runs on a throwaway Event created here (slug
// `n14-itest-<ts>`) and hard-deleted in afterAll with all of its rows.
// `realtime.messages` rows are left to Supabase's retention (72 h).
//
// Barriers are explicit promises; the only polling is waiting for a
// backend to show up as lock-waiting in pg_stat_activity (a condition,
// not a sleep), bounded by the test timeout.

vi.mock("@/lib/admin-auth", () => ({ verifyAdminAPI: vi.fn(async () => null) }));

// Cache expiry needs a Next request scope; outside one it would only
// log. The suites assert database effects, not cache effects.
vi.mock("@/lib/dataCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dataCache")>()),
  revalidateEventData: vi.fn(),
  revalidatePublicData: vi.fn(),
  revalidateEventImpressions: vi.fn(),
}));

// The flag-gated public writers are off in production; turn them on so
// their transactions are covered too.
vi.mock("@/lib/launchFlags", () => ({
  LAUNCH_FLAGS: {
    showSignIn: false,
    showSearch: false,
    confirmDbEnabled: true,
    addItemEnabled: true,
  },
}));

import { prisma } from "@/lib/prisma";
import {
  bumpSetlistRevisionAndBroadcast,
  lockEvent,
  liveTopic,
  LIVE_BROADCAST_PRIVATE,
} from "@/lib/liveBroadcast";
import {
  buildEventSnapshot,
  readRevisionBounded,
  __setSnapshotEstablishedHookForTests,
} from "@/lib/liveSnapshot";
import { POST as ADMIN_CREATE } from "@/app/api/admin/setlist-items/route";
import {
  PUT as ADMIN_PUT,
  DELETE as ADMIN_DELETE,
} from "@/app/api/admin/setlist-items/[id]/route";
import { POST as ADMIN_INSERT_AFTER } from "@/app/api/admin/setlist-items/insert-after/route";
import { POST as ADMIN_SWAP } from "@/app/api/admin/setlist-items/swap/route";
import { PUT as ADMIN_EVENT_PUT } from "@/app/api/admin/events/[id]/route";
import { POST as ADMIN_IMPORT } from "@/app/api/admin/import/route";
import { POST as PUBLIC_ADD_ITEM } from "@/app/api/events/[id]/setlist-items/route";
import { POST as CONFIRM } from "@/app/api/setlist-items/[id]/confirm/route";
import {
  POST as REACTION_POST,
  DELETE as REACTION_DELETE,
} from "@/app/api/reactions/route";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------
// fixtures + measurement helpers
// ---------------------------------------------------------------------

const SLUG = `n14-itest-${Date.now()}`;
let eventId: bigint;
let topic: string;
let songA: bigint;
let songB: bigint;
// Separate session-pooler connection for observation and out-of-band
// commits, so it never shares a backend with the code under test.
const pg = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });

type Message = {
  topic: string;
  event: string;
  extension: string;
  private: boolean;
  payload: { rev: number; kind: string };
};

function req(url: string, body: unknown, method = "POST"): NextRequest {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}
const params = (id: string | bigint) => ({
  params: Promise.resolve({ id: id.toString() }),
});

async function currentRev(): Promise<number> {
  const r = await pg.query<{ rev: string }>(
    `SELECT "setlistRevision"::text AS rev FROM "Event" WHERE id = $1`,
    [eventId.toString()],
  );
  return Number(r.rows[0].rev);
}

async function messages(): Promise<Message[]> {
  const r = await pg.query<Message>(
    `SELECT topic, event, extension, private, payload
       FROM realtime.messages
      WHERE topic = $1
      ORDER BY (payload->>'rev')::bigint`,
    [topic],
  );
  return r.rows;
}

async function activeItems(): Promise<{ id: string; position: number }[]> {
  const r = await pg.query<{ id: string; position: number }>(
    `SELECT id::text, position FROM "SetlistItem"
      WHERE "eventId" = $1 AND "isDeleted" = false
      ORDER BY position, id`,
    [eventId.toString()],
  );
  return r.rows;
}

/**
 * Run one logical save and assert it produced exactly one revision
 * increment and exactly one broadcast row carrying that revision.
 */
async function expectOneSave<T>(save: () => Promise<T>): Promise<T> {
  const before = await currentRev();
  const out = await save();
  const after = await currentRev();
  expect(after).toBe(before + 1);
  const fresh = (await messages()).filter((m) => m.payload.rev > before);
  expect(fresh).toHaveLength(1);
  expect(fresh[0]).toMatchObject({
    topic,
    event: "rev",
    extension: "broadcast",
    private: LIVE_BROADCAST_PRIVATE,
    payload: { rev: after, kind: "setlist" },
  });
  return out;
}

/** Run something that must NOT touch the revision or broadcast. */
async function expectNoSave<T>(run: () => Promise<T>): Promise<T> {
  const before = await currentRev();
  const count = (await messages()).length;
  const out = await run();
  expect(await currentRev()).toBe(before);
  expect(await messages()).toHaveLength(count);
  return out;
}

/** A controllable barrier. */
function barrier() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { open, opened };
}

/** Wait until some backend is blocked on a lock (pg_stat_activity). */
async function waitForLockWaiter(marker: string): Promise<void> {
  for (;;) {
    const r = await pg.query(
      `SELECT 1 FROM pg_stat_activity
        WHERE wait_event_type = 'Lock'
          AND query LIKE '%FOR UPDATE%'
          AND query LIKE $1`,
      [`%${marker}%`],
    );
    if (r.rowCount && r.rowCount > 0) return;
    await new Promise((r) => setImmediate(r));
  }
}

async function createItemViaAdmin(position: number): Promise<bigint> {
  const res = await ADMIN_CREATE(
    req("http://x/api/admin/setlist-items", {
      eventId: eventId.toString(),
      position,
      type: "mc",
    }),
  );
  expect(res.status).toBe(201);
  return BigInt((await res.json()).id);
}

beforeAll(async () => {
  await pg.connect();
  const songs = await pg.query<{ id: string }>(
    `SELECT id::text FROM "Song" WHERE "isDeleted" = false ORDER BY id LIMIT 2`,
  );
  songA = BigInt(songs.rows[0].id);
  songB = BigInt(songs.rows[1].id);
  const created = await prisma.event.create({
    data: {
      slug: SLUG,
      type: "concert",
      status: "ongoing",
      startTime: new Date(Date.now() - 60 * 60 * 1000),
      originalName: "n14 integration test (throwaway)",
    },
    select: { id: true },
  });
  eventId = created.id;
  topic = liveTopic(eventId);
});

afterAll(async () => {
  __setSnapshotEstablishedHookForTests(null);
  if (eventId !== undefined) {
    const id = eventId.toString();
    const items = `(SELECT id FROM "SetlistItem" WHERE "eventId" = $1)`;
    await pg.query("BEGIN");
    for (const sql of [
      `DELETE FROM "SetlistItemConfirm" WHERE "setlistItemId" IN ${items}`,
      `DELETE FROM "ContestReport" WHERE "setlistItemId" IN ${items}`,
      `DELETE FROM "SetlistItemReaction" WHERE "setlistItemId" IN ${items}`,
      `DELETE FROM "SetlistItemSong" WHERE "setlistItemId" IN ${items}`,
      `DELETE FROM "SetlistItemMember" WHERE "setlistItemId" IN ${items}`,
      `DELETE FROM "SetlistItemArtist" WHERE "setlistItemId" IN ${items}`,
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

// ---------------------------------------------------------------------
// 1. writer matrix
// ---------------------------------------------------------------------

describe("1. writer matrix: one revision + one broadcast per logical save", () => {
  it("positive control: a bare lock + bump transaction is measured as one save", async () => {
    await expectOneSave(() =>
      prisma.$transaction(async (tx) => {
        await lockEvent(tx, eventId);
        await bumpSetlistRevisionAndBroadcast(tx, eventId);
      }),
    );
  });

  it("admin POST (create)", async () => {
    await expectOneSave(() => createItemViaAdmin(1));
  });

  it("admin PUT (update + link rewrite) returns the new rev", async () => {
    const [first] = await activeItems();
    const res = await expectOneSave(() =>
      ADMIN_PUT(
        req(
          `http://x/api/admin/setlist-items/${first.id}`,
          { position: 1, type: "song", songIds: [Number(songA)] },
          "PUT",
        ),
        params(first.id),
      ),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).rev).toBe(await currentRev());
  });

  it("insert-after shifting k = 3 rows is still exactly one save", async () => {
    // Build positions 1..4 (1 exists), then insert after 1 → shifts 2,3,4.
    await createItemViaAdmin(2);
    await createItemViaAdmin(3);
    await createItemViaAdmin(4);
    const res = await expectOneSave(() =>
      ADMIN_INSERT_AFTER(
        req("http://x/api/admin/setlist-items/insert-after", {
          eventId: eventId.toString(),
          afterPosition: 1,
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect((await activeItems()).map((i) => i.position)).toEqual([1, 2, 3, 4, 5]);
  });

  it("swap", async () => {
    const items = await activeItems();
    const res = await expectOneSave(() =>
      ADMIN_SWAP(
        req("http://x/api/admin/setlist-items/swap", {
          itemIdA: items[0].id,
          itemIdB: items[4].id,
        }),
      ),
    );
    expect(res.status).toBe(200);
    const after = await activeItems();
    expect(after.find((i) => i.id === items[0].id)?.position).toBe(5);
    expect(after.find((i) => i.id === items[4].id)?.position).toBe(1);
  });

  it("admin DELETE (soft delete)", async () => {
    const items = await activeItems();
    const last = items[items.length - 1];
    const res = await expectOneSave(() =>
      ADMIN_DELETE(
        req(`http://x/api/admin/setlist-items/${last.id}`, {}, "DELETE"),
        params(last.id),
      ),
    );
    expect(res.status).toBe(200);
  });

  const eventBody = (overrides: Record<string, unknown>) => ({
    type: "concert",
    startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    originalName: "n14 integration test (throwaway)",
    originalLanguage: "ja",
    translations: [{ locale: "ja", name: "n14 itest" }],
    ...overrides,
  });

  it("admin event PUT that changes status bumps; one that changes nothing live does not", async () => {
    const res = await expectOneSave(() =>
      ADMIN_EVENT_PUT(
        req(
          `http://x/api/admin/events/${eventId}`,
          eventBody({ status: "completed" }),
          "PUT",
        ),
        params(eventId),
      ),
    );
    expect(res.status).toBe(200);
    // Restore 'ongoing' (also a live change → one save), keeping the
    // startTime identical so the next PUT is a pure title edit.
    const row = await pg.query<{ st: Date }>(
      `SELECT "startTime" AS st FROM "Event" WHERE id = $1`,
      [eventId.toString()],
    );
    const startTime = row.rows[0].st.toISOString();
    await expectOneSave(() =>
      ADMIN_EVENT_PUT(
        req(
          `http://x/api/admin/events/${eventId}`,
          eventBody({ status: "ongoing", startTime }),
          "PUT",
        ),
        params(eventId),
      ),
    );
    const titleOnly = await expectNoSave(() =>
      ADMIN_EVENT_PUT(
        req(
          `http://x/api/admin/events/${eventId}`,
          eventBody({ startTime, originalName: "n14 itest renamed" }),
          "PUT",
        ),
        params(eventId),
      ),
    );
    expect(titleOnly.status).toBe(200);
  });

  it("CSV setlist import replaces the event's setlist as one save", async () => {
    const csv = [
      "event_slug,position,itemType,status",
      `${SLUG},1,mc,confirmed`,
      `${SLUG},2,mc,confirmed`,
      `${SLUG},3,mc,confirmed`,
    ].join("\n");
    const res = await expectOneSave(() =>
      ADMIN_IMPORT(req("http://x/api/admin/import", { type: "setlistitems", csv })),
    );
    expect(res.status).toBe(200);
    expect((await activeItems()).map((i) => i.position)).toEqual([1, 2, 3]);
  });

  it("public add-item (flag-gated) create and auto-merge each bump once", async () => {
    const body = {
      itemType: "song",
      songId: songA.toString(),
      performerIds: [],
      isEncore: false,
      position: 10,
    };
    const created = await expectOneSave(() =>
      PUBLIC_ADD_ITEM(req(`http://x/api/events/${eventId}/setlist-items`, body), params(eventId)),
    );
    expect(created.status).toBe(201);
    const merged = await expectOneSave(() =>
      PUBLIC_ADD_ITEM(req(`http://x/api/events/${eventId}/setlist-items`, body), params(eventId)),
    );
    expect(merged.status).toBe(200);
    expect((await merged.json()).action).toBe("auto-confirm-merge");
  });

  it("confirm: plain votes never bump; the promotion bumps once", async () => {
    // Sibling rumoured row (different song) at position 10 → conflict.
    const sibling = await expectOneSave(() =>
      PUBLIC_ADD_ITEM(
        req(`http://x/api/events/${eventId}/setlist-items`, {
          itemType: "song",
          songId: songB.toString(),
          performerIds: [],
          isEncore: false,
          position: 10,
        }),
        params(eventId),
      ),
    );
    const siblingId = (await sibling.json()).item.id as number;
    // The sibling has 0 confirms; threshold is 3. Votes 1 and 2 are
    // plain confirms (no bump), vote 3 crosses the threshold.
    const vote = () => CONFIRM(req(`http://x/api/setlist-items/${siblingId}/confirm`, {}), params(String(siblingId)));
    expect(await (await expectNoSave(vote)).json()).toEqual({ ok: true });
    expect(await (await expectNoSave(vote)).json()).toEqual({ ok: true });
    const promoted = await expectOneSave(vote);
    expect(await promoted.json()).toEqual({ ok: true, promoted: true });
  });

  it("reactions (insert + delete) never bump", async () => {
    const [item] = await activeItems();
    const posted = await expectNoSave(() =>
      REACTION_POST(
        req("http://x/api/reactions", { setlistItemId: item.id, reactionType: "best" }),
      ),
    );
    const { reactionId } = await posted.json();
    await expectNoSave(() =>
      REACTION_DELETE(req("http://x/api/reactions", { reactionId }, "DELETE")),
    );
  });
});

// ---------------------------------------------------------------------
// 2. rollback after send
// ---------------------------------------------------------------------

describe("2. rollback after send", () => {
  it("a transaction that bumped and sent, then failed, leaves no revision and no message", async () => {
    await expectNoSave(async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          await lockEvent(tx, eventId);
          await bumpSetlistRevisionAndBroadcast(tx, eventId);
          throw new Error("boom after send");
        }),
      ).rejects.toThrow("boom after send");
    });
  });
});

// ---------------------------------------------------------------------
// 3. caught send failure
// ---------------------------------------------------------------------

describe("3. a failing realtime.send does not abort the save", () => {
  it("installed realtime.send swallows inner errors as a WARNING", async () => {
    const def = await pg.query<{ d: string }>(
      `SELECT pg_get_functiondef('realtime.send(jsonb,text,text,boolean)'::regprocedure) AS d`,
    );
    expect(def.rows[0].d).toMatch(/EXCEPTION\s+WHEN OTHERS THEN\s+RAISE WARNING/);
  });

  it("a real inner failure (NULL topic → NOT NULL violation) still commits the surrounding write", async () => {
    // Uses its own session so we can watch the WARNING arrive.
    const c = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
    await c.connect();
    const warnings: string[] = [];
    c.on("notice", (n) => {
      if (n.severity === "WARNING" || (n as { code?: string }).code === "01000") {
        warnings.push(n.message ?? "");
      }
    });
    const before = await currentRev();
    const count = (await messages()).length;
    try {
      await c.query("BEGIN");
      await c.query(`SELECT id FROM "Event" WHERE id = $1 FOR UPDATE`, [eventId.toString()]);
      await c.query(
        `UPDATE "Event" SET "setlistRevision" = "setlistRevision" + 1 WHERE id = $1`,
        [eventId.toString()],
      );
      // topic NULL: the INSERT into realtime.messages violates
      // topic NOT NULL inside realtime.send's inner block.
      await c.query(
        `SELECT realtime.send('{"rev":0,"kind":"setlist"}'::jsonb, 'rev', NULL::text, false)`,
      );
      await c.query("COMMIT");
    } finally {
      await c.end();
    }
    expect(warnings.some((w) => w.includes("WarnSendingBroadcastMessage"))).toBe(true);
    // The write committed; no message for our topic was produced.
    expect(await currentRev()).toBe(before + 1);
    expect(await messages()).toHaveLength(count);
  });
});

// ---------------------------------------------------------------------
// 4. overlapping saves
// ---------------------------------------------------------------------

describe("4. overlapping same-event saves serialize on the row lock", () => {
  it("the second save waits, sees the first save's row, and revisions end +2", async () => {
    const r0 = await currentRev();
    const startItems = await activeItems();
    const lastPos = Math.max(0, ...startItems.map((i) => i.position));
    const t1Locked = barrier();
    const t1Release = barrier();

    // T1: a writer that takes the lock and holds it until released,
    // then appends a row at the end.
    const t1 = prisma.$transaction(async (tx) => {
      await lockEvent(tx, eventId);
      t1Locked.open();
      await t1Release.opened;
      await tx.setlistItem.create({
        data: { eventId, position: lastPos + 1, type: "mc", status: "confirmed" },
      });
      return bumpSetlistRevisionAndBroadcast(tx, eventId);
    });
    await t1Locked.opened;

    // T2: the real insert-after route, inserting at the top. Without the
    // lock it would read the tail before T1's row exists and its shift
    // would collide with T1's row on the (eventId, position) unique.
    const t2 = ADMIN_INSERT_AFTER(
      req("http://x/api/admin/setlist-items/insert-after", {
        eventId: eventId.toString(),
        afterPosition: 0,
      }),
    );
    await waitForLockWaiter(`"Event"`);
    // T2 is now provably blocked on T1's row lock.
    t1Release.open();
    const [t1Rev, t2Res] = await Promise.all([t1, t2]);
    expect(t2Res.status).toBe(200);
    expect(Number(t1Rev)).toBe(r0 + 1);
    expect((await t2Res.json()).rev).toBe(r0 + 2);

    // T2 ran strictly after T1: it shifted every pre-existing row AND
    // T1's appended row by one, and took position 1 itself.
    const expected = [
      1,
      ...startItems.map((i) => i.position + 1),
      lastPos + 2,
    ].sort((a, b) => a - b);
    expect((await activeItems()).map((i) => i.position)).toEqual(expected);
    const fresh = (await messages()).filter((m) => m.payload.rev > r0);
    expect(fresh.map((m) => m.payload.rev)).toEqual([r0 + 1, r0 + 2]);
  });
});

// ---------------------------------------------------------------------
// 5. snapshot interleaving
// ---------------------------------------------------------------------

describe("5. the snapshot builder is one consistent snapshot", () => {
  it("a commit landing mid-build is entirely absent from that build and entirely present in the next", async () => {
    const [target] = await activeItems();
    const before = await buildEventSnapshot(eventId, "ja");

    const established = barrier();
    const resume = barrier();
    __setSnapshotEstablishedHookForTests(async (id) => {
      if (id !== eventId) return;
      established.open();
      await resume.opened;
    });
    const midBuild = buildEventSnapshot(eventId, "ja");
    await established.opened;

    // Another connection commits a change touching every slice the
    // snapshot carries: a new item, a reaction, a wish, and the event
    // row's revision.
    let committedRev = BigInt(0);
    await prisma.$transaction(async (tx) => {
      await lockEvent(tx, eventId);
      await tx.setlistItem.create({
        data: { eventId, position: 99, type: "mc", status: "confirmed" },
      });
      await tx.setlistItemReaction.create({
        data: { setlistItemId: BigInt(target.id), eventId, reactionType: "moved" },
      });
      await tx.songWish.create({ data: { eventId, songId: songB } });
      committedRev = await bumpSetlistRevisionAndBroadcast(tx, eventId);
    });

    resume.open();
    const old = await midBuild;
    __setSnapshotEstablishedHookForTests(null);
    const next = await buildEventSnapshot(eventId, "ja");

    // Entirely old.
    expect(old.rev).toBe(before.rev);
    expect(old.items.map((i) => i.id)).toEqual(before.items.map((i) => i.id));
    expect(old.reactionCounts).toEqual(before.reactionCounts);
    expect(old.top3Wishes).toEqual(before.top3Wishes);
    expect(old.capturedAt.getTime()).toBeGreaterThan(before.capturedAt.getTime());

    // Entirely new.
    expect(next.rev).toBe(committedRev);
    expect(next.items).toHaveLength(before.items.length + 1);
    expect(next.items.some((i) => i.position === 99)).toBe(true);
    expect(next.reactionCounts[target.id]?.moved ?? 0).toBe(
      (before.reactionCounts[target.id]?.moved ?? 0) + 1,
    );
    expect(next.top3Wishes.some((w) => BigInt(w.song.id) === songB)).toBe(true);
  });
});

// ---------------------------------------------------------------------
// 6. reaction ack watermark
// ---------------------------------------------------------------------

describe("6. reaction ack watermark vs snapshot capturedAt", () => {
  async function ackNow(): Promise<Date> {
    const r = await prisma.$queryRaw<{ ackAt: Date }[]>`SELECT clock_timestamp() AS "ackAt"`;
    return r[0].ackAt;
  }
  const countFor = (s: { reactionCounts: Record<string, Record<string, number>> }, id: string) =>
    s.reactionCounts[id]?.surprise ?? 0;

  it("insert: a snapshot taken while the write is open cannot release the ack; a later one can", async () => {
    const [item] = await activeItems();
    const base = countFor(await buildEventSnapshot(eventId, "ja"), item.id);
    const written = barrier();
    const commit = barrier();
    const writer = prisma.$transaction(async (tx) => {
      const r = await tx.setlistItemReaction.create({
        data: { setlistItemId: BigInt(item.id), eventId, reactionType: "surprise" },
        select: { id: true },
      });
      written.open();
      await commit.opened;
      return r.id;
    });
    await written.opened;
    const preCommit = await buildEventSnapshot(eventId, "ja");
    commit.open();
    const reactionId = await writer;
    const ackAt = await ackNow();
    const later = await buildEventSnapshot(eventId, "ja");

    expect(countFor(preCommit, item.id)).toBe(base);
    expect(preCommit.capturedAt.getTime()).toBeLessThan(ackAt.getTime());
    expect(later.capturedAt.getTime()).toBeGreaterThan(ackAt.getTime());
    expect(countFor(later, item.id)).toBe(base + 1);

    // delete, held open the same way
    const deleted = barrier();
    const commitDelete = barrier();
    const deleter = prisma.$transaction(async (tx) => {
      await tx.setlistItemReaction.delete({ where: { id: reactionId } });
      deleted.open();
      await commitDelete.opened;
    });
    await deleted.opened;
    const preDelete = await buildEventSnapshot(eventId, "ja");
    commitDelete.open();
    await deleter;
    const deleteAck = await ackNow();
    const afterDelete = await buildEventSnapshot(eventId, "ja");

    expect(countFor(preDelete, item.id)).toBe(base + 1);
    expect(preDelete.capturedAt.getTime()).toBeLessThan(deleteAck.getTime());
    expect(afterDelete.capturedAt.getTime()).toBeGreaterThan(deleteAck.getTime());
    expect(countFor(afterDelete, item.id)).toBe(base);
  });

  it("the route's ackAt (POST / DELETE) precedes any snapshot that includes the write", async () => {
    const [item] = await activeItems();
    const posted = await REACTION_POST(
      req("http://x/api/reactions", { setlistItemId: item.id, reactionType: "waiting" }),
    );
    const { reactionId, ackAt, counts } = await posted.json();
    expect(counts.waiting).toBeGreaterThanOrEqual(1);
    const snap = await buildEventSnapshot(eventId, "ja");
    expect(snap.capturedAt.getTime()).toBeGreaterThan(new Date(ackAt).getTime());
    expect(snap.reactionCounts[item.id]?.waiting).toBe(counts.waiting);

    const del = await REACTION_DELETE(req("http://x/api/reactions", { reactionId }, "DELETE"));
    const delBody = await del.json();
    expect(delBody.ok).toBe(true);
    expect(delBody.counts.waiting ?? 0).toBe(counts.waiting - 1);
    const snap2 = await buildEventSnapshot(eventId, "ja");
    expect(snap2.capturedAt.getTime()).toBeGreaterThan(new Date(delBody.ackAt).getTime());
  });
});

// ---------------------------------------------------------------------
// 7. the repair check's bounded revision read
// ---------------------------------------------------------------------

describe("7. bounded revision read (repair check)", () => {
  it("reads the event's revision through the pooler, null for a missing event", async () => {
    expect(await readRevisionBounded(eventId)).toBe(BigInt(await currentRev()));
    expect(await readRevisionBounded(BigInt("9007199254740991"))).toBeNull();
  });

  it("its statement_timeout is transaction-local and never leaks to the pooled connection", async () => {
    await readRevisionBounded(eventId);
    // Both of the instance's pool slots, concurrently.
    const settings = await Promise.all(
      [0, 1].map(() =>
        prisma.$queryRaw<{ v: string }[]>`SELECT current_setting('statement_timeout') AS v`,
      ),
    );
    for (const [row] of settings) expect(row.v).not.toBe("500ms");
  });
});

// ---------------------------------------------------------------------
// 8. live writer on an exhausted pool
// ---------------------------------------------------------------------

describe("8. a live writer that cannot get a connection answers 503 and writes nothing", () => {
  it("both pool slots held → admin create fails after maxWait with the operator 503, revision unchanged", async () => {
    const revBefore = await currentRev();
    const release = barrier();
    const held = [barrier(), barrier()];
    // Occupy the instance's two pool connections with idle transactions.
    const holders = held.map((h) =>
      prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1`;
          h.open();
          await release.opened;
        },
        { maxWait: 5_000, timeout: 30_000 },
      ),
    );
    await Promise.all(held.map((h) => h.opened));

    const started = Date.now();
    const res = await ADMIN_CREATE(
      req("http://x/api/admin/setlist-items", {
        eventId: eventId.toString(),
        position: 77,
        type: "mc",
      }),
    );
    const elapsed = Date.now() - started;
    release.open();
    await Promise.all(holders);

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("2");
    expect((await res.json()).code).toBe("db_busy");
    // maxWait (2 s) fired, well before the pool's own 5 s connect timeout.
    expect(elapsed).toBeGreaterThanOrEqual(1_900);
    expect(elapsed).toBeLessThan(4_500);
    expect(await currentRev()).toBe(revBefore);
    expect(
      await prisma.setlistItem.count({ where: { eventId, position: 77 } }),
    ).toBe(0);
  });
});
