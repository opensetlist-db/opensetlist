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
import {
  addSongCount,
  buildBoardColumn,
  mergeLegacyWishes,
  type BoardSongCount,
} from "@/lib/board/aggregate";
import {
  playedSongIds,
  tallyBoard,
  type SetlistSongRow,
} from "@/lib/board/tally";
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
 *   - `getBoardAggregateCached` — the per-group columns ("want" from
 *     wishes since n15-08, "expect" from picks). Own cache name
 *     and own tag (`event:<id>:board`), ~2 min TTL, never invalidated
 *     by a fan write (only the admin starter-pick save expires it).
 *     Keyed on event + locale + resolved status so the
 *     upcoming → completed transition is a fresh miss: the completed
 *     shape carries the post-show tally (n15-06).
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

/** A group's (already cached) base catalog as song id → localized
 *  title. Holds live base songs only, so a missing id means the song is
 *  gone from the group's catalog (soft-deleted, or became a variant). */
function catalogTitles(
  catalog: Awaited<ReturnType<typeof getAvailableSongsCached>>,
  locale: string,
): Map<string, string> {
  return new Map(
    catalog.map((s) => [
      String(s.songId),
      displayOriginalTitle(s, s.translations, locale).main,
    ]),
  );
}

/** Starter ids → display refs. A starter that is no longer in the
 *  catalog is dropped: starters are operator copy, not votes, so there
 *  is nothing to preserve. */
function starterRefs(
  songIds: readonly string[],
  titles: ReadonlyMap<string, string>,
): BoardSongRef[] {
  const out: BoardSongRef[] = [];
  for (const id of songIds) {
    const title = titles.get(id);
    if (title !== undefined) out.push({ songId: id, title });
  }
  return out;
}

/**
 * Fan picks of one event, grouped — the only two queries the aggregate
 * adds, both over `BoardPick`'s (eventId, groupArtistId) index:
 *
 *   - per (group, song): row count + first submission. One row per
 *     distinct picked song, not per pick; the ranking then keeps 3.
 *   - per group: distinct anon ids. `BoardPick.anonId` is NOT NULL, but
 *     the threshold rule is "distinct non-null anon ids" (legacy wish
 *     rows, which have none, join the board later), so the count is
 *     written that way.
 *
 * Raw SQL for the second because Prisma's `groupBy` has no
 * `COUNT(DISTINCT …)`; grouping by (group, anon) instead would ship one
 * row per participant just to count them.
 *
 * `before` (completed events only, n15-06) keeps just the picks that
 * existed at the lock, so the expect column — and the shortlist the
 * tally grades — is the board as it stood when picking closed, rebuilt
 * from the table rather than from whatever preview was cached last.
 * Writes are refused from the lock on, so in practice this drops
 * nothing; it pins the rule down instead of leaning on that.
 */
async function loadPickCounts(eventId: bigint, before?: Date) {
  const [songRows, participantRows] = await Promise.all([
    prisma.boardPick.groupBy({
      by: ["groupArtistId", "songId"],
      where: before ? { eventId, createdAt: { lt: before } } : { eventId },
      _count: { _all: true },
      _min: { createdAt: true },
    }),
    before
      ? prisma.$queryRaw<{ groupArtistId: bigint; participants: number }[]>`
          SELECT "groupArtistId", COUNT(DISTINCT "anonId")::int AS "participants"
          FROM "BoardPick"
          WHERE "eventId" = ${eventId} AND "anonId" IS NOT NULL
            AND "createdAt" < ${before}
          GROUP BY "groupArtistId"
        `
      : prisma.$queryRaw<{ groupArtistId: bigint; participants: number }[]>`
          SELECT "groupArtistId", COUNT(DISTINCT "anonId")::int AS "participants"
          FROM "BoardPick"
          WHERE "eventId" = ${eventId} AND "anonId" IS NOT NULL
          GROUP BY "groupArtistId"
        `,
  ]);
  const songsByGroup = new Map<string, BoardSongCount[]>();
  for (const r of songRows) {
    const groupId = String(r.groupArtistId);
    const list = songsByGroup.get(groupId) ?? [];
    list.push({
      songId: String(r.songId),
      count: r._count._all,
      // `_min` is null only for an empty group, which groupBy never returns.
      firstAt: r._min.createdAt ?? new Date(0),
    });
    songsByGroup.set(groupId, list);
  }
  const participantsByGroup = new Map(
    participantRows.map((r) => [String(r.groupArtistId), Number(r.participants)]),
  );
  return { songsByGroup, participantsByGroup };
}

