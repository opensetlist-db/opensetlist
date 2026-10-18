import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { devPgClient, utcParam } from "./devPg";

// Fan board pick writes (n15-03) against the DEV database: the things
// only real rows and a real advisory lock can prove — the cap holds
// under 20 concurrent creates, the unique (event, anon, song) and the
// idempotent retry, the group-conflict answer, the start-time lock at
// ±1 s, the kill switch, and "mine" ownership isolation.
//
// Fixtures are throwaway and created here: one root group artist (slug
// `boardpick-itest-<ts>`), five base songs credited to it, one song of
// a second throwaway artist (outside the group), a single-artist
// EventSeries whose artist is the group (so the board has exactly that
// one group), and one board-enabled Event starting tomorrow. afterAll
// hard-deletes all of it. Nothing touches an existing event.
//
// The data cache is a pass-through (no Next request scope here, as in
// the other suites), and every revalidate helper is a spy that must
// never be called.

vi.mock("@/lib/dataCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dataCache")>()),
  cachedQuery:
    <A extends unknown[], R>(_name: string, fn: (...args: A) => Promise<R>) =>
    (...args: A) =>
      fn(...args),
  revalidateEventData: vi.fn(),
  revalidatePublicData: vi.fn(),
  revalidateEventImpressions: vi.fn(),
  revalidateBoardControl: vi.fn(),
  revalidateBoardAggregate: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import * as dataCache from "@/lib/dataCache";
import { POST } from "@/app/api/events/[id]/board/picks/route";
import { DELETE } from "@/app/api/events/[id]/board/picks/[pickId]/route";
import { GET as MINE } from "@/app/api/events/[id]/board/mine/route";
import { ANON_TOKEN_HEADER } from "@/lib/anonId";

const TAG = `boardpick-itest-${Date.now()}`;
const pg = devPgClient();

let groupId: bigint;
let otherArtistId: bigint;
let seriesId: bigint;
let eventId: bigint;
let songIds: bigint[] = [];
let foreignSongId: bigint;

const ANON_A = `itest-a-${Date.now()}`;
const ANON_B = `itest-b-${Date.now()}`;

function postPick(anonId: string, songId: bigint, group = groupId) {
  return POST(
    new Request(`http://x/api/events/${eventId}/board/picks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        anonId,
        groupId: group.toString(),
        songId: songId.toString(),
      }),
    }),
    { params: Promise.resolve({ id: eventId.toString() }) },
  );
}

function deletePick(anonId: string, pickId: string) {
  return DELETE(
    new Request(`http://x/api/events/${eventId}/board/picks/${pickId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anonId }),
    }),
    { params: Promise.resolve({ id: eventId.toString(), pickId }) },
  );
}

function mine(anonId: string) {
  return MINE(
    new Request(`http://x/api/events/${eventId}/board/mine?locale=ko`, {
      headers: { [ANON_TOKEN_HEADER]: anonId },
    }),
    { params: Promise.resolve({ id: eventId.toString() }) },
  );
}

