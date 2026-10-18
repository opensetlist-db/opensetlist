import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "pg";

// Per-group wishes on a board-enabled event (n15-08) against the DEV
// database: what only real rows, the real advisory lock and the real
// unique (eventId, anonId, songId) can prove — the cap under 20
// concurrent creates, the idempotent retry, legacy rows (anonId NULL)
// coexisting with the new unique and staying removable without being
// claimed, legacy rows counting as submissions (never participants) in
// the board's want column, and the overall wish TOP3 loader — the one
// embedded in the live payload — reporting every row exactly as before.
//
// Fixtures follow `board-picks.test.ts`: a throwaway root group with
// five base songs and one variant, a foreign artist's song, a
// single-artist series, and one board-enabled event starting tomorrow.
// afterAll hard-deletes all of it.

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
import { POST } from "@/app/api/events/[id]/wishes/route";
import { DELETE } from "@/app/api/events/[id]/wishes/[wishId]/route";
import { GET as MINE } from "@/app/api/events/[id]/board/mine/route";
import { GET as BOARD } from "@/app/api/events/[id]/board/route";
import { ANON_TOKEN_HEADER } from "@/lib/anonId";
import { fetchEventWishlistTop3 } from "@/lib/wishes/top3";

const TAG = `boardwish-itest-${Date.now()}`;
const pg = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });

let groupId: bigint;
let otherArtistId: bigint;
let seriesId: bigint;
let eventId: bigint;
let songIds: bigint[] = [];
let variantId: bigint;
let foreignSongId: bigint;

const ANON_A = `itest-wa-${Date.now()}`;
const ANON_B = `itest-wb-${Date.now()}`;

const params = () => ({ params: Promise.resolve({ id: eventId.toString() }) });

function postWish(anonId: string, songId: bigint, group = groupId) {
  return POST(
    new Request(`http://x/api/events/${eventId}/wishes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        anonId,
        groupId: group.toString(),
        songId: songId.toString(),
      }),
    }) as never,
    params(),
  );
}

function deleteWish(wishId: string, body?: unknown) {
  return DELETE(
    new Request(`http://x/api/events/${eventId}/wishes/${wishId}`, {
      method: "DELETE",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    }),
    { params: Promise.resolve({ id: eventId.toString(), wishId }) },
  );
}

async function insertLegacy(songId: bigint): Promise<string> {
  const r = await pg.query<{ id: string }>(
    `INSERT INTO "SongWish" (id, "eventId", "songId")
     VALUES (gen_random_uuid()::text, $1, $2) RETURNING id`,
    [eventId.toString(), songId.toString()],
  );
  return r.rows[0].id;
}

async function rows(anonId: string | null) {
  const r = await pg.query<{ n: string }>(
    anonId === null
      ? `SELECT count(*)::text AS n FROM "SongWish" WHERE "eventId" = $1 AND "anonId" IS NULL`
      : `SELECT count(*)::text AS n FROM "SongWish" WHERE "eventId" = $1 AND "anonId" = $2`,
    anonId === null ? [eventId.toString()] : [eventId.toString(), anonId],
  );
  return Number(r.rows[0].n);
}

const utc = (d: Date) => d.toISOString();

