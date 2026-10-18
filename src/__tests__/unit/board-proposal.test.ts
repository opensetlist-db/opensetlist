import { describe, it, expect } from "vitest";
import {
  deriveBoardProposal,
  previewPublish,
} from "@/lib/board/proposal";
import type { PredictionEntry } from "@/lib/predictionsStorage";
import type { StoredBoardPick } from "@/lib/board/pickStorage";
import type { AvailableSong } from "@/lib/types/predict";

// Fan board (n15) — "put on the board": the full ordered list → a proposal of
// at most 3 expected songs per group. Pure; nothing is written.

function song(id: number, groups: number[] = []): AvailableSong {
  return {
    songId: id,
    originalTitle: `S${id}`,
    originalLanguage: "ja",
    variantLabel: null,
    baseVersionId: null,
    translations: [],
    festivalGroupIds: groups,
  } as unknown as AvailableSong;
}

function entry(songId: number, baseVersionId: number | null = null): PredictionEntry {
  return {
    songId,
    song: {
      originalTitle: `S${songId}`,
      originalLanguage: "ja",
      variantLabel: baseVersionId ? "Ver." : null,
      baseVersionId,
      translations: [],
    },
  };
}

function pick(groupId: string, songId: string): StoredBoardPick {
  return { id: `p-${songId}`, groupId, songId, title: `S${songId}`, available: true };
}

describe("deriveBoardProposal — festival (per-group catalogs)", () => {
  // Group 10 owns 1–5, group 20 owns 6–8; 9 is a crossover of both.
  const CATALOG = [
    ...[1, 2, 3, 4, 5].map((id) => song(id, [10])),
    ...[6, 7, 8].map((id) => song(id, [20])),
    song(9, [10, 20]),
  ];
  const GROUPS = ["10", "20"];

  it("takes the first three songs of each group in list order", () => {
    const draft = [6, 1, 2, 7, 3, 4, 8, 5].map((id) => entry(id));
    const proposal = deriveBoardProposal(draft, GROUPS, CATALOG);
    expect(proposal).toEqual([
      { songId: "6", groupId: "20", choices: ["20"] },
      { songId: "1", groupId: "10", choices: ["10"] },
      { songId: "2", groupId: "10", choices: ["10"] },
      { songId: "7", groupId: "20", choices: ["20"] },
      { songId: "3", groupId: "10", choices: ["10"] },
      { songId: "8", groupId: "20", choices: ["20"] },
    ]);
  });

  it("lists a cross-group song once, under its first group with room, offering both", () => {
    const draft = [1, 2, 3, 9, 6].map((id) => entry(id));
    const proposal = deriveBoardProposal(draft, GROUPS, CATALOG);
    // Group 10 is full after 1–3, so the crossover lands under 20.
    expect(proposal.find((p) => p.songId === "9")).toEqual({
      songId: "9",
      groupId: "20",
      choices: ["10", "20"],
    });
    expect(proposal.filter((p) => p.songId === "9")).toHaveLength(1);
  });

  it("defaults a cross-group song to the board's first group when it has room", () => {
    const proposal = deriveBoardProposal([entry(9)], GROUPS, CATALOG);
    expect(proposal).toEqual([{ songId: "9", groupId: "10", choices: ["10", "20"] }]);
  });

  it("counts a variant as its base song, once", () => {
    // 101 is "S1 (Ver.)" of base song 1; the list holds both.
    const draft = [entry(101, 1), entry(1), entry(2)];
    const proposal = deriveBoardProposal(draft, GROUPS, CATALOG);
    expect(proposal.map((p) => p.songId)).toEqual(["1", "2"]);
  });

  it("skips songs on no board group's catalog", () => {
    const proposal = deriveBoardProposal([entry(999), entry(6)], GROUPS, CATALOG);
    expect(proposal.map((p) => p.songId)).toEqual(["6"]);
  });

  it("an empty list proposes nothing", () => {
    expect(deriveBoardProposal([], GROUPS, CATALOG)).toEqual([]);
  });
});

describe("deriveBoardProposal — single-artist board", () => {
  it("the whole catalog belongs to the one group", () => {
    // Single-artist catalogs carry no festivalGroupIds.
    const catalog = [1, 2, 3, 4].map((id) => song(id));
    const draft = [4, 3, 2, 1].map((id) => entry(id));
    const proposal = deriveBoardProposal(draft, ["10"], catalog);
    expect(proposal).toEqual([
      { songId: "4", groupId: "10", choices: ["10"] },
      { songId: "3", groupId: "10", choices: ["10"] },
      { songId: "2", groupId: "10", choices: ["10"] },
    ]);
  });
});

describe("previewPublish", () => {
  it("splits current picks into kept / removed and the proposal's new ones into added", () => {
    const mine = [pick("10", "1"), pick("10", "2"), pick("20", "6")];
    const proposal = [
      { songId: "1", groupId: "10", choices: ["10"] },
      { songId: "3", groupId: "10", choices: ["10"] },
      { songId: "6", groupId: "20", choices: ["20"] },
    ];
    const preview = previewPublish(proposal, mine);
    expect(preview.kept.map((p) => p.songId)).toEqual(["1", "6"]);
    expect(preview.removed.map((p) => p.songId)).toEqual(["2"]);
    expect(preview.added.map((p) => p.songId)).toEqual(["3"]);
  });

  it("a song moving to another group is a removal plus an addition", () => {
    const mine = [pick("10", "9")];
    const proposal = [{ songId: "9", groupId: "20", choices: ["10", "20"] }];
    const preview = previewPublish(proposal, mine);
    expect(preview.kept).toEqual([]);
    expect(preview.removed.map((p) => p.songId)).toEqual(["9"]);
    expect(preview.added.map((p) => `${p.groupId}:${p.songId}`)).toEqual(["20:9"]);
  });
});
