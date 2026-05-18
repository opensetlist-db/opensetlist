import { describe, it, expect } from "vitest";
import {
  flattenSetlistToPredictions,
  mergeAppendUnique,
  dedupCountForMerge,
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
});