/**
 * Wishes of one event, grouped (n15-08) — the same two queries as the
 * picks, over `SongWish`, plus the legacy split:
 *
 *   - per (group, song): count + first submission. Rows written on the
 *     board carry their chosen group; LEGACY rows (pre-n15-08, no anon
 *     id, no group) come back under a null group and are returned
 *     separately for read-time attribution.
 *   - per group: distinct non-null anon ids. Legacy rows have none, so
 *     they count as submissions and never as participants.
 *
 * A legacy wish may name a variant (the old wishlist searched every
 * song); the board's catalogs hold base songs only, so a third query
 * folds each legacy song id onto its base before attribution. It runs
 * only when legacy rows exist and is bounded by their distinct songs
 * (a handful). Folded ids are summed, so a variant and its base wished
 * the legacy way land in one row.
 */
async function loadWishCounts(eventId: bigint) {
  const [songRows, participantRows] = await Promise.all([
    prisma.songWish.groupBy({
      by: ["groupArtistId", "songId"],
      where: { eventId },
      _count: { _all: true },
      _min: { createdAt: true },
    }),
    prisma.$queryRaw<{ groupArtistId: bigint; participants: number }[]>`
      SELECT "groupArtistId", COUNT(DISTINCT "anonId")::int AS "participants"
      FROM "SongWish"
      WHERE "eventId" = ${eventId}
        AND "anonId" IS NOT NULL
        AND "groupArtistId" IS NOT NULL
      GROUP BY "groupArtistId"
    `,
  ]);
  const songsByGroup = new Map<string, BoardSongCount[]>();
  const legacyRaw: BoardSongCount[] = [];
  for (const r of songRows) {
    const row: BoardSongCount = {
      songId: String(r.songId),
      count: r._count._all,
      firstAt: r._min.createdAt ?? new Date(0),
    };
    if (r.groupArtistId === null) {
      legacyRaw.push(row);
      continue;
    }
    const groupId = String(r.groupArtistId);
    const list = songsByGroup.get(groupId) ?? [];
    list.push(row);
    songsByGroup.set(groupId, list);
  }

  const legacy = new Map<string, BoardSongCount>();
  if (legacyRaw.length > 0) {
    const songs = await prisma.song.findMany({
      where: { id: { in: legacyRaw.map((r) => BigInt(r.songId)) } },
      select: { id: true, baseVersionId: true },
    });
    const baseOf = new Map(
      songs.map((s) => [String(s.id), String(s.baseVersionId ?? s.id)]),
    );
    for (const r of legacyRaw) {
      const songId = baseOf.get(r.songId) ?? r.songId;
      const prev = legacy.get(songId);
      if (!prev) {
        legacy.set(songId, { ...r, songId });
        continue;
      }
      addSongCount(prev, r);
    }
  }

  const participantsByGroup = new Map(
    participantRows.map((r) => [String(r.groupArtistId), Number(r.participants)]),
  );
  return { songsByGroup, participantsByGroup, legacy: [...legacy.values()] };
}

/**
 * The final setlist's songs, one row per `SetlistItemSong` (a medley is
 * several rows) — completed events only (n15-06). Same item filter as
 * the share card's actual setlist: every live (non-deleted) item.
 * Song soft-deletion is NOT filtered: a shortlisted song moderated away
 * after the show still counts as played if the setlist names it.
 */
async function loadSetlistSongs(eventId: bigint): Promise<SetlistSongRow[]> {
  const rows = await prisma.setlistItemSong.findMany({
    where: { setlistItem: { eventId, isDeleted: false } },
    select: { songId: true, song: { select: { baseVersionId: true } } },
  });
  return rows.map((r) => ({
    songId: String(r.songId),
    baseVersionId:
      r.song.baseVersionId === null ? null : String(r.song.baseVersionId),
  }));
}

