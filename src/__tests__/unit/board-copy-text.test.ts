import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import ja from "../../../messages/ja.json";
import ko from "../../../messages/ko.json";
import { buildBoardCopyText } from "@/lib/board/copyText";
import type { StoredBoardPick } from "@/lib/board/pickStorage";

const MESSAGES = { en, ja, ko } as const;

function tFor(locale: keyof typeof MESSAGES) {
  return createTranslator({
    locale,
    messages: MESSAGES[locale],
    namespace: "Board",
  });
}

const GROUPS = [
  { groupId: "1", slug: "hasunosora", name: "蓮ノ空" },
  { groupId: "2", slug: "liella", name: "Liella!" },
  { groupId: "3", slug: "aqours", name: "Aqours" },
];

function pick(id: string, groupId: string, songId: string, title: string): StoredBoardPick {
  return { id, groupId, songId, title, available: true };
}

// Added out of board order on purpose: the text follows the board's
// group order, and within a group the order the fan added them.
const PICKS = [
  pick("p3", "3", "30", "未体験HORIZON"),
  pick("p1", "1", "10", "Dream Believers"),
  pick("p2", "1", "11", "残陽"),
];

const BASE = {
  eventName: "ラブライブ！フェス Day.1",
  url: "https://opensetlist.com/ja/events/107/lovelive-fes-day1#board-aqours",
  groups: GROUPS,
  picks: PICKS,
};

const textOf = (args: Parameters<typeof buildBoardCopyText>[0]) =>
  buildBoardCopyText(args)?.text ?? null;

describe("buildBoardCopyText", () => {
  it("ja: event + day, picks by group in board order, skipped group omitted, link last", () => {
    expect(textOf({ ...BASE, t: tFor("ja") })).toBe(
      [
        "ラブライブ！フェス Day.1 セトリ予想 (OpenSetlist)",
        "蓮ノ空: Dream Believers / 残陽",
        "Aqours: 未体験HORIZON",
        "https://opensetlist.com/ja/events/107/lovelive-fes-day1#board-aqours",
      ].join("\n"),
    );
  });

  it("ko", () => {
    expect(
      textOf({
        ...BASE,
        eventName: "러브라이브! 페스 Day.1",
        url: "https://opensetlist.com/ko/events/107/lovelive-fes-day1#board-hasunosora",
        t: tFor("ko"),
      }),
    ).toBe(
      [
        "러브라이브! 페스 Day.1 세트리스트 예상 (OpenSetlist)",
        "蓮ノ空: Dream Believers / 残陽",
        "Aqours: 未体験HORIZON",
        "https://opensetlist.com/ko/events/107/lovelive-fes-day1#board-hasunosora",
      ].join("\n"),
    );
  });

  it("en, every group picked (no skipped group)", () => {
    expect(
      textOf({
        ...BASE,
        eventName: "Love Live! Fes Day.1",
        url: "https://opensetlist.com/en/events/107/lovelive-fes-day1#board-liella",
        picks: [...PICKS, pick("p4", "2", "20", "始まりは君の空")],
        t: tFor("en"),
      }),
    ).toBe(
      [
        "Love Live! Fes Day.1 setlist predictions (OpenSetlist)",
        "蓮ノ空: Dream Believers / 残陽",
        "Liella!: 始まりは君の空",
        "Aqours: 未体験HORIZON",
        "https://opensetlist.com/en/events/107/lovelive-fes-day1#board-liella",
      ].join("\n"),
    );
  });

  // Each locale both ways: with a skipped group (above) and without.
  it("ja and ko without a skipped group; en with one", () => {
    const all = [...PICKS, pick("p4", "2", "20", "始まりは君の空")];
    expect(textOf({ ...BASE, picks: all, t: tFor("ja") })).toBe(
      [
        "ラブライブ！フェス Day.1 セトリ予想 (OpenSetlist)",
        "蓮ノ空: Dream Believers / 残陽",
        "Liella!: 始まりは君の空",
        "Aqours: 未体験HORIZON",
        BASE.url,
      ].join("\n"),
    );
    expect(textOf({ ...BASE, eventName: "페스 Day.1", picks: all, t: tFor("ko") })).toBe(
      [
        "페스 Day.1 세트리스트 예상 (OpenSetlist)",
        "蓮ノ空: Dream Believers / 残陽",
        "Liella!: 始まりは君の空",
        "Aqours: 未体験HORIZON",
        BASE.url,
      ].join("\n"),
    );
    expect(textOf({ ...BASE, eventName: "Fes Day.1", t: tFor("en") })).toBe(
      [
        "Fes Day.1 setlist predictions (OpenSetlist)",
        "蓮ノ空: Dream Believers / 残陽",
        "Aqours: 未体験HORIZON",
        BASE.url,
      ].join("\n"),
    );
  });

  it("titleOf re-localizes a stored title (the board's title wins over add-time text)", () => {
    const text = textOf({
      ...BASE,
      picks: [pick("p1", "1", "10", "Dream Believers (old)")],
      titleOf: (p) => (p.songId === "10" ? "Dream Believers" : null),
      t: tFor("ja"),
    });
    expect(text).toContain("蓮ノ空: Dream Believers\n");
  });

  it("unavailable picks and picks of groups not on the board are left out", () => {
    const text = textOf({
      ...BASE,
      picks: [
        pick("p1", "1", "10", "Dream Believers"),
        { ...pick("p2", "1", "11", "残陽"), available: false },
        pick("p9", "99", "90", "Ghost"),
      ],
      t: tFor("ja"),
    });
    expect(text).toBe(
      [
        "ラブライブ！フェス Day.1 セトリ予想 (OpenSetlist)",
        "蓮ノ空: Dream Believers",
        BASE.url,
      ].join("\n"),
    );
  });

  it("count is the number of songs in the text (board_copy's count)", () => {
    expect(
      buildBoardCopyText({
        ...BASE,
        picks: [...PICKS, { ...pick("p5", "2", "21", "gone"), available: false }],
        t: tFor("ja"),
      })?.count,
    ).toBe(3);
  });

  it("null when nothing is copyable", () => {
    expect(textOf({ ...BASE, picks: [], t: tFor("ja") })).toBeNull();
    expect(
      textOf({
        ...BASE,
        picks: [{ ...pick("p1", "1", "10", "x"), available: false }],
        t: tFor("ja"),
      }),
    ).toBeNull();
  });
});
