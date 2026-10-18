/**
 * Operator starter picks (n15) — the `Event.boardStarterSongIds` JSON
 * map `{ "<groupId>": ["<songId>", …] }`.
 *
 * Pure (no Prisma / Next imports): the admin endpoint validates with
 * it, the board read parses with it, and both are unit-tested here.
 *
 * Why ids are decimal strings in the JSON: `Song.id` / `Artist.id` are
 * BigInt, JSON has no BigInt, and a JS number silently rounds past
 * 2^53. Strings round-trip exactly; consumers convert with `BigInt()`.
 */

import { isDecimalId } from "@/lib/board/ids";

export const STARTER_PICKS_PER_GROUP = 3;

export type StarterPickMap = Record<string, string[]>;

/**
 * Lenient read of the stored column. Anything malformed (a hand-edited
 * row, a shape from a future version) is dropped entry by entry rather
 * than failing the board read — a bad starter list must never take the
 * board down. Order within a group is preserved; duplicates and
 * entries past the cap are dropped.
 */
export function readStarterMap(json: unknown): StarterPickMap {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return {};
  }
  const out: StarterPickMap = {};
  for (const [groupId, songs] of Object.entries(json as Record<string, unknown>)) {
    if (!isDecimalId(groupId) || !Array.isArray(songs)) continue;
    const ids: string[] = [];
    for (const s of songs) {
      if (!isDecimalId(s) || ids.includes(s)) continue;
      ids.push(s);
      if (ids.length === STARTER_PICKS_PER_GROUP) break;
    }
    if (ids.length > 0) out[groupId] = ids;
  }
  return out;
}

export type StarterInputError =
  | { code: "starter.notObject" }
  | { code: "starter.unknownGroup"; groupId: string }
  | { code: "starter.notArray"; groupId: string }
  | { code: "starter.badSongId"; groupId: string }
  | { code: "starter.duplicate"; groupId: string; songId: string }
  | { code: "starter.tooMany"; groupId: string };

/**
 * Strict validation of an admin write. Unlike `readStarterMap` this
 * rejects instead of repairing — the operator should see why a save
 * failed, not have entries silently vanish.
 *
 * `groupIds` = the event's current board groups. A key outside it is
 * rejected (a starter list for a group the board doesn't show would be
 * dead data). Empty arrays are dropped from the result, and an
 * all-empty input normalizes to `null` (= "none configured"), so the
 * column has one representation of "nothing".
 *
 * Catalog membership (base song, belongs to that group) needs the DB
 * and is checked by the caller with `findStarterOutsideCatalog`.
 */
export function parseStarterInput(
  input: unknown,
  groupIds: readonly string[],
): { ok: true; value: StarterPickMap | null } | { ok: false; error: StarterInputError } {
  if (input === null) return { ok: true, value: null };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: { code: "starter.notObject" } };
  }
  const known = new Set(groupIds);
  const out: StarterPickMap = {};
  for (const [groupId, songs] of Object.entries(input as Record<string, unknown>)) {
    if (!known.has(groupId)) {
      return { ok: false, error: { code: "starter.unknownGroup", groupId } };
    }
    if (!Array.isArray(songs)) {
      return { ok: false, error: { code: "starter.notArray", groupId } };
    }
    if (songs.length > STARTER_PICKS_PER_GROUP) {
      return { ok: false, error: { code: "starter.tooMany", groupId } };
    }
    const ids: string[] = [];
    for (const s of songs) {
      if (!isDecimalId(s)) {
        return { ok: false, error: { code: "starter.badSongId", groupId } };
      }
      if (ids.includes(s)) {
        return { ok: false, error: { code: "starter.duplicate", groupId, songId: s } };
      }
      ids.push(s);
    }
    if (ids.length > 0) out[groupId] = ids;
  }
  return { ok: true, value: Object.keys(out).length > 0 ? out : null };
}

/**
 * First (group, song) whose song is not in that group's base-song
 * catalog, or null when all are. `catalogs` maps groupId → the set of
 * song ids the group-scoped picker offers (base songs credited to the
 * group or any of its sub-units/solos, not soft-deleted).
 */
export function findStarterOutsideCatalog(
  map: StarterPickMap,
  catalogs: ReadonlyMap<string, ReadonlySet<string>>,
): { groupId: string; songId: string } | null {
  for (const [groupId, songIds] of Object.entries(map)) {
    const catalog = catalogs.get(groupId);
    for (const songId of songIds) {
      if (!catalog?.has(songId)) return { groupId, songId };
    }
  }
  return null;
}