async function rowCount(anonId: string): Promise<number> {
  const r = await pg.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM "BoardPick" WHERE "eventId" = $1 AND "anonId" = $2`,
    [eventId.toString(), anonId],
  );
  return Number(r.rows[0].n);
}

async function setStart(startTime: Date) {
  await pg.query(`UPDATE "Event" SET "startTime" = $2 WHERE id = $1`, [
    eventId.toString(),
    utcParam(startTime),
  ]);
}

beforeAll(async () => {
  await pg.connect();
  const group = await prisma.artist.create({
    data: { slug: TAG, type: "group", originalName: `${TAG} group` },
    select: { id: true },
  });
  groupId = group.id;
  const other = await prisma.artist.create({
    data: { slug: `${TAG}-other`, type: "group", originalName: `${TAG} other` },
    select: { id: true },
  });
  otherArtistId = other.id;
  songIds = [];
  for (let i = 0; i < 5; i++) {
    const s = await prisma.song.create({
      data: {
        slug: `${TAG}-song-${i}`,
        originalTitle: `${TAG} song ${i}`,
        artists: { create: { artistId: groupId } },
      },
      select: { id: true },
    });
    songIds.push(s.id);
  }
  const foreign = await prisma.song.create({
    data: {
      slug: `${TAG}-foreign`,
      originalTitle: `${TAG} foreign`,
      artists: { create: { artistId: otherArtistId } },
    },
    select: { id: true },
  });
  foreignSongId = foreign.id;
  const series = await prisma.eventSeries.create({
    data: {
      slug: `${TAG}-series`,
      type: "standalone",
      originalName: `${TAG} series`,
      artistId: groupId,
    },
    select: { id: true },
  });
  seriesId = series.id;
  const ev = await prisma.event.create({
    data: {
      slug: `${TAG}-event`,
      type: "concert",
      status: "scheduled",
      startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      originalName: "board picks integration test (throwaway)",
      eventSeriesId: seriesId,
      boardEnabled: true,
    },
    select: { id: true },
  });
  eventId = ev.id;
});

afterAll(async () => {
  await pg.query("BEGIN");
  if (eventId !== undefined) {
    await pg.query(`DELETE FROM "BoardPick" WHERE "eventId" = $1`, [eventId.toString()]);
    await pg.query(`DELETE FROM "Event" WHERE id = $1`, [eventId.toString()]);
  }
  if (seriesId !== undefined) {
    await pg.query(`DELETE FROM "EventSeries" WHERE id = $1`, [seriesId.toString()]);
  }
  const allSongs = [...songIds, ...(foreignSongId ? [foreignSongId] : [])].map(String);
  if (allSongs.length > 0) {
    await pg.query(`DELETE FROM "SongArtist" WHERE "songId" = ANY($1::bigint[])`, [allSongs]);
    await pg.query(`DELETE FROM "Song" WHERE id = ANY($1::bigint[])`, [allSongs]);
  }
  const artists = [groupId, otherArtistId].filter((x) => x !== undefined).map(String);
  if (artists.length > 0) {
    await pg.query(`DELETE FROM "Artist" WHERE id = ANY($1::bigint[])`, [artists]);
  }
  await pg.query("COMMIT");
  await pg.end();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await pg.query(`DELETE FROM "BoardPick" WHERE "eventId" = $1`, [eventId.toString()]);
  await pg.query(
    `UPDATE "Event" SET "boardEnabled" = true, "startTime" = $2 WHERE id = $1`,
    [eventId.toString(), utcParam(new Date(Date.now() + 24 * 60 * 60 * 1000))],
  );
  await pg.query(`UPDATE "Song" SET "isDeleted" = false WHERE id = $1`, [
    songIds[0].toString(),
  ]);
});

describe("board picks — dev database", () => {
  it("cap: 3 picks per group, the 4th → 409 cap_reached", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await postPick(ANON_A, songIds[i])).status).toBe(201);
    }
    const fourth = await postPick(ANON_A, songIds[3]);
    expect(fourth.status).toBe(409);
    expect(await fourth.json()).toEqual({ error: "cap_reached" });
    expect(await rowCount(ANON_A)).toBe(3);
  });

  it("20 concurrent creates for one anon end with exactly 3 rows", async () => {
    // 20 requests over 5 distinct songs: every song is requested four
    // times, so the lock has to serialize both the cap and the
    // duplicate check.
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => postPick(ANON_A, songIds[i % 5])),
    );
    const statuses = results.map((r) => r.status);
    console.log("[board-picks itest] concurrent statuses", statuses.join(","));
    // 201 created, 200 exact retry of a song that already won, 409 cap,
    // 503 busy: one test process has a 2-connection pool (as each
    // Vercel instance does), so some of 20 simultaneous requests time
    // out waiting for a connection BEFORE their transaction starts —
    // nothing written, the documented retry-safe answer. Never a 500,
    // never a unique violation leaking out.
    for (const s of statuses) expect([200, 201, 409, 503]).toContain(s);
    const created = statuses.filter((s) => s === 201).length;
    const rows = await rowCount(ANON_A);
    expect(rows).toBe(created);
    expect(rows).toBeLessThanOrEqual(3);
    // The cap must actually have been contended, not dodged by 503s:
    // at least one request beyond the third was refused by it.
    expect(rows).toBe(3);
    expect(statuses.filter((s) => s === 409).length).toBeGreaterThan(0);
  });

  it("idempotent re-add → 200 with the same id", async () => {
    const first = await postPick(ANON_A, songIds[0]);
    expect(first.status).toBe(201);
    const { id } = await first.json();
    const again = await postPick(ANON_A, songIds[0]);
    expect(again.status).toBe(200);
    expect((await again.json()).id).toBe(id);
    expect(await rowCount(ANON_A)).toBe(1);
  });

  it("re-creating (anon, song) under another group → 409 group_conflict", async () => {
    // The only other group this single-artist board could name is not
    // on it, so drive the conflict straight through the unique key:
    // plant a row under a different group id, then add under the board
    // group.
    await pg.query(
      `INSERT INTO "BoardPick" (id, "eventId", "groupArtistId", "songId", "anonId")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4)`,
      [eventId.toString(), otherArtistId.toString(), songIds[0].toString(), ANON_A],
    );
    const res = await postPick(ANON_A, songIds[0]);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "group_conflict" });
  });

  it("a song outside the group's catalog → 400; a group not on the board → 400", async () => {
    let res = await postPick(ANON_A, foreignSongId);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "song_outside_group" });
    res = await postPick(ANON_A, foreignSongId, otherArtistId);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_group" });
  });

  it("lock boundary: open before the start, refused 1 s after (UTC instants)", async () => {
    // Real clock against the stored UTC start. "Before" needs headroom
    // for the request's own round trips to the pooler (a create is ~10
    // of them, seconds from a far-away laptop); the exact ±1 s instants
    // are covered with a frozen clock in the unit suite.
    await setStart(new Date(Date.now() + 30_000));
    expect((await postPick(ANON_A, songIds[0])).status).toBe(201);
    await setStart(new Date(Date.now() - 1000));
    const res = await postPick(ANON_A, songIds[1]);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "board_locked" });
  });

  it("disabled board → 403 for create and delete", async () => {
    const created = await postPick(ANON_A, songIds[0]);
    const { id } = await created.json();
    await pg.query(`UPDATE "Event" SET "boardEnabled" = false WHERE id = $1`, [
      eventId.toString(),
    ]);
    let res = await postPick(ANON_A, songIds[1]);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "board_disabled" });
    res = await deletePick(ANON_A, id);
    expect(res.status).toBe(403);
    expect(await rowCount(ANON_A)).toBe(1);
  });

  it("delete: own pick removed; another anon's → 403; soft-deleted song still removable and still holds its slot", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await (await postPick(ANON_A, songIds[i])).json()).id);
    }
    await pg.query(`UPDATE "Song" SET "isDeleted" = true WHERE id = $1`, [
      songIds[0].toString(),
    ]);
    // The soft-deleted song's pick still counts toward the cap.
    expect((await postPick(ANON_A, songIds[3])).status).toBe(409);

    const foreign = await deletePick(ANON_B, ids[0]);
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ error: "not_owner" });

    const own = await deletePick(ANON_A, ids[0]);
    expect(own.status).toBe(200);
    expect(await rowCount(ANON_A)).toBe(2);
    const again = await deletePick(ANON_A, ids[0]);
    expect(again.status).toBe(404);
  });

  it("mine: only the caller's picks, private no-store; missing id → 400", async () => {
    await postPick(ANON_A, songIds[0]);
    await postPick(ANON_B, songIds[1]);
    const a = await mine(ANON_A);
    expect(a.status).toBe(200);
    expect(a.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await a.json();
    expect(body.picks).toHaveLength(1);
    expect(body.picks[0]).toMatchObject({
      groupId: groupId.toString(),
      songId: songIds[0].toString(),
      available: true,
    });
    expect(JSON.stringify(body)).not.toContain(ANON_B);

    const missing = await MINE(
      new Request(`http://x/api/events/${eventId}/board/mine`),
      { params: Promise.resolve({ id: eventId.toString() }) },
    );
    expect(missing.status).toBe(400);
  });

  it("no write ever calls a revalidate helper", async () => {
    const { id } = await (await postPick(ANON_A, songIds[0])).json();
    await postPick(ANON_A, songIds[0]);
    await deletePick(ANON_A, id);
    for (const f of [
      dataCache.revalidatePublicData,
      dataCache.revalidateEventData,
      dataCache.revalidateEventImpressions,
      dataCache.revalidateBoardControl,
      dataCache.revalidateBoardAggregate,
    ]) {
      expect(vi.mocked(f)).not.toHaveBeenCalled();
    }
  });
});
