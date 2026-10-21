import { beforeEach, describe, expect, it, vi } from "vitest";

// Cache contract of the logo series graph: it is an ordinary cached
// public read (PUBLIC_DATA_TAG), so the `revalidatePublicData()` every
// series/event/artist admin writer already calls expires it — and with
// it every surface's resolved logos. Stubs model `unstable_cache` the
// same way unit/data-cache.test.ts does: tag-aware store, expiry by tag.

const store = new Map<string, { value: string; tags: string[] }>();
const revalidateTagMock = vi.fn((tag: string) => {
  for (const [key, entry] of store) if (entry.tags.includes(tag)) store.delete(key);
});

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
  revalidateTag: (tag: string) => revalidateTagMock(tag),
}));

vi.mock("@vercel/functions", () => ({
  getCache: () => ({ expireTag: async () => {} }),
  waitUntil: () => {},
}));

const rows = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { eventSeries: { findMany: (...args: unknown[]) => rows(...args) } },
}));

import {
  PUBLIC_DATA_TAG,
  cachedQuery,
  eventTag,
  revalidateEventData,
  revalidatePublicData,
} from "@/lib/dataCache";
import { getLogoSeriesGraph } from "@/lib/logoSeriesGraph";
import { resolveSeriesLogo } from "@/lib/logoResolution";

const node = (over: Record<string, unknown>) => ({
  id: BigInt(1),
  parentSeriesId: null,
  isDeleted: false,
  logoMode: "inherit",
  logoAsset: null,
  artistId: null,
  artist: null,
  ...over,
});
const logo = { publicUrl: "https://img.example/a.webp", width: 300, height: 100 };

beforeEach(() => {
  store.clear();
  rows.mockReset();
  revalidateTagMock.mockClear();
});

describe("logo series graph cache", () => {
  it("selects only delivery columns of the asset", async () => {
    rows.mockResolvedValue([]);
    await getLogoSeriesGraph();
    const select = rows.mock.calls[0][0].select;
    expect(select.logoAsset).toEqual({ select: { publicUrl: true, width: true, height: true } });
    expect(JSON.stringify(select)).not.toMatch(/sourceUrl|usageNote|objectKey|imageUrl|posterUrl/);
  });

  it("is tagged public-data and survives bigint ids through the cache", async () => {
    rows.mockResolvedValue([node({ id: BigInt(5), parentSeriesId: BigInt(4) }), node({ id: BigInt(4) })]);
    const g = await getLogoSeriesGraph();
    expect(g.get("5")?.parentSeriesId).toBe(BigInt(4));
    const [entry] = [...store.values()];
    expect(entry.tags).toContain(PUBLIC_DATA_TAG);
    // Second read is a hit.
    await getLogoSeriesGraph();
    expect(rows).toHaveBeenCalledTimes(1);
  });

  it("an ancestor change reaches descendants after revalidatePublicData", async () => {
    rows.mockResolvedValue([node({ id: BigInt(1) }), node({ id: BigInt(2), parentSeriesId: BigInt(1) })]);
    expect(resolveSeriesLogo(BigInt(2), await getLogoSeriesGraph()).image).toBeNull();

    rows.mockResolvedValue([
      node({ id: BigInt(1), logoMode: "custom", logoAsset: logo }),
      node({ id: BigInt(2), parentSeriesId: BigInt(1) }),
    ]);
    // An event-scoped expiry is NOT enough for a series change …
    revalidateEventData(BigInt(2));
    expect(resolveSeriesLogo(BigInt(2), await getLogoSeriesGraph()).image).toBeNull();
    // … the public expiry every series/event writer calls is.
    revalidatePublicData();
    expect(resolveSeriesLogo(BigInt(2), await getLogoSeriesGraph()).image?.url).toBe(logo.publicUrl);
  });

  it("surface entries that embed a resolved logo refresh with the graph", async () => {
    // Stand-ins for the consuming surfaces' own cached reads, built the
    // way they are today: home (`home-events`, no extra tag), series
    // detail (`series-detail`) and event detail (`event-detail`, plus
    // eventTag). Each embeds the resolved logo in its cached payload.
    // The concert list (`getEventsListGrouped`) is uncached and search
    // has no page yet; both resolve per request, so they need no entry.
    const surface = (name: string, tags?: (id: bigint) => string[]) =>
      cachedQuery(
        name,
        async (id: bigint) => ({ logo: resolveSeriesLogo(id, await getLogoSeriesGraph()) }),
        { revalidate: 300, tags },
      );
    const home = surface("t-home-events");
    const seriesDetail = surface("t-series-detail");
    const eventDetail = surface("t-event-detail", (id) => [eventTag(id)]);
    const all = async () =>
      Promise.all([home, seriesDetail, eventDetail].map(async (read) => (await read(BigInt(2))).logo.image?.url ?? null));

    rows.mockResolvedValue([node({ id: BigInt(1) }), node({ id: BigInt(2), parentSeriesId: BigInt(1) })]);
    expect(await all()).toEqual([null, null, null]);

    // The ancestor gets a logo in the DB.
    rows.mockResolvedValue([
      node({ id: BigInt(1), logoMode: "custom", logoAsset: logo }),
      node({ id: BigInt(2), parentSeriesId: BigInt(1) }),
    ]);
    revalidateEventData(BigInt(2));
    // Event-scoped expiry: the event entry re-reads, but the graph inside
    // it is still the cached one, and home/series are untouched.
    expect(await all()).toEqual([null, null, null]);

    revalidatePublicData();
    expect(await all()).toEqual([logo.publicUrl, logo.publicUrl, logo.publicUrl]);
  });
});
