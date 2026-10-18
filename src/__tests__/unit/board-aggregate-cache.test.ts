// @vitest-environment node
//
// Wrapper contract of the fan board aggregate: its own cache
// name and tag, the board TTL, and a key of event + locale + resolved
// status. `unstable_cache` is stubbed exactly as in data-cache.test.ts
// (store on miss, JSON round-trip on hit); this proves what the wrapper
// asks Next for, NOT that Next reuses it across requests — that is shown
// on a running Preview.
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const unstableCacheCalls: Array<{
  keyParts: string[];
  options: { revalidate?: number; tags?: string[] };
}> = [];

vi.mock("next/cache", () => ({
  unstable_cache:
    (
      cb: () => Promise<unknown>,
      keyParts: string[],
      options: { revalidate?: number; tags?: string[] },
    ) =>
    async () => {
      unstableCacheCalls.push({ keyParts, options });
      const key = JSON.stringify(keyParts);
      const hit = store.get(key);
      if (hit !== undefined) return JSON.parse(hit);
      const result = await cb();
      store.set(key, JSON.stringify(result));
      return result;
    },
  revalidateTag: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findFirst: vi.fn() },
    boardPick: { groupBy: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));
vi.mock("@/lib/board/loadBoardGroups", () => ({ loadBoardGroups: vi.fn() }));
vi.mock("@/lib/predict/availableSongs", () => ({
  getAvailableSongsCached: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { CACHE_TTL, PUBLIC_DATA_TAG } from "@/lib/dataCache";
import { getBoardAggregateCached } from "@/lib/board/boardRead";
import { loadBoardGroups } from "@/lib/board/loadBoardGroups";

const pickGroupBy = vi.mocked(prisma.boardPick.groupBy);

beforeEach(() => {
  store.clear();
  unstableCacheCalls.length = 0;
  vi.clearAllMocks();
  vi.mocked(prisma.event.findFirst).mockResolvedValue({
    boardEnabled: true,
    boardStarterSongIds: null,
    status: "scheduled",
    startTime: new Date("2026-11-14T07:30:00.000Z"),
    eventSeries: { artist: null },
  } as never);
  vi.mocked(loadBoardGroups).mockResolvedValue([
    { artistId: 1, slug: "hasunosora", label: "蓮ノ空", color: null },
  ]);
  pickGroupBy.mockResolvedValue([] as never);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
});

function aggregateCalls() {
  return unstableCacheCalls.filter((c) => c.keyParts[0] === "event-board");
}

describe("getBoardAggregateCached", () => {
  it("own name, board TTL, own tag only (never the event tag)", async () => {
    await getBoardAggregateCached(BigInt(107), "ja", "upcoming");
    const [call] = aggregateCalls();
    expect(call.keyParts.slice(-3)).toEqual(["107", "ja", "upcoming"]);
    expect(CACHE_TTL.board).toBe(120);
    expect(call.options).toEqual({
      revalidate: 120,
      tags: [PUBLIC_DATA_TAG, "event:107:board"],
    });
  });

  it("two reads with the same key → one computation, same asOf", async () => {
    const first = await getBoardAggregateCached(BigInt(107), "ja", "upcoming");
    const second = await getBoardAggregateCached(BigInt(107), "ja", "upcoming");
    expect(pickGroupBy).toHaveBeenCalledTimes(1);
    expect(new Date(second.asOf).toISOString()).toBe(
      new Date(first.asOf).toISOString(),
    );
  });

  it("locale and resolved status are part of the key", async () => {
    await getBoardAggregateCached(BigInt(107), "ja", "upcoming");
    await getBoardAggregateCached(BigInt(107), "ko", "upcoming");
    await getBoardAggregateCached(BigInt(107), "ja", "completed");
    expect(pickGroupBy).toHaveBeenCalledTimes(3);
  });
});
