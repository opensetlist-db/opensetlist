import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Official member order (`StageIdentity.sortOrder`) — integration test
// against the DEV database.
//
// What only a real database can prove: Prisma 7 with `relationJoins`
// accepts the relation orderBy with `nulls: "last"` inside a nested
// include / select (the artist page's `stageLinks`, the performers
// API's `performers`), and Postgres returns numbered members first by
// number, then the unnumbered ones by creation order.
//
// Everything runs on throwaway rows created here (slugs
// `memberorder-itest-<ts>-*`) and hard-deleted in afterAll.

vi.mock("@/lib/dataCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dataCache")>()),
  cachedQuery:
    <A extends unknown[], R>(_name: string, fn: (...args: A) => Promise<R>) =>
    (...args: A) =>
      fn(...args),
}));

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { byStageIdentityOrderBy } from "@/lib/memberOrder";
import { fetchEventRoster } from "@/lib/eventRoster";
import { GET as PERFORMERS_GET } from "@/app/api/events/[id]/performers/route";

const TAG = `memberorder-itest-${Date.now()}`;
let artistId: bigint | undefined;
let eventId: bigint | undefined;
const siIds: string[] = [];

// Created in this order (createdAt ascending). Expected official order:
// the two numbered members by number, then the unnumbered two by
// creation order → C (1), A (2), B (null, older), D (null, newer).
const MEMBERS = [
  { key: "A", sortOrder: 2 },
  { key: "B", sortOrder: null },
  { key: "C", sortOrder: 1 },
  { key: "D", sortOrder: null },
] as const;
const EXPECTED = ["C", "A", "B", "D"];

beforeAll(async () => {
  const artist = await prisma.artist.create({
    data: { slug: `${TAG}-artist`, type: "group", originalName: `${TAG} artist` },
    select: { id: true },
  });
  artistId = artist.id;
  const event = await prisma.event.create({
    data: {
      slug: `${TAG}-event`,
      type: "concert",
      status: "scheduled",
      startTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      originalName: `${TAG} event (throwaway)`,
    },
    select: { id: true },
  });
  eventId = event.id;
  const t0 = Date.now() - 60_000;
  for (const [i, m] of MEMBERS.entries()) {
    const si = await prisma.stageIdentity.create({
      data: {
        slug: `${TAG}-${m.key}`,
        type: "character",
        originalName: m.key,
        sortOrder: m.sortOrder,
        // Explicit, spaced timestamps so the createdAt fallback is
        // deterministic regardless of insert latency.
        createdAt: new Date(t0 + i * 1000),
        artistLinks: { create: { artistId: artist.id } },
        eventPerformers: { create: { eventId: event.id } },
      },
      select: { id: true },
    });
    siIds.push(si.id);
  }
});

afterAll(async () => {
  if (siIds.length > 0) {
    await prisma.eventPerformer.deleteMany({ where: { stageIdentityId: { in: siIds } } });
    await prisma.stageIdentityArtist.deleteMany({ where: { stageIdentityId: { in: siIds } } });
    await prisma.stageIdentity.deleteMany({ where: { id: { in: siIds } } });
  }
  if (eventId !== undefined) await prisma.event.delete({ where: { id: eventId } });
  if (artistId !== undefined) await prisma.artist.delete({ where: { id: artistId } });
});

describe("official member order on the dev database", () => {
  it("event roster (pre-show lineup source)", async () => {
    const roster = await fetchEventRoster(eventId!, "ko");
    expect(roster.map((r) => r.stageIdentity.originalName)).toEqual(EXPECTED);
  });

  it("GET /api/events/[id]/performers (performer checklists)", async () => {
    const res = await PERFORMERS_GET({} as NextRequest, {
      params: Promise.resolve({ id: eventId!.toString() }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { performers: { originalName: string }[] };
    expect(body.performers.map((p) => p.originalName)).toEqual(EXPECTED);
  });

  it("artist stageLinks include (artist page / admin artist form)", async () => {
    const artist = await prisma.artist.findFirst({
      where: { id: artistId! },
      include: {
        stageLinks: {
          orderBy: byStageIdentityOrderBy(),
          include: { stageIdentity: { include: { translations: true } } },
        },
      },
    });
    expect(artist?.stageLinks.map((sl) => sl.stageIdentity.originalName)).toEqual(EXPECTED);
  });
});
