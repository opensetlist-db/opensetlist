import { defaultLocale } from "@/i18n/routing";
import { prisma } from "@/lib/prisma";
import { getAvailableSongsCached } from "@/lib/predict/availableSongs";
import { loadBoardGroups } from "@/lib/board/loadBoardGroups";
import { BOARD_PICKS_PER_GROUP } from "@/lib/board/config";
import { parseDecimalId } from "@/lib/board/ids";
import {
  BallotError,
  withBallotLock,
  type BoardWriteContext,
} from "@/lib/board/ballot";
import type { BoardPickCreated } from "@/lib/board/types";

/**
 * Publish a whole ballot at once (n15-09b) — the write behind "put on
 * the board": the fan's edited proposal REPLACES their expected songs
 * for the event in one transaction.
 *
 * Same building blocks and contract as the single-pick routes
 * (`picks.ts`): fresh control check, static validation outside the
 * lock, then `withBallotLock` for everything that reads the ballot.
 * What differs is that the resulting set is fully given by the request,
 * so the cap is checked on the request itself (per group ≤ 3) and the
 * locked section is a diff: delete what is no longer there, insert
 * what is new, leave the rest untouched.
 */

export interface PublishPickInput {
  groupId: bigint;
  songId: bigint;
}

/**
 * Upper bound on the array before any per-item work. A real ballot is
 * at most 3 × the board's groups (a six-group festival → 18); anything
 * far above that is not this client, and the bound keeps a junk body
 * from turning into a long validation loop.
 */
export const MAX_PUBLISH_PICKS = 64;

export type ParsedPublish =
  | { ok: true; picks: PublishPickInput[] }
  | {
      ok: false;
      code: "invalid_body" | "invalid_group" | "invalid_song" | "duplicate_song";
    };

/**
 * Parse `picks: [{ groupId, songId }]`. A song listed twice — under
 * one group or two — is refused (400 `duplicate_song`): (event, anon,
 * song) is unique, and a crossover is counted under exactly one group,
 * so a request naming it twice cannot be honoured as written.
 */
export function parsePublishPicks(raw: unknown): ParsedPublish {
  if (!Array.isArray(raw) || raw.length > MAX_PUBLISH_PICKS) {
    return { ok: false, code: "invalid_body" };
  }
  const picks: PublishPickInput[] = [];
  const seen = new Set<bigint>();
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, code: "invalid_body" };
    }
    const { groupId: rawGroup, songId: rawSong } = item as Record<string, unknown>;
    const groupId = parseDecimalId(rawGroup);
    if (groupId === null) return { ok: false, code: "invalid_group" };
    const songId = parseDecimalId(rawSong);
    if (songId === null) return { ok: false, code: "invalid_song" };
    if (seen.has(songId)) return { ok: false, code: "duplicate_song" };
    seen.add(songId);
    picks.push({ groupId, songId });
  }
  return { ok: true, picks };
}

/** More than `BOARD_PICKS_PER_GROUP` in any one group → 409
 *  `cap_reached`, the same answer a fourth single add gets. */
export function assertPublishCaps(picks: readonly PublishPickInput[]): void {
  const perGroup = new Map<bigint, number>();
  for (const p of picks) {
    const n = (perGroup.get(p.groupId) ?? 0) + 1;
    if (n > BOARD_PICKS_PER_GROUP) throw new BallotError(409, "cap_reached");
    perGroup.set(p.groupId, n);
  }
}

/**
 * Static validation of every target — the batch form of
 * `validatePickTarget`, with the same rules and codes:
 *
 *   - each group is one of this event's board groups → else 400
 *     `invalid_group`
 *   - each song exists and is not soft-deleted (read fresh, one query
 *     for all) → else 404 `song_not_found`
 *   - each song is in its chosen group's base catalog → else 400
 *     `song_outside_group`
 *
 * Runs before the advisory lock: the catalogs come from cached loaders
 * that would take a second pool connection while the ballot
 * transaction holds one (see `withBallotLock`).
 */
export async function validatePublishTargets(
  ctx: BoardWriteContext,
  picks: readonly PublishPickInput[],
): Promise<void> {
  if (picks.length === 0) return;
  const groups = await loadBoardGroups({
    eventId: ctx.eventId,
    primaryArtistId: ctx.primaryArtistId,
    locale: defaultLocale,
  });
  const boardGroups = new Set(groups.map((g) => BigInt(g.artistId)));
  if (picks.some((p) => !boardGroups.has(p.groupId))) {
    throw new BallotError(400, "invalid_group");
  }
  const songIds = picks.map((p) => p.songId);
  const alive = await prisma.song.findMany({
    where: { id: { in: songIds }, isDeleted: false },
    select: { id: true },
  });
  if (alive.length !== songIds.length) {
    throw new BallotError(404, "song_not_found");
  }
  const groupIds = [...new Set(picks.map((p) => p.groupId))];
  const catalogs = new Map<bigint, Set<bigint>>();
  for (const g of groupIds) {
    const catalog = await getAvailableSongsCached(g, defaultLocale);
    catalogs.set(g, new Set(catalog.map((s) => BigInt(s.songId))));
  }
  if (picks.some((p) => !catalogs.get(p.groupId)?.has(p.songId))) {
    throw new BallotError(400, "song_outside_group");
  }
}

/**
 * Replace the anon's picks for the event with `picks`, under the
 * ballot lock (one transaction — a failure anywhere rolls the whole
 * publish back and the previous set stands):
 *
 *   - a current pick with the same song AND group is retained as is —
 *     same row id, same `createdAt` (the aggregate and the post-show
 *     tally see it as the vote it always was)
 *   - every other current pick is deleted, including a song that moves
 *     to another group: that is a new vote under the new group, so it
 *     is re-created with a fresh timestamp (deletes run first, so the
 *     unique (event, anon, song) never sees both rows)
 *   - an empty `picks` clears the ballot
 *
 * Returns the whole resulting ballot, oldest first — the order
 * `/board/mine` uses.
 */
export function publishPicks(
  eventId: bigint,
  anonId: string,
  picks: readonly PublishPickInput[],
): Promise<BoardPickCreated[]> {
  return withBallotLock(eventId, anonId, async (tx) => {
    const current = await tx.boardPick.findMany({
      where: { eventId, anonId },
      select: { id: true, groupArtistId: true, songId: true, createdAt: true },
    });
    const key = (groupId: bigint, songId: bigint) => `${groupId}:${songId}`;
    const wanted = new Set(picks.map((p) => key(p.groupId, p.songId)));
    const retained = current.filter((r) => wanted.has(key(r.groupArtistId, r.songId)));
    const retainedKeys = new Set(retained.map((r) => key(r.groupArtistId, r.songId)));
    const stale = current.filter((r) => !retainedKeys.has(key(r.groupArtistId, r.songId)));
    if (stale.length > 0) {
      await tx.boardPick.deleteMany({
        where: { id: { in: stale.map((r) => r.id) } },
      });
    }
    const fresh = picks.filter((p) => !retainedKeys.has(key(p.groupId, p.songId)));
    const created =
      fresh.length > 0
        ? await tx.boardPick.createManyAndReturn({
            data: fresh.map((p) => ({
              eventId,
              anonId,
              groupArtistId: p.groupId,
              songId: p.songId,
            })),
            select: { id: true, groupArtistId: true, songId: true, createdAt: true },
          })
        : [];
    return [...retained, ...created]
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .map((r) => ({
        id: r.id,
        groupId: r.groupArtistId.toString(),
        songId: r.songId.toString(),
        createdAt: r.createdAt.toISOString(),
      }));
  });
}
