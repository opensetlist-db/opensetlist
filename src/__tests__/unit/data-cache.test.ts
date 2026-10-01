import { beforeEach, describe, expect, it, vi } from "vitest";

// `unstable_cache` needs Next's incremental cache, which only exists
// inside a request. The stub below models the contract the wrapper
// relies on: the cached callback's return value is JSON-stringified on
// store and JSON-parsed on hit, keyed on `keyParts`.
const store = new Map<string, string>();
const unstableCacheCalls: Array<{
  keyParts: string[];
  options: { revalidate?: number; tags?: string[] };
}> = [];
const revalidateTagMock = vi.fn();

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
  revalidateTag: (...args: unknown[]) => revalidateTagMock(...args),
}));

import {
  PUBLIC_DATA_TAG,
  cachedQuery,
  decodeCacheValue,
  encodeCacheValue,
  eventTag,
  joinIdKey,
  revalidateEventData,
  revalidatePublicData,
  splitIdKey,
  timeBucket,
} from "@/lib/dataCache";

beforeEach(() => {
  store.clear();
  unstableCacheCalls.length = 0;
  revalidateTagMock.mockReset();
});

describe("cache codec", () => {
  it("round-trips bigint and Date values exactly", () => {
    const value = {
      id: 42n,
      big: 9007199254740993n, // > 2^53 — would round as a number
      startTime: new Date("2026-11-07T09:00:00.000Z"),
      nested: [{ id: 7n, at: new Date("2026-01-01T00:00:00.000Z") }],
      name: "蓮ノ空",
      nothing: null,
    };
    const decoded = decodeCacheValue<typeof value>(encodeCacheValue(value));
    expect(decoded).toEqual(value);
    expect(typeof decoded.id).toBe("bigint");
    expect(decoded.big).toBe(9007199254740993n);
    expect(decoded.startTime).toBeInstanceOf(Date);
    expect(decoded.nested[0].at).toBeInstanceOf(Date);
  });

  it("leaves already-serialized payloads untouched", () => {
    // Most fetchers return `serializeBigInt` output: numbers + ISO strings.
    const value = { id: 3, startTime: "2026-11-07T09:00:00.000Z" };
    expect(decodeCacheValue(encodeCacheValue(value))).toEqual(value);
  });

  it("encodes an invalid Date as null, like JSON.stringify", () => {
    const decoded = decodeCacheValue<{ d: Date | null }>(
      encodeCacheValue({ d: new Date("nope") }),
    );
    expect(decoded.d).toBeNull();
  });

  it("handles top-level primitives and null", () => {
    expect(decodeCacheValue(encodeCacheValue(5n))).toBe(5n);
    expect(decodeCacheValue(encodeCacheValue(null))).toBeNull();
  });
});

describe("cachedQuery", () => {
  it("returns the same types on a miss and on a hit", async () => {
    const fn = vi.fn(async (id: bigint) => ({
      id,
      at: new Date("2026-09-30T00:00:00.000Z"),
    }));
    const get = cachedQuery("test-rows", fn, { revalidate: 60 });

    const miss = await get(1n);
    const hit = await get(1n);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(miss).toEqual(hit);
    expect(hit.id).toBe(1n);
    expect(hit.at).toBeInstanceOf(Date);
  });

  it("keys on name + args, so different args miss", async () => {
    const fn = vi.fn(async (id: bigint, locale: string) => `${id}-${locale}`);
    const get = cachedQuery("test-keys", fn, { revalidate: 60 });

    await get(1n, "ja");
    await get(1n, "ko");
    await get(2n, "ja");
    await get(1n, "ja");

    expect(fn).toHaveBeenCalledTimes(3);
    expect(unstableCacheCalls[0].keyParts[0]).toBe("test-keys");
    expect(unstableCacheCalls[0].keyParts.slice(-2)).toEqual(["1", "ja"]);
  });

  it("always tags with the public-data tag plus per-call tags", async () => {
    const get = cachedQuery("test-tags", async (id: bigint) => id, {
      revalidate: 30,
      tags: (id) => [eventTag(id)],
    });
    await get(9n);
    expect(unstableCacheCalls[0].options).toEqual({
      revalidate: 30,
      tags: [PUBLIC_DATA_TAG, "event:9"],
    });
  });
});

describe("timeBucket", () => {
  it("floors to the bucket start and is stable within a bucket", () => {
    const a = timeBucket(new Date("2026-11-07T09:00:00.000Z"), 300);
    const b = timeBucket(new Date("2026-11-07T09:04:59.999Z"), 300);
    const c = timeBucket(new Date("2026-11-07T09:05:00.000Z"), 300);
    expect(a).toBe(Date.parse("2026-11-07T09:00:00.000Z"));
    expect(b).toBe(a);
    expect(c).toBe(Date.parse("2026-11-07T09:05:00.000Z"));
  });
});

describe("id-list keys", () => {
  it("round-trips id lists, including the empty list", () => {
    expect(splitIdKey(joinIdKey([3n, 1n, 9007199254740993n]))).toEqual([
      3n,
      1n,
      9007199254740993n,
    ]);
    expect(joinIdKey([])).toBe("");
    expect(splitIdKey("")).toEqual([]);
  });
});

describe("revalidation helpers", () => {
  it("expires immediately rather than stale-while-revalidate", () => {
    revalidatePublicData();
    revalidateEventData(12n);
    expect(revalidateTagMock).toHaveBeenNthCalledWith(1, PUBLIC_DATA_TAG, {
      expire: 0,
    });
    expect(revalidateTagMock).toHaveBeenNthCalledWith(2, "event:12", {
      expire: 0,
    });
  });

  it("never throws into the caller (the write already committed)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    revalidateTagMock.mockImplementation(() => {
      throw new Error("Invariant: static generation store missing");
    });
    expect(() => revalidatePublicData()).not.toThrow();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
