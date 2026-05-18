import { describe, it, expect } from "vitest";
import {
  flattenSetlistToPredictions,
  mergeAppendUnique,
  dedupCountForMerge,
  safeBigIntToNumber,
  type SetlistItemSlim,
} from "@/lib/copyPastSetlist";
import type { PredictionEntry } from "@/lib/predictionsStorage";

/**
 * Test fixtures are intentionally verbose — the relational shape the
 * API hands us is what's wire-coupled, and getting any branch of the
 * variant/base/medley/dedup pipeline wrong is a silent data quality
 * regression (a prediction with the wrong title that still "matches"
 * via `isSongMatched`).
 */

function songCore(over: Partial<SetlistItemSlim["songs"][number]["song"]>) {
  return {
    id: BigInt(1),
    originalTitle: "Original",
    originalLanguage: "ja",
    variantLabel: null,
    baseVersionId: null,
    isDeleted: false,
    translations: [],
    baseVersion: null,
    ...over,
  };
}

function setlistItem(
  position: number,
  songs: Array<{ order: number | null; song: ReturnType<typeof songCore> }>,
): SetlistItemSlim {
  return { position, songs };
}

describe("flattenSetlistToPredictions", () => {
  it("returns [] for empty input", () => {
    expect(flattenSetlistToPredictions([])).toEqual([]);
  });

  it("medley → first song only (the rest of the medley is dropped)", () => {
    const items: SetlistItemSlim[] = [
      setlistItem(1, [
        {
          order: 0,
          song: songCore({ id: BigInt(10), originalTitle: "First" }),
        },
        {
          order: 1,
          song: songCore({ id: BigInt(11), originalTitle: "Second" }),
        },
        {
          order: 2,
          song: songCore({ id: BigInt(12), originalTitle: "Third" }),
        },
      ]),
    ];
    const out = flattenSetlistToPredictions(items);
    expect(out).toHaveLength(1);
    expect(out[0].songId).toBe(10);
    expect(out[0].song.originalTitle).toBe("First");
  });

  it("skips SetlistItems with empty songs[] (data damage)", () => {
    const items: SetlistItemSlim[] = [
      setlistItem(1, []),
      setlistItem(2, [
        {
          order: 0,
          song: songCore({ id: BigInt(20), originalTitle: "Real" }),
        },
      ]),
    ];
    const out = flattenSetlistToPredictions(items);
    expect(out).toHaveLength(1);
    expect(out[0].songId).toBe(20);
  });

  it("variant → base substitution: songId, title, variantLabel come from base", () => {
    const items: SetlistItemSlim[] = [
      setlistItem(1, [
        {
          order: 0,
          song: songCore({
            id: BigInt(105),
            originalTitle: "Dream Believers (SAKURA Ver.)",
            variantLabel: "SAKURA Ver.",
            baseVersionId: BigInt(100),
            baseVersion: songCore({
              id: BigInt(100),
              originalTitle: "Dream Believers",
              variantLabel: null,
              baseVersionId: null,
              translations: [
                { locale: "ko", title: "드림 빌리버즈", variantLabel: null },
              ],
            }),
          }),
        },
      ]),
    ];
    const out = flattenSetlistToPredictions(items);
    expect(out).toHaveLength(1);
    expect(out[0].songId).toBe(100);
    expect(out[0].song.originalTitle).toBe("Dream Believers");
    expect(out[0].song.variantLabel).toBeNull();
    expect(out[0].song.baseVersionId).toBeNull();
    expect(out[0].song.translations).toEqual([
      { locale: "ko", title: "드림 빌리버즈", variantLabel: null },
    ]);
  });

  it("non-variant (baseVersionId === null) is kept as-is", () => {
    const items: SetlistItemSlim[] = [
      setlistItem(1, [
        {
          order: 0,
          song: songCore({
            id: BigInt(50),
            originalTitle: "Standalone",
            baseVersionId: null,
            baseVersion: null,
          }),
        },
      ]),
    ];
    const out = flattenSetlistToPredictions(items);
    expect(out).toHaveLength(1);
    expect(out[0].songId).toBe(50);
    expect(out[0].song.originalTitle).toBe("Standalone");
  });

  it("variant whose base is soft-deleted: the whole SetlistItem is dropped (no fallback to variant)", () => {
    const items: SetlistItemSlim[] = [
      setlistItem(1, [
        {
          order: 0,
          song: songCore({
            id: BigInt(105),
            originalTitle: "(variant)",
            baseVersionId: BigInt(100),
            baseVersion: songCore({
              id: BigInt(100),
              originalTitle: "base — dead",
              isDeleted: true,
            }),
          }),
        },
      ]),
      setlistItem(2, [
        {
          order: 0,
          song: songCore({
            id: BigInt(200),
            originalTitle: "Alive",
          }),
        },
      ]),
    ];
    const out = flattenSetlistToPredictions(items);
    expect(out).toHaveLength(1);
    expect(out[0].songId).toBe(200);
  });

  it("variant whose baseVersion was not loaded (degenerate) is dropped, not silently fallen back", () => {
    const items: SetlistItemSlim[] = [
      setlistItem(1, [
        {
          order: 0,
          song: songCore({
            id: BigInt(105),
            originalTitle: "Orphan variant",
            baseVersionId: BigInt(100),
            baseVersion: null,
          }),
        },
      ]),
    ];
    const out = flattenSetlistToPredictions(items);
    expect(out).toHaveLength(0);
  });

  it("two variants of the same base dedup to a single base entry", () => {
    const base = songCore({
      id: BigInt(100),
      originalTitle: "Dream Believers",
    });
    const items: SetlistItemSlim[] = [
      setlistItem(1, [
        {
          order: 0,
          song: songCore({
            id: BigInt(105),
            originalTitle: "DB (SAKURA Ver.)",
            baseVersionId: BigInt(100),
            baseVersion: base,
          }),
        },
      ]),
      setlistItem(2, [
        {
          order: 0,
          song: songCore({
            id: BigInt(106),
            originalTitle: "DB (104th Ver.)",
            baseVersionId: BigInt(100),
            baseVersion: base,
          }),
        },
      ]),
    ];
    const out = flattenSetlistToPredictions(items);
    expect(out).toHaveLength(1);
    expect(out[0].songId).toBe(100);
    expect(out[0].song.originalTitle).toBe("Dream Believers");
  });

  it("effective song marked isDeleted (non-variant case): skip", () => {
    const items: SetlistItemSlim[] = [
      setlistItem(1, [
        {
          order: 0,
          song: songCore({ id: BigInt(70), isDeleted: true }),
        },
      ]),
      setlistItem(2, [
        { order: 0, song: songCore({ id: BigInt(80) }) },
      ]),
    ];
    const out = flattenSetlistToPredictions(items);
    expect(out).toHaveLength(1);
    expect(out[0].songId).toBe(80);
  });

  it("skips entries whose effective.id exceeds Number.MAX_SAFE_INTEGER (dedup-set correctness)", () => {
    // 2^53 — just past the safe range. A naïve Number(bigint) would
    // truncate this to 9007199254740992 and collide with the actual
    // safe-range neighbour, silently merging two distinct songs.
    const unsafeId = BigInt(2) ** BigInt(53) + BigInt(1);
    const items: SetlistItemSlim[] = [
      setlistItem(1, [
        { order: 0, song: songCore({ id: unsafeId, originalTitle: "Overflow" }) },
      ]),
      setlistItem(2, [
        { order: 0, song: songCore({ id: BigInt(42), originalTitle: "Safe" }) },
      ]),
    ];
    const out = flattenSetlistToPredictions(items);
    expect(out).toHaveLength(1);
    expect(out[0].songId).toBe(42);
  });

  it("nulls out carried baseVersionId when it would be unsafe (degenerate variant→base chain)", () => {
    // Reaches the carried-baseVersionId branch via the variant→base
    // path: the effective row (the base) is itself stamped with a
    // non-null baseVersionId pointing further up the chain. Schema
    // allows it; convention says no, so this is data damage we want
    // to handle without emitting a truncated metadata value.
    const unsafeBaseOfBase = BigInt(2) ** BigInt(53) + BigInt(5);
    const items: SetlistItemSlim[] = [
      setlistItem(1, [
        {
          order: 0,
          song: songCore({
            id: BigInt(105),
            baseVersionId: BigInt(100),
            baseVersion: songCore({
              id: BigInt(100),
              originalTitle: "Base with unsafe pointer",
              // Degenerate: this base's own baseVersionId is unsafe.
              baseVersionId: unsafeBaseOfBase,
            }),
          }),
        },
      ]),
    ];
    const out = flattenSetlistToPredictions(items);
    expect(out).toHaveLength(1);
    expect(out[0].songId).toBe(100);
    expect(out[0].song.baseVersionId).toBeNull();
  });

  it("the same non-variant song repeated across positions appears once", () => {
    const items: SetlistItemSlim[] = [
      setlistItem(1, [
        { order: 0, song: songCore({ id: BigInt(42), originalTitle: "Encore song" }) },
      ]),
      setlistItem(2, [
        { order: 0, song: songCore({ id: BigInt(43) }) },
      ]),
      setlistItem(3, [
        // Same songId 42 appearing again later (e.g. encore reprise).
        { order: 0, song: songCore({ id: BigInt(42), originalTitle: "Encore song" }) },
      ]),
    ];
    const out = flattenSetlistToPredictions(items);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.songId)).toEqual([42, 43]);
  });
});

