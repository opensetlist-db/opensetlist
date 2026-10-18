import { describe, it, expect, beforeEach } from "vitest";
import {
  importBoardPicksToPredictions,
  predictionsFromBoardPicks,
} from "@/lib/board/toPredictions";
import {
  readPredictions,
  writePredictions,
  type PredictionEntry,
} from "@/lib/predictionsStorage";
import type { StoredBoardPick } from "@/lib/board/pickStorage";
import type { AvailableSong } from "@/lib/types/predict";

// Only the fields the bridge reads; the rest of AvailableSong is the
// picker's business.
function song(id: number, title: string): AvailableSong {
  return {
    songId: id,
    originalTitle: title,
    originalLanguage: "ja",
    variantLabel: null,
    baseVersionId: null,
    translations: [{ locale: "ko", title: `${title}-ko`, variantLabel: null }],
  } as unknown as AvailableSong;
}

function pick(
  groupId: string,
  songId: string,
  available = true,
): StoredBoardPick {
  return { id: `p-${groupId}-${songId}`, groupId, songId, title: songId, available };
}

const CATALOG = [song(1, "A"), song(2, "B"), song(3, "C"), song(4, "D")];

beforeEach(() => {
  window.localStorage.clear();
});

describe("predictionsFromBoardPicks", () => {
  it("groups by board group order, keeping each group's picks together", () => {
    // Picks were added interleaved across groups; the draft follows the
    // board's group order, not the add order.
    const picks = [pick("20", "3"), pick("10", "1"), pick("20", "4"), pick("10", "2")];
    const entries = predictionsFromBoardPicks(picks, ["10", "20"], CATALOG);
    expect(entries.map((e) => e.songId)).toEqual([1, 2, 3, 4]);
  });

  it("embeds the catalog's display payload", () => {
    const [entry] = predictionsFromBoardPicks([pick("10", "2")], ["10"], CATALOG);
    expect(entry).toEqual({
      songId: 2,
      song: {
        originalTitle: "B",
        originalLanguage: "ja",
        variantLabel: null,
        baseVersionId: null,
        translations: [{ locale: "ko", title: "B-ko", variantLabel: null }],
      },
    });
  });

  it("imports a song picked under two groups once", () => {
    const picks = [pick("10", "1"), pick("20", "1"), pick("20", "2")];
    const entries = predictionsFromBoardPicks(picks, ["10", "20"], CATALOG);
    expect(entries.map((e) => e.songId)).toEqual([1, 2]);
  });

  it("drops unavailable picks and songs the catalog no longer has", () => {
    const picks = [pick("10", "1", false), pick("10", "2"), pick("10", "99")];
    const entries = predictionsFromBoardPicks(picks, ["10"], CATALOG);
    expect(entries.map((e) => e.songId)).toEqual([2]);
  });

  it("puts picks of a group the board no longer lists last", () => {
    const picks = [pick("30", "4"), pick("10", "1")];
    const entries = predictionsFromBoardPicks(picks, ["10"], CATALOG);
    expect(entries.map((e) => e.songId)).toEqual([1, 4]);
  });
});

describe("importBoardPicksToPredictions", () => {
  it("pre-fills an empty list and marks its order provisional", () => {
    const outcome = importBoardPicksToPredictions({
      eventId: "7",
      picks: [pick("10", "1"), pick("20", "3")],
      groupOrder: ["10", "20"],
      catalog: CATALOG,
    });
    expect(outcome).toEqual({ kind: "imported", count: 2 });
    const stored = readPredictions("7");
    expect(stored?.songs.map((e) => e.songId)).toEqual([1, 3]);
    expect(stored?.provisional).toBe(true);
  });

  it("treats a stored list with no songs as empty", () => {
    writePredictions("7", []);
    const outcome = importBoardPicksToPredictions({
      eventId: "7",
      picks: [pick("10", "1")],
      groupOrder: ["10"],
      catalog: CATALOG,
    });
    expect(outcome).toEqual({ kind: "imported", count: 1 });
  });

  it("never overwrites an existing list", () => {
    const existing: PredictionEntry[] = predictionsFromBoardPicks(
      [pick("10", "4")],
      ["10"],
      CATALOG,
    );
    writePredictions("7", existing);
    const before = window.localStorage.getItem("predict-7");
    const outcome = importBoardPicksToPredictions({
      eventId: "7",
      picks: [pick("10", "1")],
      groupOrder: ["10"],
      catalog: CATALOG,
    });
    expect(outcome).toEqual({ kind: "kept" });
    expect(window.localStorage.getItem("predict-7")).toBe(before);
  });

  it("writes nothing when there is nothing to import", () => {
    const outcome = importBoardPicksToPredictions({
      eventId: "7",
      picks: [pick("10", "1", false)],
      groupOrder: ["10"],
      catalog: CATALOG,
    });
    expect(outcome).toEqual({ kind: "none" });
    expect(window.localStorage.getItem("predict-7")).toBeNull();
  });

  it("reports none, not kept, for an existing list when there is nothing to import", () => {
    writePredictions("7", predictionsFromBoardPicks([pick("10", "4")], ["10"], CATALOG));
    const outcome = importBoardPicksToPredictions({
      eventId: "7",
      picks: [],
      groupOrder: ["10"],
      catalog: CATALOG,
    });
    expect(outcome).toEqual({ kind: "none" });
  });
});
