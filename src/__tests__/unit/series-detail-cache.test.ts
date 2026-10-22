import { beforeEach, describe, expect, it, vi } from "vitest";

// The series detail read (`getSeriesDetail`) resolves the 07 logo
// INSIDE its cached entry. These tests drive the real page fetcher, the
// real resolver and the real `cachedQuery` against a tag-aware
// `unstable_cache` stand-in (same model as logo-series-graph-cache):
//   - the walk starts at the series' own node, inherits from ancestors,
//     stops at typography, and never uses generic image / poster;
//   - an ancestor change reaches the descendant's cached page payload
//     only through `revalidatePublicData()`, not an event-scoped expiry;
//   - only `{ image, color }` leaves the read for the logo.

const store = new Map<string, { value: string; tags: string[] }>();
const revalidateTagMock = vi.fn((tag: string) => {
  for (const [key, entry] of store) if (entry.tags.includes(tag)) store.delete(key);
});

vi.mock("next/cache", () => ({
  unstable_cache:
    (cb: (...a: unknown[]) => Promise<unknown>, keyParts: string[], options: { tags?: string[] }) =>
    async (...args: unknown[]) => {
      const key = JSON.stringify([keyParts, args.map(String)]);
      const hit = store.get(key);
      if (hit) return JSON.parse(hit.value);
      const result = await cb(...args);
      store.set(key, { value: JSON.stringify(result), tags: options.tags ?? [] });
      return result;
    },
  revalidateTag: (tag: string) => revalidateTagMock(tag),
}));

vi.mock("@vercel/functions", () => ({
  getCache: () => ({ expireTag: async () => {} }),
  waitUntil: () => {},
}));

const graphRows = vi.fn();
const seriesRow = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    eventSeries: {
      findMany: (...args: unknown[]) => graphRows(...args),
      findFirst: (...args: unknown[]) => seriesRow(...args),
    },
  },
}));

import {
  PUBLIC_DATA_TAG,
  revalidateEventData,
  revalidatePublicData,
} from "@/lib/dataCache";
import { getSeriesDetail } from "@/lib/seriesDetail";

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
const asset = { publicUrl: "https://img.example/qa-logo.webp", width: 720, height: 240 };

// The page row for series 3 (child of 2, grandchild of 1). Its own
// generic image is set on purpose: it must never become the logo.
const pageRow = {
  id: BigInt(3),
  slug: "qa-child",
  imageUrl: "https://img.example/generic.jpg",
  translations: [],
  artist: null,
  parentSeries: null,
  childSeries: [],
  events: [],
};

beforeEach(() => {
  store.clear();
  graphRows.mockReset();
  seriesRow.mockReset();
  revalidateTagMock.mockClear();
  seriesRow.mockResolvedValue(pageRow);
});

const chain = (over: Record<string, Record<string, unknown>> = {}) => [
  node({ id: BigInt(1), ...over["1"] }),
  node({ id: BigInt(2), parentSeriesId: BigInt(1), ...over["2"] }),
  node({ id: BigInt(3), parentSeriesId: BigInt(2), ...over["3"] }),
];

async function logoUrl() {
  const detail = await getSeriesDetail(BigInt(3));
  return detail?.logo.image?.url ?? null;
}

describe("series detail logo (07 resolver inside the cached read)", () => {
  it("is typography when the whole chain inherits — generic image ignored", async () => {
    graphRows.mockResolvedValue(chain());
    const detail = await getSeriesDetail(BigInt(3));
    expect(detail?.logo).toEqual({ image: null, color: null });
  });

  it("inherits the nearest ancestor's custom logo", async () => {
    graphRows.mockResolvedValue(
      chain({ "1": { logoMode: "custom", logoAsset: asset } }),
    );
    expect(await logoUrl()).toBe(asset.publicUrl);
  });

  it("starts at its own node: own custom wins over an ancestor typography stop", async () => {
    graphRows.mockResolvedValue(
      chain({
        "2": { logoMode: "typography" },
        "3": { logoMode: "custom", logoAsset: { ...asset, publicUrl: "https://img.example/own.webp" } },
      }),
    );
    expect(await logoUrl()).toBe("https://img.example/own.webp");
  });

  it("own typography stops an ancestor's custom logo", async () => {
    graphRows.mockResolvedValue(
      chain({ "1": { logoMode: "custom", logoAsset: asset }, "3": { logoMode: "typography" } }),
    );
    expect(await logoUrl()).toBeNull();
  });

  it("an unusable chosen asset is typography, not the ancestor's logo", async () => {
    graphRows.mockResolvedValue(
      chain({
        "1": { logoMode: "custom", logoAsset: asset },
        "2": { logoMode: "custom", logoAsset: { ...asset, width: 0 } },
      }),
    );
    expect(await logoUrl()).toBeNull();
  });

  it("carries only the public projection and the artist colour", async () => {
    graphRows.mockResolvedValue(
      chain({
        "1": {
          logoMode: "custom",
          logoAsset: asset,
          artistId: BigInt(9),
          artist: { color: "#FB8A9B", isDeleted: false },
        },
      }),
    );
    const detail = await getSeriesDetail(BigInt(3));
    expect(detail?.logo).toEqual({
      image: { url: asset.publicUrl, width: 720, height: 240 },
      color: "#FB8A9B",
    });
  });
});

describe("series detail cache", () => {
  it("is a public-data entry", async () => {
    graphRows.mockResolvedValue(chain());
    await getSeriesDetail(BigInt(3));
    const tags = [...store.values()].map((e) => e.tags);
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) expect(t).toContain(PUBLIC_DATA_TAG);
  });

  it("an ancestor logo change reaches the descendant page only after revalidatePublicData", async () => {
    graphRows.mockResolvedValue(chain());
    expect(await logoUrl()).toBeNull();

    // The grandparent gets a logo in the DB.
    graphRows.mockResolvedValue(
      chain({ "1": { logoMode: "custom", logoAsset: asset } }),
    );
    // Still the cached payload: nothing expired yet.
    expect(await logoUrl()).toBeNull();
    // An event-scoped expiry is not enough for a series change …
    revalidateEventData(BigInt(3));
    expect(await logoUrl()).toBeNull();
    // … the public expiry every series/event writer calls is.
    revalidatePublicData();
    expect(await logoUrl()).toBe(asset.publicUrl);

    // And back: the ancestor switches to typography.
    graphRows.mockResolvedValue(chain({ "1": { logoMode: "typography" } }));
    revalidatePublicData();
    expect(await logoUrl()).toBeNull();
  });

  it("returns null (→ 404) for a missing or deleted series", async () => {
    seriesRow.mockResolvedValue(null);
    graphRows.mockResolvedValue(chain());
    expect(await getSeriesDetail(BigInt(404))).toBeNull();
    const where = seriesRow.mock.calls[0][0].where;
    expect(where).toEqual({ id: BigInt(404), isDeleted: false });
  });
});
