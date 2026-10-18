import { prisma } from "@/lib/prisma";
import {
  CACHE_TTL,
  cachedQuery,
  eventBoardControlTag,
  eventBoardTag,
  eventTag,
} from "@/lib/dataCache";
import { displayOriginalTitle } from "@/lib/display";
import { getEventStatus } from "@/lib/eventStatus";
import { getAvailableSongsCached } from "@/lib/predict/availableSongs";
import { seriesPrimaryArtistOf } from "@/lib/board/boardGroups";
import { loadBoardGroups } from "@/lib/board/loadBoardGroups";
import { readStarterMap } from "@/lib/board/starterPicks";
import { boardColumnLabel } from "@/lib/board/thresholds";
import type {
  BoardGroupView,
  BoardReadResponse,
  BoardSongRef,
} from "@/lib/board/types";

/**
 * Fan board read (n15) — control check first, aggregate second.
 *
 * Two cached reads with different jobs:
 *
 *   - `getBoardControlCached` — the board's control metadata (flag,
 *     stored status, start time, series artist, starter picks). Event
 *     TTL, tagged with the event tag AND its own control tag, which
 *     the admin board write expires — so the kill switch reaches the
 *     next board read. This is the ONE board read allowed while a
 *     show is ongoing.
 *   - `getBoardAggregateCached` — the per-group columns. Own cache name
 *     and own tag (`event:<id>:board`), ~2 min TTL, never invalidated
 *     by a write. Keyed on event + locale + resolved status so the
 *     upcoming → completed transition is a fresh miss (the completed
 *     shape will carry the tally).
 *
 * `resolveBoardRead` runs the control check BEFORE touching the
 * aggregate, so a disabled board or an ongoing/cancelled event costs
 * one cached row read and nothing else.
 */

export const getBoardControlCached = cachedQuery(
  "event-board-control",
  (eventId: bigint) =>
    prisma.event.findFirst({
      where: { id: eventId, isDeleted: false },
      select: {
        boardEnabled: true,
        boardStarterSongIds: true,
        status: true,
        startTime: true,
        eventSeries: {
          select: { artist: { select: { id: true, isDeleted: true } } },
        },
      },
    }),
  {
    revalidate: CACHE_TTL.event,
    // `eventTag`: event writes (status, startTime) refresh it like the
    // event row. `eventBoardControlTag`: the admin board write expires
    // ONLY this entry, so turning the board off reaches the very next
    // board read — no event/global invalidation needed for that.
    tags: (eventId) => [eventTag(eventId), eventBoardControlTag(eventId)],
  },
);

type AggregateStatus = "upcoming" | "completed";

/** Starter ids → display refs via the group's (already cached) base
 *  catalog. A starter that is no longer in the catalog (soft-deleted,
 *  or became a variant) is dropped: starters are operator copy, not
 *  votes, so there is nothing to preserve. */
function starterRefs(
  songIds: readonly string[],
  catalog: Awaited<ReturnType<typeof getAvailableSongsCached>>,
  locale: string,
): BoardSongRef[] {
  const byId = new Map(catalog.map((s) => [String(s.songId), s]));
  const out: BoardSongRef[] = [];
  for (const id of songIds) {
    const s = byId.get(id);
    if (!s) continue;
    out.push({
      songId: id,
      title: displayOriginalTitle(s, s.translations, locale).main,
    });
  }
  return out;
}

export const getBoardAggregateCached = cachedQuery(
  "event-board",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `_status` is key-only for now (the completed shape gains the tally in n15-06)
  async (eventId: bigint, locale: string, _status: AggregateStatus) => {
    const control = await getBoardControlCached(eventId);
    const primary = seriesPrimaryArtistOf(control?.eventSeries);
    const groups = await loadBoardGroups({
      eventId,
      primaryArtistId: primary?.id ?? null,
      locale,
    });
    const starters = readStarterMap(control?.boardStarterSongIds ?? null);
    // Catalogs only for groups that actually have starters — the
    // common "no starters configured" board does no catalog reads.
    const catalogs = await Promise.all(
      groups.map((g) =>
        starters[String(g.artistId)]
          ? getAvailableSongsCached(BigInt(g.artistId), locale)
          : Promise.resolve([]),
      ),
    );
    const views: BoardGroupView[] = groups.map((g, i) => {
      const groupId = String(g.artistId);
      // Fan picks arrive in n15-03/04; until then every expect column
      // has zero submissions and is therefore an operator column.
      const submissions = 0;
      const participants = 0;
      return {
        groupId,
        slug: g.slug,
        name: g.label,
        color: g.color,
        expects: {
          top: [],
          submissions,
          participants,
          label: boardColumnLabel(submissions, participants),
        },
        starters: starterRefs(starters[groupId] ?? [], catalogs[i], locale),
      };
    });
    return { asOf: new Date(), groups: views };
  },
  {
    revalidate: CACHE_TTL.board,
    tags: (eventId) => [eventBoardTag(eventId)],
  },
);

/**
 * The full board read for one request. `null` = no such (live) event.
 * `now` is injected so the status / lock boundary is testable at UTC
 * instants.
 */
export async function resolveBoardRead(
  eventId: bigint,
  locale: string,
  now: Date = new Date(),
): Promise<BoardReadResponse | null> {
  const control = await getBoardControlCached(eventId);
  if (!control) return null;
  if (!control.boardEnabled) return { enabled: false };

  const status = getEventStatus(control, now);
  const startTime = new Date(control.startTime);
  const lockAt = startTime.toISOString();
  if (status === "ongoing" || status === "cancelled") {
    return { enabled: true, status, locked: true, lockAt };
  }

  const aggregate = await getBoardAggregateCached(eventId, locale, status);
  return {
    enabled: true,
    status,
    // Completed is always locked, even when the operator flipped the
    // stored status before the scheduled start (an early wrap-up).
    locked: status === "completed" || now.getTime() >= startTime.getTime(),
    lockAt,
    asOf: new Date(aggregate.asOf).toISOString(),
    groups: aggregate.groups,
  };
}
