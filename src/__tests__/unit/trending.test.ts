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

  it("topReaction picks the highest-count reaction type per item", () => {
    const items = [makeItem(1, "Song A")];
    const counts = {
      "1": { best: 2, surprise: 9, waiting: 1, moved: 4 },
    };
    const [first] = deriveTrendingSongs(items, counts, "en", "Unknown");
    expect(first.topReaction).toEqual({
      type: "surprise",
      emoji: "😱",
      count: 9,
    });
  });

  it("uses the locale-matched translation title, falling back to originalTitle", () => {
    const items: LiveSetlistItem[] = [
      {
        ...makeItem(1, "Original"),
        songs: [
          {
            song: {
              id: 100,
              slug: "original",
              originalTitle: "Original",
              originalLanguage: "ja",
              variantLabel: null,
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
    expect(
      deriveTrendingSongs(items, counts, "ko", "Unknown")[0].songTitle,
    ).toBe("오리지널");
    // Locale not present → falls back to originalTitle
    expect(
      deriveTrendingSongs(items, counts, "en", "Unknown")[0].songTitle,
    ).toBe("Original");
  });

  it("preserves empty-string originalTitle (?? does not fall through to unknownSongLabel on '')", () => {
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
              translations: [],
              artists: [],
            },
          },
        ],
      },
    ];
    const counts = { "1": { best: 1 } };
    // pickLocaleTranslation returns undefined (no translations); originalTitle is ""
    // — falsy, so unknownSongLabel wins via the `??` chain only when null/undefined.
    // Empty string is preserved (not null). This documents the behavior.
    const out = deriveTrendingSongs(items, counts, "ko", "Unknown");
    expect(out[0].songTitle).toBe("");
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
