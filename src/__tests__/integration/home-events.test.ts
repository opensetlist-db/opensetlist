import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { loadHomeData } from "@/lib/homeEvents";
import { buildLogoSeriesGraph } from "@/lib/logoResolution";

// Home eligibility (ticket 15) against the DEV database: the predicates
// only real SQL can prove — the song-bearing filter (not deleted, type
// song, a linked song), cancelled/deleted exclusion, the future-dated
// `completed` anomaly, the 12h ongoing buffer, the uncapped-horizon
// upcoming take(5), and the recent → archive fallback.
//
// Isolation: every fixture is dated in 2099 and every query runs with a
// reference instant in 2099, so no real dev event falls inside the recent
// window or after `now`. Only the archive case can reach real rows, and
// it asserts just the head of the list (the fixtures are the newest
// past rows that exist). Fixture slugs start with `home-itest<ts>`;
// afterAll hard-deletes them and asserts nothing is left. No existing
// record is written.

const PREFIX = "home-itest";
const TOKEN = `${PREFIX}${Date.now()}`;
const NOW = new Date("2099-06-01T00:00:00Z");
const LATER = new Date("2099-12-01T00:00:00Z");
const created = { events: [] as bigint[], songs: [] as bigint[] };
const ids: Record<string, bigint> = {};

let songId: bigint;

async function event(
  key: string,
  startTime: string,
  over: { status?: "scheduled" | "ongoing" | "completed" | "cancelled"; isDeleted?: boolean } = {},
) {
  const row = await prisma.event.create({
    data: {
      slug: `${TOKEN}-${key}`,
      type: "concert",
      startTime: new Date(startTime),
      originalName: `${TOKEN} ${key}`,
      status: over.status ?? "scheduled",
      isDeleted: over.isDeleted ?? false,
    },
  });
  created.events.push(row.id);
  ids[key] = row.id;
  return row.id;
}

async function item(
  eventId: bigint,
  position: number,
  over: { type?: "song" | "mc"; isDeleted?: boolean; linked?: boolean } = {},
) {
  const row = await prisma.setlistItem.create({
    data: {
      eventId,
      position,
      type: over.type ?? "song",
      isDeleted: over.isDeleted ?? false,
    },
  });
  if (over.linked ?? true) {
    await prisma.setlistItemSong.create({
      data: { setlistItemId: row.id, songId, order: 1 },
    });
  }
}

// An interrupted run (Ctrl-C, hook timeout) skips afterAll and leaves its
// 2099 rows behind; the exact-list assertions below would then fail on
// every later run. Remove any earlier run's rows first — the prefix is
// this file's own, so nothing else matches it.
async function purge(prefix: string) {
  const events = await prisma.event.findMany({
    where: { slug: { startsWith: prefix } },
    select: { id: true },
  });
  const eventIds = events.map((e) => e.id);
  const items = await prisma.setlistItem.findMany({
    where: { eventId: { in: eventIds } },
    select: { id: true },
  });
  const itemIds = items.map((i) => i.id);
  await prisma.setlistItemSong.deleteMany({ where: { setlistItemId: { in: itemIds } } });
  await prisma.setlistItem.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.song.deleteMany({ where: { slug: { startsWith: prefix } } });
}

