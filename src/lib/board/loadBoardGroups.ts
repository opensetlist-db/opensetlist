import { getArtistHierarchyCached } from "@/lib/artistHierarchy";
import { joinIdKey } from "@/lib/dataCache";
import { getEventRoster } from "@/lib/eventRoster";
import { getFestivalGroupArtistsCached } from "@/lib/predict/availableSongs";
import {
  boardGroupRootIds,
  boardGroupsFromRows,
  type BoardGroup,
} from "@/lib/board/boardGroups";
import type { EventRosterEntry } from "@/lib/types/setlist";

/**
 * The event's board groups, loaded — the server half of the n15-01
 * resolver, shared by the event page (chips), the board read route and
 * the admin board endpoint so all three show the same groups in the
 * same order.
 *
 * Display rows are ALWAYS loaded for the resolved root ids, on both
 * branches. On a single-artist event the series artist may be a
 * sub-unit (a Cerise Bouquet solo series): its root is a different
 * artist whose row the caller does not hold, and without loading it
 * `boardGroupsFromRows` would drop the only group — the board would
 * have no chip. Loading by root id makes that case the same as every
 * other; the read is the same tiny cached one the festival picker uses
 * (keyed on the sorted id set, so it is shared across days/pages).
 *
 * `roster` is optional so a caller that already holds it (the page)
 * doesn't pay a second cache lookup; the single-artist branch never
 * needs it.
 */
export async function loadBoardGroups({
  eventId,
  primaryArtistId,
  locale,
  roster,
}: {
  eventId: bigint;
  primaryArtistId: bigint | number | string | null;
  locale: string;
  roster?: readonly EventRosterEntry[];
}): Promise<BoardGroup[]> {
  const [hierarchy, resolvedRoster] = await Promise.all([
    getArtistHierarchyCached(),
    primaryArtistId !== null
      ? Promise.resolve(roster ?? [])
      : roster
        ? Promise.resolve(roster)
        : getEventRoster(eventId, locale),
  ]);
  const rootIds = boardGroupRootIds({
    roster: resolvedRoster,
    hierarchy,
    primaryArtistId,
  });
  if (rootIds.length === 0) return [];
  const rows = await getFestivalGroupArtistsCached(
    joinIdKey([...rootIds].sort((a, b) => Number(a) - Number(b))),
    locale,
  );
  return boardGroupsFromRows(rootIds, rows, locale);
}
