// Pure rules of the post-show tally (n15-06): which songs count as
// played, and how each group's frozen shortlist is graded.
import { describe, expect, it } from "vitest";
import { buildBoardColumn, type BoardSongCount } from "@/lib/board/aggregate";
import { playedSongIds, tallyBoard } from "@/lib/board/tally";

const at = (iso: string) => new Date(iso);
const row = (songId: string, count: number, firstAt = "2026-11-01T00:00:00Z") =>
  ({ songId, count, firstAt: at(firstAt) }) satisfies BoardSongCount;
const titled = (id: string) => `song ${id}`;

/** A group's shortlist exactly as the loader builds it: the expect
 *  column's TOP3 over the at-lock picks. */
function shortlist(
  groupId: string,
  rows: BoardSongCount[],
  titleOf: (id: string) => string | null = titled,
) {
  return { groupId, top: buildBoardColumn(rows, 10, titleOf).top };
}

describe("playedSongIds", () => {
  it("holds every setlist song and the base of every variant", () => {
    const played = playedSongIds([
      { songId: "10", baseVersionId: null },
      { songId: "21", baseVersionId: "20" },
    ]);
    expect([...played].sort()).toEqual(["10", "20", "21"]);
  });

  it("is empty for an empty setlist", () => {
    expect(playedSongIds([]).size).toBe(0);
  });
});

describe("tallyBoard", () => {
  it("grades each shortlist song and counts N of K per group", () => {
    const tally = tallyBoard(
      [shortlist("1", [row("10", 5), row("11", 4), row("12", 3), row("13", 1)])],
      playedSongIds([
        { songId: "10", baseVersionId: null },
        { songId: "13", baseVersionId: null },
      ]),
    );
    const [g] = tally.groups;
    expect(g.shortlist.map((e) => [e.songId, e.played])).toEqual([
      ["10", true],
      ["11", false],
      ["12", false],
    ]);
    // 13 was played but never made the shortlist: not graded.
    expect([g.played, g.size]).toEqual([1, 3]);
    expect([tally.played, tally.size]).toEqual([1, 3]);
  });

  it("ties resolve by the 04 ranking (earlier first pick, then id) — deterministic", () => {
    const rows = [
      row("30", 2, "2026-11-02T00:00:00Z"),
      row("31", 2, "2026-11-01T00:00:00Z"),
      row("29", 1, "2026-11-01T00:00:00Z"),
      row("28", 1, "2026-11-01T00:00:00Z"),
    ];
    const a = tallyBoard([shortlist("1", rows)], new Set());
    const b = tallyBoard([shortlist("1", [...rows].reverse())], new Set());
    expect(a.groups[0].shortlist.map((e) => e.songId)).toEqual(["31", "30", "28"]);
    expect(b).toEqual(a);
  });

  it("a group with fewer than three picks has K below three", () => {
    const tally = tallyBoard(
      [shortlist("1", [row("10", 1)])],
      playedSongIds([{ songId: "10", baseVersionId: null }]),
    );
    expect([tally.groups[0].played, tally.groups[0].size]).toEqual([1, 1]);
  });

  it("a group with no picks has an empty shortlist and adds nothing to K", () => {
    const tally = tallyBoard(
      [shortlist("1", []), shortlist("2", [row("20", 1)])],
      new Set(),
    );
    expect(tally.groups[0]).toEqual({
      groupId: "1",
      shortlist: [],
      played: 0,
      size: 0,
    });
    expect([tally.played, tally.size]).toEqual([0, 1]);
  });

  it("a song shortlisted under two groups counts once overall", () => {
    const tally = tallyBoard(
      [
        shortlist("1", [row("10", 3), row("11", 2)]),
        shortlist("2", [row("10", 1), row("20", 1)]),
      ],
      playedSongIds([{ songId: "10", baseVersionId: null }]),
    );
    expect(tally.groups.map((g) => [g.played, g.size])).toEqual([
      [1, 2],
      [1, 2],
    ]);
    expect([tally.played, tally.size]).toEqual([1, 3]);
  });

  it("a variant in the setlist hits its shortlisted base", () => {
    const tally = tallyBoard(
      [shortlist("1", [row("10", 1)])],
      playedSongIds([{ songId: "99", baseVersionId: "10" }]),
    );
    expect(tally.groups[0].shortlist[0].played).toBe(true);
  });

  it("a medley containing the song hits it", () => {
    // One setlist item, several songs: each arrives as its own row.
    const tally = tallyBoard(
      [shortlist("1", [row("10", 2), row("11", 1)])],
      playedSongIds([
        { songId: "50", baseVersionId: null },
        { songId: "11", baseVersionId: null },
        { songId: "51", baseVersionId: null },
      ]),
    );
    expect(tally.groups[0].shortlist.map((e) => e.played)).toEqual([false, true]);
  });

  it("zero hits grades every song ✗", () => {
    const tally = tallyBoard(
      [shortlist("1", [row("10", 1), row("11", 1)])],
      playedSongIds([{ songId: "77", baseVersionId: null }]),
    );
    expect(tally.groups[0].shortlist.every((e) => !e.played)).toBe(true);
    expect([tally.played, tally.size]).toEqual([0, 2]);
  });

  it("a soft-deleted song keeps its slot, counts toward K and can still be played", () => {
    const tally = tallyBoard(
      [
        shortlist("1", [row("10", 3), row("11", 2)], (id) =>
          id === "10" ? null : titled(id),
        ),
      ],
      playedSongIds([{ songId: "10", baseVersionId: null }]),
    );
    const [deleted] = tally.groups[0].shortlist;
    expect(deleted).toMatchObject({ songId: "10", available: false, played: true });
    expect([tally.played, tally.size]).toEqual([1, 2]);
  });
});