beforeAll(async () => {
  await purge(PREFIX);

  const song = await prisma.song.create({
    data: { slug: `${TOKEN}-song`, originalTitle: `${TOKEN} Song` },
  });
  songId = song.id;
  created.songs.push(songId);

  // Past window candidates (NOW − 30 days = 2099-05-02).
  await item(await event("recent-ok", "2099-05-25T09:00:00Z", { status: "completed" }), 1);
  await item(await event("recent-scheduled-ok", "2099-05-20T09:00:00Z"), 1);
  await item(await event("mc-only", "2099-05-26T09:00:00Z", { status: "completed" }), 1, {
    type: "mc",
    linked: false,
  });
  await item(await event("deleted-item", "2099-05-27T09:00:00Z", { status: "completed" }), 1, {
    isDeleted: true,
  });
  await item(await event("unlinked-song", "2099-05-27T10:00:00Z", { status: "completed" }), 1, {
    linked: false,
  });
  await item(await event("cancelled", "2099-05-28T09:00:00Z", { status: "cancelled" }), 1);
  await item(
    await event("deleted-event", "2099-05-29T09:00:00Z", { status: "completed", isDeleted: true }),
    1,
  );
  // A `completed` row dated in the future is a data anomaly: never past.
  await item(await event("future-completed", "2099-06-10T09:00:00Z", { status: "completed" }), 1);
  // Scheduled 6h before NOW: still inside the 12h ongoing buffer.
  await item(await event("buffer-ongoing", "2099-05-31T18:00:00Z"), 1);
  // Older than the window: only the archive may show it.
  await item(await event("old", "2099-03-01T09:00:00Z", { status: "completed" }), 1);

  // Upcoming: six scheduled, one beyond 30 days; cancelled/deleted extras.
  for (const [i, day] of ["06-05", "06-12", "06-19", "06-26", "08-01", "08-01"].entries()) {
    await event(`up-${i}`, `2099-${day}T09:00:00Z`);
  }
  await event("up-cancelled", "2099-06-03T09:00:00Z", { status: "cancelled" });
  await event("up-deleted", "2099-06-04T09:00:00Z", { isDeleted: true });
  await event("manual-ongoing", "2099-04-01T09:00:00Z", { status: "ongoing" });
  await event("manual-ongoing-tie", "2099-04-01T09:00:00Z", { status: "ongoing" });
});

afterAll(async () => {
  const items = await prisma.setlistItem.findMany({
    where: { eventId: { in: created.events } },
    select: { id: true },
  });
  const itemIds = items.map((i) => i.id);
  await prisma.setlistItemSong.deleteMany({ where: { setlistItemId: { in: itemIds } } });
  await prisma.setlistItem.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.event.deleteMany({ where: { id: { in: created.events } } });
  await prisma.song.deleteMany({ where: { id: { in: created.songs } } });
  const left = await Promise.all([
    prisma.event.count({ where: { slug: { startsWith: TOKEN } } }),
    prisma.song.count({ where: { slug: { startsWith: TOKEN } } }),
  ]);
  expect(left).toEqual([0, 0]);
});

const graph = buildLogoSeriesGraph([]);
const idsOf = (rows: { id: string }[]) => rows.map((r) => BigInt(r.id));

describe("home eligibility on the dev database", () => {
  it("recent past: song-bearing only, newest first, no older top-up", async () => {
    const data = await loadHomeData(NOW, graph);
    // Positive control: the fixtures are visible to the query at all.
    expect(idsOf(data.past)).toContain(ids["recent-ok"]);
    expect(data.pastMode).toBe("recent");
    expect(idsOf(data.past)).toEqual([ids["recent-ok"], ids["recent-scheduled-ok"]]);
    expect(data.past[0].songCount).toBe(1);
  });

  it("upcoming: nearest five with no 30-day horizon; cancelled and deleted excluded", async () => {
    const data = await loadHomeData(NOW, graph);
    expect(idsOf(data.upcoming)).toEqual([
      ids["up-0"],
      ids["up-1"],
      ids["up-2"],
      ids["up-3"],
      ids["up-4"], // 2099-08-01: beyond 30 days, still shown
    ]);
  });

  it("ongoing: manual ongoing and the 12h buffer, not counted as past", async () => {
    const data = await loadHomeData(NOW, graph);
    // Other manually ongoing dev records may be returned too. Only our
    // fixture rows have a controlled time, so assert their relative order.
    const fixtureRows = idsOf(data.ongoing).filter((id) => created.events.includes(id));
    expect(fixtureRows).toEqual([
      ids["manual-ongoing"],
      ids["manual-ongoing-tie"],
      ids["buffer-ongoing"],
    ]);
    expect(idsOf(data.past)).not.toContain(ids["buffer-ongoing"]);
  });

  it("archive: an empty recent window shows the latest song-bearing past overall", async () => {
    // At LATER the recent window (2099-11-01 → 12-01) holds no fixture.
    const data = await loadHomeData(LATER, graph);
    expect(data.pastMode).toBe("archive");
    // future-completed (06-10) is legitimately past by now; then the
    // buffer show (05-31, now completed by time), then 05-25, 05-20.
    expect(idsOf(data.past).slice(0, 4)).toEqual([
      ids["future-completed"],
      ids["buffer-ongoing"],
      ids["recent-ok"],
      ids["recent-scheduled-ok"],
    ]);
    expect(idsOf(data.past)).toHaveLength(5);
    expect(idsOf(data.past)[4]).toBe(ids["old"]);
  });
});