function entry(songId: number, originalTitle = `t${songId}`): PredictionEntry {
  return {
    songId,
    song: {
      originalTitle,
      originalLanguage: "ja",
      variantLabel: null,
      baseVersionId: null,
      translations: [],
    },
  };
}

function variantEntry(songId: number, baseVersionId: number): PredictionEntry {
  return {
    songId,
    song: {
      originalTitle: `variant of ${baseVersionId}`,
      originalLanguage: "ja",
      variantLabel: "Variant Ver.",
      baseVersionId,
      translations: [],
    },
  };
}

describe("mergeAppendUnique", () => {
  it("from empty existing: returns incoming as-is", () => {
    const merged = mergeAppendUnique([], [entry(1), entry(2)]);
    expect(merged.map((e) => e.songId)).toEqual([1, 2]);
  });

  it("preserves existing order, appends only new uniques in incoming order", () => {
    const merged = mergeAppendUnique(
      [entry(10), entry(20)],
      [entry(20), entry(30), entry(10), entry(40)],
    );
    expect(merged.map((e) => e.songId)).toEqual([10, 20, 30, 40]);
  });

  it("returns a new array (does not mutate existing)", () => {
    const existing = [entry(1)];
    const merged = mergeAppendUnique(existing, [entry(2)]);
    expect(merged).not.toBe(existing);
    expect(existing.map((e) => e.songId)).toEqual([1]);
  });

  it("incoming all duplicates: result equals existing", () => {
    const merged = mergeAppendUnique(
      [entry(1), entry(2)],
      [entry(1), entry(2)],
    );
    expect(merged.map((e) => e.songId)).toEqual([1, 2]);
  });

  it("variant↔base canonical dedup: existing variant (id 105 → base 100), incoming base (id 100) is a duplicate", () => {
    // User manually predicted the SAKURA variant; past-event seed
    // transformed variants → base. Same song under isSongMatched's
    // equivalence, so no second entry should be appended.
    const merged = mergeAppendUnique([variantEntry(105, 100)], [entry(100)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].songId).toBe(105); // existing preserved
  });

  it("variant↔base canonical dedup: incoming variant is duplicate of existing base", () => {
    const merged = mergeAppendUnique([entry(100)], [variantEntry(105, 100)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].songId).toBe(100);
  });

  it("two variants of the same base both in incoming: first wins, second skipped", () => {
    const merged = mergeAppendUnique(
      [],
      [variantEntry(105, 100), variantEntry(106, 100)],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].songId).toBe(105);
  });
});