beforeAll(async () => {
  await pg.connect();
  groupId = (
    await prisma.artist.create({
      data: { slug: TAG, type: "group", originalName: `${TAG} group` },
      select: { id: true },
    })
  ).id;
  otherArtistId = (
    await prisma.artist.create({
      data: { slug: `${TAG}-other`, type: "group", originalName: `${TAG} other` },
      select: { id: true },
    })
  ).id;
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
  variantId = (
    await prisma.song.create({
      data: {
        slug: `${TAG}-song-0-var`,
        originalTitle: `${TAG} song 0`,
        variantLabel: "itest Ver.",
        baseVersionId: songIds[0],
        artists: { create: { artistId: groupId } },
      },
      select: { id: true },
    })
  ).id;
  foreignSongId = (
    await prisma.song.create({
      data: {
        slug: `${TAG}-foreign`,
        originalTitle: `${TAG} foreign`,
        artists: { create: { artistId: otherArtistId } },
      },
      select: { id: true },
    })
  ).id;
  seriesId = (
    await prisma.eventSeries.create({
      data: {
        slug: `${TAG}-series`,
        type: "standalone",
        originalName: `${TAG} series`,
        artistId: groupId,
      },
      select: { id: true },
    })
  ).id;
  eventId = (
    await prisma.event.create({
      data: {
        slug: `${TAG}-event`,
        type: "concert",
        status: "scheduled",
        startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        originalName: "board wishes integration test (throwaway)",
        eventSeriesId: seriesId,
        boardEnabled: true,
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await pg.query("BEGIN");
  if (eventId !== undefined) {
    await pg.query(`DELETE FROM "SongWish" WHERE "eventId" = $1`, [eventId.toString()]);
    await pg.query(`DELETE FROM "Event" WHERE id = $1`, [eventId.toString()]);
  }
  if (seriesId !== undefined) {
    await pg.query(`DELETE FROM "EventSeries" WHERE id = $1`, [seriesId.toString()]);
  }
  const allSongs = [
    ...(variantId ? [variantId] : []),
    ...songIds,
    ...(foreignSongId ? [foreignSongId] : []),
  ].map(String);
  if (allSongs.length > 0) {
    await pg.query(`DELETE FROM "SongArtist" WHERE "songId" = ANY($1::bigint[])`, [allSongs]);
    // Variant first: it references its base.
    await pg.query(`DELETE FROM "Song" WHERE "baseVersionId" IS NOT NULL AND id = ANY($1::bigint[])`, [allSongs]);
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
  await pg.query(`DELETE FROM "SongWish" WHERE "eventId" = $1`, [eventId.toString()]);
  await pg.query(
    `UPDATE "Event" SET "boardEnabled" = true, "startTime" = $2 WHERE id = $1`,
    [eventId.toString(), utc(new Date(Date.now() + 24 * 60 * 60 * 1000))],
  );
});

describe("per-group wishes — dev database", () => {
  it("cap: 3 wishes per group, the 4th → 409; legacy rows never fill a slot", async () => {
    // Two legacy rows — one of them the very song A adds next: the
    // unique (event, anon, song) must not collide with a NULL anon.
    await insertLegacy(songIds[0]);
    await insertLegacy(songIds[0]);
    for (let i = 0; i < 3; i++) {
      expect((await postWish(ANON_A, songIds[i])).status).toBe(201);
    }
    const fourth = await postWish(ANON_A, songIds[3]);
    expect(fourth.status).toBe(409);
    expect(await fourth.json()).toEqual({ error: "cap_reached" });
    expect(await rows(ANON_A)).toBe(3);
    expect(await rows(null)).toBe(2);
  });

  it("20 concurrent creates for one anon end with exactly 3 rows", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => postWish(ANON_A, songIds[i % 5])),
    );
    const statuses = results.map((r) => r.status);
    console.log("[board-wishes itest] concurrent statuses", statuses.join(","));
    for (const s of statuses) expect([200, 201, 409, 503]).toContain(s);
    expect(await rows(ANON_A)).toBe(statuses.filter((s) => s === 201).length);
    expect(await rows(ANON_A)).toBe(3);
    expect(statuses.filter((s) => s === 409).length).toBeGreaterThan(0);
  });

  it("idempotent re-add → 200 with the same id", async () => {
    const { id } = await (await postWish(ANON_A, songIds[0])).json();
    const again = await postWish(ANON_A, songIds[0]);
    expect(again.status).toBe(200);
    expect((await again.json()).id).toBe(id);
    expect(await rows(ANON_A)).toBe(1);
  });

  it("an old client's body on a board event → 400, nothing written", async () => {
    const res = await POST(
      new Request(`http://x/api/events/${eventId}/wishes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songId: Number(songIds[0]) }),
      }) as never,
      params(),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_anon_id" });
    expect(await rows(null)).toBe(0);
  });

  it("a song outside the group's catalog → 400", async () => {
    const res = await postWish(ANON_A, foreignSongId);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "song_outside_group" });
  });

  it("lock: refused 1 s after the start (UTC)", async () => {
    await pg.query(`UPDATE "Event" SET "startTime" = $2 WHERE id = $1`, [
      eventId.toString(),
      utc(new Date(Date.now() - 1000)),
    ]);
    const res = await postWish(ANON_A, songIds[0]);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "board_locked" });
  });

  it("delete: own → 200; another anon's → 403; legacy removable with or without anon, never claimed", async () => {
    const own = (await (await postWish(ANON_A, songIds[0])).json()).id;
    expect((await deleteWish(own, { anonId: ANON_B })).status).toBe(403);
    expect((await deleteWish(own)).status).toBe(403);
    expect((await deleteWish(own, { anonId: ANON_A })).status).toBe(200);
    expect((await deleteWish(own, { anonId: ANON_A })).status).toBe(404);

    const legacy1 = await insertLegacy(songIds[1]);
    const legacy2 = await insertLegacy(songIds[2]);
    expect((await deleteWish(legacy1, { anonId: ANON_B })).status).toBe(200);
    expect((await deleteWish(legacy2)).status).toBe(200);
    expect(await rows(null)).toBe(0);
    // Removing them adopted nothing into B's ballot.
    expect(await rows(ANON_B)).toBe(0);
  });

  it("mine: only the caller's grouped wishes — legacy rows are never handed out", async () => {
    await insertLegacy(songIds[3]);
    await postWish(ANON_A, songIds[0]);
    await postWish(ANON_B, songIds[1]);
    const res = await MINE(
      new Request(`http://x/api/events/${eventId}/board/mine?locale=ko`, {
        headers: { [ANON_TOKEN_HEADER]: ANON_A },
      }),
      params(),
    );
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.wishes).toHaveLength(1);
    expect(body.wishes[0]).toMatchObject({
      groupId: groupId.toString(),
      songId: songIds[0].toString(),
      available: true,
    });
  });

  it("want column: legacy rows are submissions, never participants; a legacy variant folds onto its base", async () => {
    // A: songs 0, 1 · B: song 0 · legacy: song 0's VARIANT ×1, song 2 ×1
    // → song0 ×3, song1 ×1, song2 ×1; 5 submissions, 2 participants.
    for (const i of [0, 1]) expect((await postWish(ANON_A, songIds[i])).status).toBe(201);
    expect((await postWish(ANON_B, songIds[0])).status).toBe(201);
    await insertLegacy(variantId);
    await insertLegacy(songIds[2]);

    const res = await BOARD(
      new Request(`http://x/api/events/${eventId}/board?locale=ko`),
      params(),
    );
    const body = await res.json();
    expect(body.groups[0].wishes).toMatchObject({
      submissions: 5,
      participants: 2,
      label: "early",
    });
    expect(body.groups[0].wishes.top[0]).toMatchObject({
      songId: songIds[0].toString(),
      count: 3,
      available: true,
    });
    expect(JSON.stringify(body)).not.toMatch(/itest-w[ab]-/);
  });

  it("the overall wish TOP3 (live payload loader) counts every row, legacy and grouped alike", async () => {
    await postWish(ANON_A, songIds[0]);
    await postWish(ANON_B, songIds[0]);
    await insertLegacy(songIds[0]);
    await insertLegacy(variantId);
    await postWish(ANON_A, songIds[1]);
    const top3 = await fetchEventWishlistTop3(eventId, "ko");
    // Same rule as before n15-08: group by the stored song id, no
    // grouping, no folding — the variant stays its own entry.
    expect(top3.map((e) => [String(e.song.id), e.count])).toEqual([
      [songIds[0].toString(), 3],
      [songIds[1].toString(), 1],
      [variantId.toString(), 1],
    ]);
  });

  it("disabled board → wishes fall back to the legacy contract", async () => {
    await pg.query(`UPDATE "Event" SET "boardEnabled" = false WHERE id = $1`, [
      eventId.toString(),
    ]);
    const res = await POST(
      new Request(`http://x/api/events/${eventId}/wishes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songId: Number(songIds[0]) }),
      }) as never,
      params(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["id", "songId"]);
    expect(await rows(null)).toBe(1);
  });

  it("no write ever calls a revalidate helper", async () => {
    const { id } = await (await postWish(ANON_A, songIds[0])).json();
    await postWish(ANON_A, songIds[0]);
    await deleteWish(id, { anonId: ANON_A });
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
