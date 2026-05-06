import { describe, it, expect } from "vitest";
import { deriveTrendingSongs } from "@/lib/trending";
import type { LiveSetlistItem } from "@/components/LiveSetlist";

// Minimal LiveSetlistItem builder — most fields are unused by the helper
// but required to satisfy the structural type. Centralized here so
// individual tests stay readable.
function makeItem(
  id: number,
  songTitle: string,
  opts: { withSong?: boolean; locale?: string } = {},
): LiveSetlistItem {
  const { withSong = true, locale = "en" } = opts;
  return {
    id,
    position: id,
    isEncore: false,
    stageType: "full_group",
    unitName: null,
    status: "live",
    performanceType: "live_performance",
    type: "song",
    songs: withSong
      ? [
          {
            song: {
              id: id * 100,
              slug: `song-${id}`,
              originalTitle: songTitle,
              originalLanguage: locale,
              variantLabel: null,
              baseVersionId: null,
              translations: [{ locale, title: songTitle }],
              artists: [],
            },
          },
        ]
      : [],
    performers: [],
    artists: [],
  };
}

describe("deriveTrendingSongs", () => {
  it("returns [] for empty inputs", () => {
    expect(deriveTrendingSongs([], {}, "en", "Unknown")).toEqual([]);
  });

  it("returns [] when no items have any reactions", () => {
    const items = [makeItem(1, "Song A"), makeItem(2, "Song B")];
    expect(deriveTrendingSongs(items, {}, "en", "Unknown")).toEqual([]);
  });

  it("excludes items with no songs assigned (mirrors server's songs.some({}) filter)", () => {
    const items = [
      makeItem(1, "Song A"),
      makeItem(2, "(no song)", { withSong: false }),
    ];
    const counts = {
      "1": { best: 3 },
      "2": { best: 100 }, // would-be top, but no song → dropped
    };
    const result = deriveTrendingSongs(items, counts, "en", "Unknown");
    expect(result).toHaveLength(1);
    expect(result[0].setlistItemId).toBe("1");
  });

  it("ranks by total reactions across all reaction types", () => {
    const items = [
      makeItem(1, "A"),
      makeItem(2, "B"),
      makeItem(3, "C"),
      makeItem(4, "D"),
    ];
    const counts = {
      "1": { best: 5, surprise: 2 }, // total 7 → 2nd
      "2": { waiting: 1 }, // total 1 → 4th (excluded by top-3)
      "3": { best: 10, moved: 5 }, // total 15 → 1st
      "4": { surprise: 3 }, // total 3 → 3rd
    };
    const result = deriveTrendingSongs(items, counts, "en", "Unknown");
    expect(result.map((r) => r.setlistItemId)).toEqual(["3", "1", "4"]);
    expect(result.map((r) => r.totalReactions)).toEqual([15, 7, 3]);
  });

  it("reactionCounts surfaces every per-type count present on the item", () => {
    // F17 (Day-1 retro): the earlier shape collapsed `types` into a
    // single `topReaction` (the max-count type), which made the widget
    // under-display total engagement once any per-type count grew past
    // rehearsal-scale single digits. Pass the full map through so the
    // renderer can show all four counts in the canonical order.
    const items = [makeItem(1, "Song A")];
    const counts = {
      "1": { best: 2, surprise: 9, waiting: 1, moved: 4 },
    };
    const [first] = deriveTrendingSongs(items, counts, "en", "Unknown");
    expect(first.reactionCounts).toEqual({
      best: 2,
      surprise: 9,
      waiting: 1,
      moved: 4,
    });
  });

  it("reactionCounts omits types absent from the input (renderer falls back to 0)", () => {
    // The renderer in `<TrendingSongs>` iterates REACTION_TYPES and
    // does `reactionCounts[type] ?? 0`. The derivation should pass
    // the raw map through without populating absent keys — keeping
    // the shape minimal here documents the contract: missing key
    // means zero, no need to pre-fill.
    const items = [makeItem(1, "Song A")];
    const counts = { "1": { best: 5, waiting: 2 } };
    const [first] = deriveTrendingSongs(items, counts, "en", "Unknown");
    expect(first.reactionCounts).toEqual({ best: 5, waiting: 2 });
    expect(first.reactionCounts.surprise).toBeUndefined();
    expect(first.reactionCounts.moved).toBeUndefined();
  });

  it("ranks by total even when a single type's max would invert the order", () => {
    // Regression guard for F17 — pre-fix the displayed count came from
    // max-single, so a fixture where max-single ranks differently than
    // total catches any future drift back toward that bug. Item 1 has
    // total=11 (max=5); item 2 has total=8 but max=8. By total, item 1
    // wins; by max-single it would lose.
    const items = [makeItem(1, "Song A"), makeItem(2, "Song B")];
    const counts = {
      "1": { best: 5, waiting: 3, surprise: 2, moved: 1 }, // total 11, max 5
      "2": { best: 8 }, // total 8, max 8
    };
    const result = deriveTrendingSongs(items, counts, "en", "Unknown");
    expect(result.map((r) => r.setlistItemId)).toEqual(["1", "2"]);
    expect(result.map((r) => r.totalReactions)).toEqual([11, 8]);
  });

  it("mainTitle is always originalTitle; subTitle carries the locale-matched translation when locale differs", () => {
    // Mirrors `<SetlistRow>`'s display: original-language title is the
    // primary slot, the localized title sits next to it as the muted
    // sub line. This is the cross-surface consistency contract — the
    // trending card must read the same way as every other song listing.
    const items: LiveSetlistItem[] = [
      {
        ...makeItem(1, "Original"),
        songs: [
          {
            song: {
              id: 100,
              slug: "original",
              originalTitle: "オリジナル",
              originalLanguage: "ja",
              variantLabel: null,
              baseVersionId: null,
              translations: [
                { locale: "ja", title: "オリジナル" },
                { locale: "ko", title: "오리지널" },
              ],
              artists: [],
            },
          },
        ],
      },
    ];
    const counts = { "1": { best: 1 } };

    // ko viewer: original ja title primary, ko translation as sub.
    const ko = deriveTrendingSongs(items, counts, "ko", "Unknown")[0];
    expect(ko.mainTitle).toBe("オリジナル");
    expect(ko.subTitle).toBe("오리지널");

    // ja viewer (locale === originalLanguage): no sub line.
    const ja = deriveTrendingSongs(items, counts, "ja", "Unknown")[0];
    expect(ja.mainTitle).toBe("オリジナル");
    expect(ja.subTitle).toBeNull();

    // en viewer (locale ≠ original, no en translation): no sub line.
    const en = deriveTrendingSongs(items, counts, "en", "Unknown")[0];
    expect(en.mainTitle).toBe("オリジナル");
    expect(en.subTitle).toBeNull();
  });

  it("preserves empty-string originalTitle (no fallback to unknownSongLabel on '')", () => {
    const items: LiveSetlistItem[] = [
      {
        ...makeItem(1, ""),
        songs: [
          {
            song: {
              id: 100,
              slug: "empty-title",
              originalTitle: "",
              originalLanguage: "ja",
              variantLabel: null,
              baseVersionId: null,
              translations: [],
              artists: [],
            },
          },
        ],
      },
    ];
    const counts = { "1": { best: 1 } };
    // `displayOriginalTitle` returns `main = item.originalTitle` directly,
    // so an empty string is preserved (not coerced to the unknown label).
    // The unknown label is reserved for itemless rows — see the
    // dedicated test above.
    const out = deriveTrendingSongs(items, counts, "ko", "Unknown");
    expect(out[0].mainTitle).toBe("");
    expect(out[0].subTitle).toBeNull();
  });

  it("propagates variantLabel via the locale-strict cascade", () => {
    // `displayOriginalTitle` resolves the variant label per the same
    // locale-strict rule it uses for the title's sub slot — locale-
    // matched translation's `variantLabel` first, then the song's own
    // `variantLabel`, otherwise null.
    const items: LiveSetlistItem[] = [
      {
        ...makeItem(1, "Song"),
        songs: [
          {
            song: {
              id: 100,
              slug: "song",
              originalTitle: "Song",
              originalLanguage: "ja",
              variantLabel: "SAKURA Ver.",
              baseVersionId: null,
              translations: [
                { locale: "ko", title: "노래", variantLabel: "사쿠라 ver." },
              ],
              artists: [],
            },
          },
        ],
      },
    ];
    const counts = { "1": { best: 1 } };

    expect(
      deriveTrendingSongs(items, counts, "ko", "Unknown")[0].variantLabel,
    ).toBe("사쿠라 ver.");
    // No ja translation row → falls through to the song's own label.
    expect(
      deriveTrendingSongs(items, counts, "ja", "Unknown")[0].variantLabel,
    ).toBe("SAKURA Ver.");
  });

  it("caps the result to top 3", () => {
    const items = Array.from({ length: 6 }, (_, i) => makeItem(i + 1, `S${i}`));
    const counts: Record<string, Record<string, number>> = {};
    items.forEach((it, i) => {
      counts[String(it.id)] = { best: (i + 1) * 10 };
    });
    const result = deriveTrendingSongs(items, counts, "en", "Unknown");
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.totalReactions)).toEqual([60, 50, 40]);
  });
});
