import { beforeEach, describe, expect, it, vi } from "vitest";

// Home eligibility (ticket 15) at the query boundary, plus the home cache
// entry's logo contract with ticket 07. Prisma is stubbed per call so the
// tests pin the WHERE clauses each section sends and how the past
// section falls back; the real-DB behaviour of the same predicates is in
// integration/home-events.test.ts.

const store = new Map<string, { value: string; tags: string[] }>();
vi.mock("next/cache", () => ({
  unstable_cache:
    (cb: () => Promise<unknown>, keyParts: string[], options: { tags?: string[] }) =>
    async () => {
      const key = JSON.stringify(keyParts);
      const hit = store.get(key);
      if (hit) return JSON.parse(hit.value);
      const result = await cb();
      store.set(key, { value: JSON.stringify(result), tags: options.tags ?? [] });
      return result;
    },
  revalidateTag: (tag: string) => {
    for (const [key, entry] of store) if (entry.tags.includes(tag)) store.delete(key);
  },
}));
vi.mock("@vercel/functions", () => ({
  getCache: () => ({ expireTag: async () => {} }),
  waitUntil: () => {},
}));

type Where = Record<string, unknown>;
const eventFindMany = vi.fn();
const groupBy = vi.fn();
const seriesRows = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findMany: (args: unknown) => eventFindMany(args) },
    setlistItem: { groupBy: (args: unknown) => groupBy(args) },
    eventSeries: { findMany: (args: unknown) => seriesRows(args) },
  },
}));

import {
  HOME_PAST_WINDOW_MS,
  HOME_TAKE,
  ONGOING_BUFFER_MS,
  findPastWithFallback,
  getCachedHomeData,
  loadHomeData,
} from "@/lib/homeEvents";
import { revalidateEventData, revalidatePublicData } from "@/lib/dataCache";
import { buildLogoSeriesGraph } from "@/lib/logoResolution";

const NOW = new Date("2026-10-21T01:35:00.000Z");

function row(id: number, over: Record<string, unknown> = {}) {
  return {
    id: BigInt(id),
    slug: `e${id}`,
    startTime: new Date("2026-10-01T09:00:00.000Z"),
    engagementOpensAt: null,
    originalName: `Event ${id}`,
    originalShortName: null,
    originalLanguage: "ja",
    originalCity: null,
    originalVenue: null,
    translations: [],
    eventSeries: null,
    eventSeriesId: BigInt(7),
    logoMode: "inherit",
    logoAsset: null,
    artist: null,
    ...over,
  };
}

// Classify each findMany call by its WHERE shape.
function section(args: { where: Where }): "ongoing" | "upcoming" | "past" {
  const w = args.where;
  if ("setlistItems" in w) return "past";
  if (w.status === "scheduled") return "upcoming";
  return "ongoing";
}

const pastSince = (args: { where: { OR: { startTime: { gte?: Date } }[] } }) =>
  args.where.OR[0].startTime.gte ?? null;

beforeEach(() => {
  store.clear();
  eventFindMany.mockReset();
  groupBy.mockReset().mockResolvedValue([]);
  seriesRows.mockReset().mockResolvedValue([]);
});

