// Fan board crowd aggregate: the pure ranking and column rules. The
// same ranking decides the post-show shortlist, so
// ties are pinned here with literal expectations.
import { describe, it, expect } from "vitest";
import { buildExpectColumn, rankBoardSongs } from "@/lib/board/aggregate";

const at = (iso: string) => new Date(`2026-10-${iso}Z`);

describe("rankBoardSongs", () => {
  it("count desc, then earliest first submission, then song id", () => {
    const ranked = rankBoardSongs([
      { songId: "30", count: 2, firstAt: at("20T00:00:00") },
      { songId: "10", count: 5, firstAt: at("22T00:00:00") },
      { songId: "21", count: 2, firstAt: at("19T00:00:00") },
      { songId: "9", count: 2, firstAt: at("19T00:00:00") },
      { songId: "40", count: 1, firstAt: at("01T00:00:00") },
    ]);
    // 10 leads on count; 21 and 9 tie on count AND first submission →
    // song id decides numerically (9 < 21, not "21" < "9"); 30 has a
    // later first submission and falls off the TOP3.
    expect(ranked.map((r) => r.songId)).toEqual(["10", "9", "21"]);
  });

  it("returns fewer than three when fewer songs were picked", () => {
    expect(
      rankBoardSongs([{ songId: "5", count: 1, firstAt: at("20T00:00:00") }]),
    ).toEqual([{ songId: "5", count: 1, firstAt: at("20T00:00:00") }]);
    expect(rankBoardSongs([])).toEqual([]);
  });

});

describe("buildExpectColumn", () => {
  const titles: Record<string, string> = { "10": "残陽", "11": "ハナムスビ", "12": "Dream Believers" };
  const titleOf = (id: string) => titles[id] ?? null;

  it("zero submissions → operator column, nothing ranked", () => {
    expect(buildExpectColumn([], 0, titleOf)).toEqual({
      top: [],
      submissions: 0,
      participants: 0,
      label: "operator",
    });
  });

  it("1–4 participants → early sample; submissions count every row", () => {
    const col = buildExpectColumn(
      [
        { songId: "10", count: 3, firstAt: at("20T00:00:00") },
        { songId: "11", count: 1, firstAt: at("20T00:00:00") },
      ],
      3,
      titleOf,
    );
    expect(col).toEqual({
      top: [
        { songId: "10", title: "残陽", count: 3, available: true },
        { songId: "11", title: "ハナムスビ", count: 1, available: true },
      ],
      submissions: 4,
      participants: 3,
      label: "early",
    });
  });

  it("four participants is still early; five is ok", () => {
    const rows = [{ songId: "10", count: 5, firstAt: at("20T00:00:00") }];
    expect(buildExpectColumn(rows, 4, titleOf).label).toBe("early");
    expect(buildExpectColumn(rows, 5, titleOf).label).toBe("ok");
  });

  it("legacy-style rows (submissions without participants) are early, not operator", () => {
    const col = buildExpectColumn(
      [{ songId: "10", count: 2, firstAt: at("20T00:00:00") }],
      0,
      titleOf,
    );
    expect(col.label).toBe("early");
    expect(col.submissions).toBe(2);
    expect(col.participants).toBe(0);
  });

  it("bounded to three rows; submissions still total all of them", () => {
    const col = buildExpectColumn(
      [
        { songId: "10", count: 4, firstAt: at("20T00:00:00") },
        { songId: "11", count: 3, firstAt: at("20T00:00:00") },
        { songId: "12", count: 2, firstAt: at("20T00:00:00") },
        { songId: "13", count: 1, firstAt: at("20T00:00:00") },
      ],
      6,
      titleOf,
    );
    expect(col.top.map((e) => e.songId)).toEqual(["10", "11", "12"]);
    expect(col.submissions).toBe(10);
    expect(col.label).toBe("ok");
  });

  it("a song missing from the catalog (soft-deleted) keeps its vote and slot, unavailable", () => {
    const col = buildExpectColumn(
      [
        { songId: "99", count: 4, firstAt: at("20T00:00:00") },
        { songId: "10", count: 1, firstAt: at("20T00:00:00") },
      ],
      5,
      titleOf,
    );
    expect(col.top).toEqual([
      { songId: "99", title: "", count: 4, available: false },
      { songId: "10", title: "残陽", count: 1, available: true },
    ]);
  });
});
