import { prisma } from "@/lib/prisma";
import { displayOriginalTitle } from "@/lib/display";
import { BOARD_WISHES_PER_GROUP } from "@/lib/board/config";
import { BallotError, withBallotLock } from "@/lib/board/ballot";
import type { BoardMineWish } from "@/lib/board/types";

/**
 * Per-group wish writes and the "mine" read on board-enabled events
 * (n15-08).
 *
 * Wishes keep living in `SongWish` (no second table, no dual write):
 * the board path only adds the anon id and the chosen group to the
 * row, and enforces on the server what the legacy wishlist left to
 * localStorage. The rules are the expected-song pick rules
 * (`src/lib/board/picks.ts`) applied to the wish table — same cap,
 * same idempotent retry, same group-conflict answer, same advisory
 * lock (one lock per ballot covers both kinds, so a fan's wish and
 * pick writes serialize with each other too).
 *
 * Target validation (group on this board, song alive, song in the
 * group's base catalog) is shared with picks: `validatePickTarget`.
 *
 * Legacy rows (anonId NULL — written by the pre-n15-08 wishlist) are
 * never touched here except by an explicit delete of that row's id:
 * they are never adopted into an anon's ballot, never counted toward
 * an anon's cap, and never returned by "mine".
 */

/** Wish ids are uuids; same bounded shape check as pick ids. */
export function isWishIdShape(value: string): boolean {
  return /^[0-9A-Za-z-]{1,64}$/.test(value);
}

export type WishCreateResult = {
  created: boolean;
  wish: { id: string; groupId: string; songId: string; createdAt: string };
};

/**
 * Add one wish to an anon's ballot, under the ballot lock:
 *
 *   - same (anon, song) already wished under the SAME group → the
 *     existing row, `created: false` (an exact retry is not an error)
 *   - same (anon, song) under a DIFFERENT group → 409 `group_conflict`
 *   - already `BOARD_WISHES_PER_GROUP` wishes in that group → 409
 *     `cap_reached`. Only this anon's rows count: legacy rows have no
 *     anon id, so they can never fill a new fan's slots.
 *
 * The unique (event, anon, song) constraint backs the first rule even
 * if the lock were ever bypassed.
 */
export function createWish(
  eventId: bigint,
  anonId: string,
  groupId: bigint,
  songId: bigint,
): Promise<WishCreateResult> {
  return withBallotLock(eventId, anonId, async (tx) => {
    const existing = await tx.songWish.findUnique({
      where: { eventId_anonId_songId: { eventId, anonId, songId } },
      select: { id: true, groupArtistId: true, createdAt: true },
    });
    if (existing) {
      if (existing.groupArtistId !== groupId) {
        throw new BallotError(409, "group_conflict");
      }
      return {
        created: false,
        wish: {
          id: existing.id,
          groupId: groupId.toString(),
          songId: songId.toString(),
          createdAt: existing.createdAt.toISOString(),
        },
      };
    }
    const inGroup = await tx.songWish.count({
      where: { eventId, anonId, groupArtistId: groupId },
    });
    if (inGroup >= BOARD_WISHES_PER_GROUP) {
      throw new BallotError(409, "cap_reached");
    }
    const row = await tx.songWish.create({
      data: { eventId, anonId, groupArtistId: groupId, songId },
      select: { id: true, createdAt: true },
    });
    return {
      created: true,
      wish: {
        id: row.id,
        groupId: groupId.toString(),
        songId: songId.toString(),
        createdAt: row.createdAt.toISOString(),
      },
    };
  });
}

/**
 * Remove a wish on a board-enabled event, under the ballot lock when
 * the caller names an anon.
 *
 *   - a wish of another event, or a gone id → 404 `wish_not_found`
 *     (the client treats it as "already gone")
 *   - a row WITH an anon id → only that anon may remove it: no anon in
 *     the request, or a different one → 403 `not_owner`
 *   - a LEGACY row (anon id NULL) → removable by whoever holds its id,
 *     exactly as before n15-08 (the id lives in that browser's local
 *     wishlist). It is deleted as-is; nothing is re-attributed to the
 *     caller.
 *
 * `anonId` is null when the request carried none (an old client's
 * plain DELETE). Such a request can still remove a legacy row; it is
 * not serialized on a ballot lock because it touches no ballot — a
 * legacy row counts toward nobody's cap.
 */
export async function deleteWish(
  eventId: bigint,
  anonId: string | null,
  wishId: string,
): Promise<{ id: string }> {
  // One conditional delete instead of find-then-delete: the anonymous
  // path holds no lock, so two concurrent deletes of the same legacy
  // row (double tap, two tabs) would both pass a find and the second
  // `delete` would throw P2025 → 500. With `deleteMany` the loser simply
  // removes nothing and is told why below.
  const remove = async (tx: Pick<typeof prisma, "songWish">) => {
    const { count } = await tx.songWish.deleteMany({
      where: {
        id: wishId,
        eventId,
        OR: anonId === null ? [{ anonId: null }] : [{ anonId: null }, { anonId }],
      },
    });
    if (count > 0) return { id: wishId };
    // Nothing deleted: gone (or another event's) → 404; still there →
    // it belongs to another anon → 403.
    const still = await tx.songWish.findFirst({
      where: { id: wishId, eventId },
      select: { id: true },
    });
    if (!still) throw new BallotError(404, "wish_not_found");
    throw new BallotError(403, "not_owner");
  };
  if (anonId === null) return remove(prisma);
  return withBallotLock(eventId, anonId, remove);
}

/**
 * The anon's own board wishes for one event — the client's fallback
 * when its local copy is gone. Personal and uncached (served
 * `private, no-store`). Legacy rows are never included: they have no
 * owner on record, and returning them would hand them to whichever
 * browser asked. Soft-deleted songs stay, flagged `available: false`.
 */
export async function loadMineWishes(
  eventId: bigint,
  anonId: string,
  locale: string,
): Promise<BoardMineWish[]> {
  const rows = await prisma.songWish.findMany({
    where: { eventId, anonId, groupArtistId: { not: null } },
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
  return rows.flatMap((r) =>
    r.groupArtistId === null
      ? []
      : [
          {
            id: r.id,
            groupId: r.groupArtistId.toString(),
            songId: r.songId.toString(),
            title: displayOriginalTitle(r.song, r.song.translations, locale).main,
            available: !r.song.isDeleted,
            createdAt: r.createdAt.toISOString(),
          },
        ],
  );
}
