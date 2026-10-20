import { defaultLocale } from "@/i18n/routing";
import { prisma } from "@/lib/prisma";
import { displayOriginalTitle } from "@/lib/display";
import { getAvailableSongsCached } from "@/lib/predict/availableSongs";
import { loadBoardGroups } from "@/lib/board/loadBoardGroups";
import { BOARD_PICKS_PER_GROUP } from "@/lib/board/config";
import {
  BallotError,
  withBallotLock,
  type BoardWriteContext,
} from "@/lib/board/ballot";
import type { BoardMinePick } from "@/lib/board/types";

/**
 * Board pick (expected song) writes and the "mine" read (n15).
 *
 * The routes in `src/app/api/events/[id]/board/picks/**` and
 * `…/board/mine` stay thin (parse → control check → these); the rules
 * live here so the cap, the idempotent retry and the group-conflict
 * answer are written once.
 */

/** Ids of board picks are uuids; anything wildly off is not a pick id
 *  this app issued. Bounded so a junk path can't reach the query. */
export function isPickIdShape(value: string): boolean {
  return /^[0-9A-Za-z-]{1,64}$/.test(value);
}

export type PickCreateResult = {
  created: boolean;
  pick: { id: string; groupId: string; songId: string; createdAt: string };
};

/**
 * Static validation of a create — everything that does NOT depend on
 * the anon's ballot, so it runs before the advisory lock and keeps the
 * locked section to the few statements that must be serialized:
 *
 *   - the group must be one of this event's board groups (the same
 *     cached resolver the board read and the admin editor use) → 400
 *   - the song must exist and not be soft-deleted, read fresh (the
 *     catalog below is cached for an hour and would still offer a song
 *     moderated a minute ago) → 404
 *   - the song must be in the chosen group's base catalog (credited to
 *     the group or any descendant unit/solo, variants excluded) → 400.
 *     A cross-group song passes for each of its groups; it is then
 *     attributed to the chosen one only.
 */
export async function validatePickTarget(
  ctx: BoardWriteContext,
  groupId: bigint,
  songId: bigint,
): Promise<void> {
  // Locale only affects display rows; ids are the same in every
  // locale, and the default-locale entries are the ones most likely to
  // be warm already.
  const groups = await loadBoardGroups({
    eventId: ctx.eventId,
    primaryArtistId: ctx.primaryArtistId,
    locale: defaultLocale,
  });
  if (!groups.some((g) => BigInt(g.artistId) === groupId)) {
    throw new BallotError(400, "invalid_group");
  }
  const song = await prisma.song.findFirst({
    where: { id: songId, isDeleted: false },
    select: { id: true },
  });
  if (!song) throw new BallotError(404, "song_not_found");
  const catalog = await getAvailableSongsCached(groupId, defaultLocale);
  if (!catalog.some((s) => BigInt(s.songId) === songId)) {
    throw new BallotError(400, "song_outside_group");
  }
}

/**
 * Add one expected song to an anon's ballot, under the ballot lock:
 *
 *   - same (anon, song) already picked under the SAME group → the
 *     existing row, `created: false` (an exact retry — a double tap, a
 *     lost response — is not an error)
 *   - same (anon, song) under a DIFFERENT group → 409 `group_conflict`
 *     (moving a pick is remove + add; a create never silently
 *     reattributes a vote)
 *   - already `BOARD_PICKS_PER_GROUP` picks in that group → 409
 *     `cap_reached`. Picks whose song was soft-deleted since still
 *     count: they keep their slot until the fan removes them.
 *
 * The unique (event, anon, song) constraint backs the first rule even
 * if the lock were ever bypassed.
 */
export function createPick(
  eventId: bigint,
  anonId: string,
  groupId: bigint,
  songId: bigint,
): Promise<PickCreateResult> {
  return withBallotLock(eventId, anonId, async (tx) => {
    const existing = await tx.boardPick.findUnique({
      where: { eventId_anonId_songId: { eventId, anonId, songId } },
      select: { id: true, groupArtistId: true, createdAt: true },
    });
    if (existing) {
      if (existing.groupArtistId !== groupId) {
        throw new BallotError(409, "group_conflict");
      }
      return {
        created: false,
        pick: {
          id: existing.id,
          groupId: groupId.toString(),
          songId: songId.toString(),
          createdAt: existing.createdAt.toISOString(),
        },
      };
    }
    const inGroup = await tx.boardPick.count({
      where: { eventId, anonId, groupArtistId: groupId },
    });
    if (inGroup >= BOARD_PICKS_PER_GROUP) {
      throw new BallotError(409, "cap_reached");
    }
    const row = await tx.boardPick.create({
      data: { eventId, anonId, groupArtistId: groupId, songId },
      select: { id: true, createdAt: true },
    });
    return {
      created: true,
      pick: {
        id: row.id,
        groupId: groupId.toString(),
        songId: songId.toString(),
        createdAt: row.createdAt.toISOString(),
      },
    };
  });
}

/**
 * Remove one of the anon's picks, under the ballot lock. A pick of
 * another event, or a gone id → 404; another anon's pick → 403. The
 * song's state is not checked: a pick whose song was soft-deleted must
 * stay removable before lock.
 */
export function deletePick(
  eventId: bigint,
  anonId: string,
  pickId: string,
): Promise<{ id: string }> {
  return withBallotLock(eventId, anonId, async (tx) => {
    const pick = await tx.boardPick.findFirst({
      where: { id: pickId, eventId },
      select: { id: true, anonId: true },
    });
    if (!pick) throw new BallotError(404, "pick_not_found");
    if (pick.anonId !== anonId) throw new BallotError(403, "not_owner");
    await tx.boardPick.delete({ where: { id: pick.id } });
    return { id: pick.id };
  });
}

/**
 * The anon's own picks for one event — the client's fallback when its
 * local copy is gone. Uncached by design (it is personal; the route
 * serves it `private, no-store`). Soft-deleted songs are included and
 * flagged `available: false` so the fan can still see and remove them.
 */
export async function loadMinePicks(
  eventId: bigint,
  anonId: string,
  locale: string,
): Promise<BoardMinePick[]> {
  const rows = await prisma.boardPick.findMany({
    where: { eventId, anonId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      groupArtistId: true,
      songId: true,
      createdAt: true,
      song: {
        select: {
          isDeleted: true,
          originalTitle: true,
          originalLanguage: true,
          variantLabel: true,
          translations: {
            where: { locale },
            select: { locale: true, title: true, variantLabel: true },
          },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    groupId: r.groupArtistId.toString(),
    songId: r.songId.toString(),
    title: displayOriginalTitle(r.song, r.song.translations, locale).main,
    available: !r.song.isDeleted,
    createdAt: r.createdAt.toISOString(),
  }));
}