describe("safeBigIntToNumber", () => {
  it("returns a number for safe-range values", () => {
    expect(safeBigIntToNumber(BigInt(0))).toBe(0);
    expect(safeBigIntToNumber(BigInt(42))).toBe(42);
    expect(safeBigIntToNumber(BigInt(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(safeBigIntToNumber(BigInt(Number.MIN_SAFE_INTEGER))).toBe(
      Number.MIN_SAFE_INTEGER,
    );
  });

  it("returns null for values past the positive boundary", () => {
    expect(safeBigIntToNumber(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1))).toBeNull();
    expect(safeBigIntToNumber(BigInt(2) ** BigInt(64))).toBeNull();
  });

  it("returns null for values past the negative boundary", () => {
    expect(safeBigIntToNumber(BigInt(Number.MIN_SAFE_INTEGER) - BigInt(1))).toBeNull();
  });
});

describe("dedupCountForMerge", () => {
  it("0 when nothing overlaps", () => {
    expect(dedupCountForMerge([entry(1)], [entry(2), entry(3)])).toBe(0);
  });

  it("counts each overlapping incoming songId once", () => {
    expect(
      dedupCountForMerge(
        [entry(1), entry(2)],
        [entry(1), entry(2), entry(3)],
      ),
    ).toBe(2);
  });

  it("all overlap: returns incoming.length", () => {
    expect(
      dedupCountForMerge(
        [entry(1), entry(2)],
        [entry(1), entry(2)],
      ),
    ).toBe(2);
  });

  it("empty existing: always 0", () => {
    expect(dedupCountForMerge([], [entry(1), entry(2)])).toBe(0);
  });

  it("variant↔base canonical: existing variant + incoming base counts as 1 overlap", () => {
    expect(
      dedupCountForMerge([variantEntry(105, 100)], [entry(100), entry(200)]),
    ).toBe(1);
  });

  it("variant↔base canonical: existing base + incoming variant counts as 1 overlap", () => {
    expect(
      dedupCountForMerge([entry(100)], [variantEntry(105, 100), entry(200)]),
    ).toBe(1);
  });
});