describe("home queries", () => {
  it("upcoming: scheduled after now, nearest five, no 30-day horizon", async () => {
    eventFindMany.mockResolvedValue([]);
    await loadHomeData(NOW, buildLogoSeriesGraph([]));
    const call = eventFindMany.mock.calls
      .map(([a]) => a)
      .find((a) => section(a) === "upcoming");
    expect(call.where).toEqual({
      isDeleted: false,
      status: "scheduled",
      startTime: { gt: NOW },
    });
    expect(call.orderBy).toEqual({ startTime: "asc" });
    expect(call.take).toBe(HOME_TAKE);
  });

  it("ongoing: manual ongoing or scheduled inside the 12h buffer, uncapped", async () => {
    eventFindMany.mockResolvedValue([]);
    await loadHomeData(NOW, buildLogoSeriesGraph([]));
    const call = eventFindMany.mock.calls
      .map(([a]) => a)
      .find((a) => section(a) === "ongoing");
    expect(call.where.OR).toEqual([
      { status: "ongoing" },
      {
        status: "scheduled",
        startTime: { gt: new Date(NOW.getTime() - ONGOING_BUFFER_MS), lte: NOW },
      },
    ]);
    expect(call.take).toBeUndefined();
  });

  it("past: song-bearing, completed ≤ now (no future anomalies), scheduled past the buffer", async () => {
    eventFindMany.mockResolvedValue([row(1)]);
    await findPastWithFallback(NOW);
    const [args] = eventFindMany.mock.calls[0];
    const since = new Date(NOW.getTime() - HOME_PAST_WINDOW_MS);
    expect(args.where).toEqual({
      isDeleted: false,
      setlistItems: {
        some: { isDeleted: false, type: "song", songs: { some: {} } },
      },
      OR: [
        { status: "completed", startTime: { gte: since, lte: NOW } },
        {
          status: "scheduled",
          startTime: {
            gte: since,
            lte: new Date(NOW.getTime() - ONGOING_BUFFER_MS),
          },
        },
      ],
    });
    expect(args.take).toBe(HOME_TAKE);
    expect(args.orderBy).toEqual([{ startTime: "desc" }, { id: "desc" }]);
  });

  it.each([1, 4])(
    "past: %i recent rows are shown as-is — never topped up with older ones",
    async (n) => {
      eventFindMany.mockResolvedValue(Array.from({ length: n }, (_, i) => row(i + 1)));
      const result = await findPastWithFallback(NOW);
      expect(result.mode).toBe("recent");
      expect(result.rows).toHaveLength(n);
      expect(eventFindMany).toHaveBeenCalledTimes(1);
    },
  );

  it("past: only an empty recent window drops the horizon (archive mode)", async () => {
    eventFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row(4), row(3)]);
    const result = await findPastWithFallback(NOW);
    expect(result.mode).toBe("archive");
    expect(result.rows.map((r) => r.id)).toEqual([BigInt(4), BigInt(3)]);
    const [recentArgs] = eventFindMany.mock.calls[0];
    const [archiveArgs] = eventFindMany.mock.calls[1];
    expect(pastSince(recentArgs)).toEqual(
      new Date(NOW.getTime() - HOME_PAST_WINDOW_MS),
    );
    expect(pastSince(archiveArgs)).toBeNull();
    // The archive still excludes future-dated completed rows.
    expect(archiveArgs.where.OR[0].startTime).toEqual({ lte: NOW });
  });

  it("past: nothing anywhere → none", async () => {
    eventFindMany.mockResolvedValue([]);
    expect((await findPastWithFallback(NOW)).mode).toBe("none");
  });

  it("counts songs for ongoing and past only, and projects ISO strings", async () => {
    eventFindMany.mockImplementation(async (args: { where: Where }) => {
      const s = section(args);
      if (s === "ongoing") return [row(11)];
      if (s === "upcoming") return [row(12, { startTime: new Date("2026-11-14T07:30:00.000Z") })];
      return [row(13)];
    });
    groupBy.mockResolvedValue([{ eventId: BigInt(13), _count: { _all: 22 } }]);
    const data = await loadHomeData(NOW, buildLogoSeriesGraph([]));
    expect(groupBy.mock.calls[0][0].where.eventId).toEqual({
      in: [BigInt(11), BigInt(13)],
    });
    expect(data.ongoing[0].songCount).toBe(0);
    expect(data.past[0].songCount).toBe(22);
    expect(data.upcoming[0].songCount).toBeNull();
    expect(data.upcoming[0].startTime).toBe("2026-11-14T07:30:00.000Z");
    expect(data.pastMode).toBe("recent");
    // Only the public projection leaves: no asset/artist/series-id inputs.
    expect(Object.keys(data.upcoming[0])).not.toContain("logoAsset");
    expect(Object.keys(data.upcoming[0])).not.toContain("eventSeriesId");
  });
});

describe("home cache entry × logo graph (07 contract)", () => {
  const series = (logo: string | null) => ({
    id: BigInt(7),
    parentSeriesId: null,
    isDeleted: false,
    logoMode: logo ? "custom" : "inherit",
    logoAsset: logo ? { publicUrl: logo, width: 300, height: 100 } : null,
    artistId: null,
    artist: null,
  });

  it("serves the cached logo until revalidatePublicData(), not an event-scoped expiry", async () => {
    eventFindMany.mockImplementation(async (args: { where: Where }) =>
      section(args) === "upcoming" ? [row(12, { startTime: new Date("2026-11-14T07:30:00.000Z") })] : [],
    );
    const bucket = NOW.getTime();
    seriesRows.mockResolvedValue([series("https://img.example/a.webp")]);
    const first = await getCachedHomeData(bucket);
    expect(first.upcoming[0].logo.image?.url).toBe("https://img.example/a.webp");

    seriesRows.mockResolvedValue([series("https://img.example/b.webp")]);
    revalidateEventData(BigInt(12));
    expect((await getCachedHomeData(bucket)).upcoming[0].logo.image?.url).toBe(
      "https://img.example/a.webp",
    );

    revalidatePublicData();
    expect((await getCachedHomeData(bucket)).upcoming[0].logo.image?.url).toBe(
      "https://img.example/b.webp",
    );
  });
});
