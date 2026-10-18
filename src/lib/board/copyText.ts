import type { StoredBoardPick } from "@/lib/board/pickStorage";

/**
 * "Copy my picks" text of the fan board (n15-05): an X-ready post in
 * the viewer's locale.
 *
 *   {event} セトリ予想 (OpenSetlist)
 *   蓮ノ空: Dream Believers / 残陽
 *   Aqours: 未体験HORIZON
 *   https://opensetlist.com/ja/events/107/…#board-aqours
 *
 * Every word and every piece of punctuation comes from `Board.*`
 * message keys (`copyTemplate`, `copyLine`, `copySongSeparator`), so a
 * locale can reorder or re-punctuate without touching this module.
 *
 * Content rules:
 *   - Expected songs only — wishes are never passed in.
 *   - Groups follow the board's order (roster order), not the order the
 *     fan picked in; within a group, the order the picks were added.
 *   - A group with no copyable pick is omitted entirely (a skipped
 *     group must not read as "I expect nothing from them").
 *   - Unavailable picks (soft-deleted songs) are dropped: the song page
 *     is gone and the title may be stale.
 *   - A pick whose group isn't on the board any more is dropped rather
 *     than printed under an id.
 *
 * Returns the text and the number of songs in it (the `board_copy`
 * count), or null when nothing is copyable — so the caller disables
 * the button on exactly the condition the text would be empty, and the
 * analytics count can't drift from what was copied.
 *
 * No length budget: six groups × three songs can exceed one X post,
 * and the product promises nothing about that.
 */

type BoardT = (
  key: "copyTemplate" | "copyLine" | "copySongSeparator",
  values?: Record<string, string>,
) => string;

export function buildBoardCopyText({
  t,
  eventName,
  url,
  groups,
  picks,
  titleOf,
}: {
  t: BoardT;
  /** Localized event name with the day ("… Day.1"). */
  eventName: string;
  /** Absolute canonical event URL, fragment included. */
  url: string;
  /** The board's groups, in board order. */
  groups: readonly { groupId: string; name: string }[];
  picks: readonly StoredBoardPick[];
  /** The current-locale title for a pick, or null to keep the stored
   *  (add-time) title. Lets the text match what the board shows after
   *  a locale switch. */
  titleOf?: (pick: StoredBoardPick) => string | null;
}): { text: string; count: number } | null {
  const separator = t("copySongSeparator");
  const lines: string[] = [];
  let count = 0;
  for (const g of groups) {
    const titles = picks
      .filter((p) => p.groupId === g.groupId && p.available)
      .map((p) => titleOf?.(p) || p.title)
      .filter((title) => title.length > 0);
    if (titles.length === 0) continue;
    count += titles.length;
    lines.push(t("copyLine", { group: g.name, songs: titles.join(separator) }));
  }
  if (lines.length === 0) return null;
  return {
    text: t("copyTemplate", { event: eventName, picks: lines.join("\n"), url }),
    count,
  };
}