// `-v3` since n15-06 added the tally to the completed shape (`-v2`:
// n15-08's want column). The data cache outlives a deploy, and an entry
// written by the previous release must not reach the new client. A new
// name is a clean miss.
export const getBoardAggregateCached = cachedQuery(
  "event-board-v3",
  async (eventId: bigint, locale: string, status: AggregateStatus) => {
    const control = await getBoardControlCached(eventId);
    const primary = seriesPrimaryArtistOf(control?.eventSeries);
    // The lock is the start time (the write path refuses picks from
    // then on). An early wrap-up — stored status flipped to completed
    // before the start — refused writes from that flip, so every row is
    // already before the start and the cutoff drops nothing.
    const lockAt =
      status === "completed" && control ? new Date(control.startTime) : undefined;
    const [groups, counts, wishCounts, setlistSongs] = await Promise.all([
      loadBoardGroups({
        eventId,
        primaryArtistId: primary?.id ?? null,
        locale,
      }),
      loadPickCounts(eventId, lockAt),
      loadWishCounts(eventId),
      // The tally is computed here, inside the cached loader, and only
      // for a completed event: an upcoming board has nothing to grade,
      // and an ongoing one never reaches the aggregate at all.
      lockAt ? loadSetlistSongs(eventId) : Promise.resolve(null),
    ]);
    const starters = readStarterMap(control?.boardStarterSongIds ?? null);
    // Titles come from the group's (already cached) base catalog — the
    // same entry the event page's picker reads — so the aggregate adds
    // no song query for titles. Loaded only for groups that have
    // something to title — or for every group while legacy wishes
    // exist, since attributing them needs every catalog. A board with
    // no starters, picks or wishes does no catalog reads.
    const hasLegacy = wishCounts.legacy.length > 0;
    const catalogs = await Promise.all(
      groups.map((g) => {
        const groupId = String(g.artistId);
        return hasLegacy ||
          starters[groupId] ||
          counts.songsByGroup.has(groupId) ||
          wishCounts.songsByGroup.has(groupId)
          ? getAvailableSongsCached(BigInt(g.artistId), locale)
          : Promise.resolve([]);
      }),
    );
    // Legacy wish → the FIRST group in board (roster) order whose base
    // catalog holds the song. A catalog is "credited to the group or
    // any of its units/solos", i.e. exactly the songs whose root is
    // that group. A song in no catalog (soft-deleted, or credited
    // outside the roster) stays out of every column.
    let wishesByGroup = wishCounts.songsByGroup;
    if (hasLegacy) {
      // song id → first group (roster order) whose catalog holds it;
      // later groups never overwrite an earlier one.
      const groupOfSong = new Map<string, string>();
      groups.forEach((g, i) => {
        for (const s of catalogs[i]) {
          const id = String(s.songId);
          if (!groupOfSong.has(id)) groupOfSong.set(id, String(g.artistId));
        }
      });
      wishesByGroup = mergeLegacyWishes(
        wishCounts.songsByGroup,
        wishCounts.legacy,
        (songId) => groupOfSong.get(songId) ?? null,
      );
    }
    // Picks and wishes filed under a group that is no longer on this
    // board (roster edit) simply have no column to land in; they stay
    // in the table.
    const views: BoardGroupView[] = groups.map((g, i) => {
      const groupId = String(g.artistId);
      const titles = catalogTitles(catalogs[i], locale);
      const titleOf = (songId: string) => titles.get(songId) ?? null;
      return {
        groupId,
        slug: g.slug,
        name: g.label,
        color: g.color,
        wishes: buildBoardColumn(
          wishesByGroup.get(groupId) ?? [],
          wishCounts.participantsByGroup.get(groupId) ?? 0,
          titleOf,
        ),
        expects: buildBoardColumn(
          counts.songsByGroup.get(groupId) ?? [],
          counts.participantsByGroup.get(groupId) ?? 0,
          titleOf,
        ),
        starters: starterRefs(starters[groupId] ?? [], titles),
      };
    });
    // Each group's shortlist is its expect column's TOP3 — built above
    // from at-lock picks with the 04 ranking — never the starters.
    const tally =
      setlistSongs === null
        ? null
        : tallyBoard(
            views.map((v) => ({ groupId: v.groupId, top: v.expects.top })),
            playedSongIds(setlistSongs),
          );
    // Computation time, not request time: on a cache hit this is when
    // the counts were taken, which is what "as of" promises the reader.
    return { asOf: new Date(), groups: views, tally };
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
  const asOf = new Date(aggregate.asOf).toISOString();
  if (status === "completed") {
    // Completed is always locked, even when the operator flipped the
    // stored status before the scheduled start (an early wrap-up).
    return {
      enabled: true,
      status,
      locked: true,
      lockAt,
      asOf,
      groups: aggregate.groups,
      // The completed key always computes a tally; it is null only if
      // the control row vanished between the two cached reads (event
      // deleted mid-request). Grade nothing rather than fail the read.
      tally: aggregate.tally ?? {
        played: 0,
        size: 0,
        groups: [],
        playedSongIds: [],
      },
    };
  }
  return {
    enabled: true,
    status,
    locked: now.getTime() >= startTime.getTime(),
    lockAt,
    asOf,
    groups: aggregate.groups,
  };
}
