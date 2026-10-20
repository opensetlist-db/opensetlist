import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { seriesPrimaryArtistOf } from "@/lib/board/boardGroups";
import { loadBoardGroups } from "@/lib/board/loadBoardGroups";
import { getAvailableSongsCached } from "@/lib/predict/availableSongs";
import { displayOriginalTitle } from "@/lib/display";
import {
  STARTER_PICKS_PER_GROUP,
  type StarterInputError,
} from "@/lib/board/starterPicks";
import type { AvailableSong } from "@/lib/types/predict";

// Admin is Korean-only (CLAUDE.md "Admin UI exemption"): labels,
// alerts and 4xx bodies are written in Korean. Each 4xx also carries a
// stable machine `code` so the editor (and tests) can branch on the
// failure without matching on prose.
export const ADMIN_LOCALE = "ko";

export function adminError(
  status: number,
  code: string,
  error: string,
): NextResponse {
  return NextResponse.json({ error, code }, { status });
}

export function parseEventId(id: string): bigint | null {
  try {
    const v = BigInt(id);
    return v > BigInt(0) ? v : null;
  } catch {
    return null;
  }
}

/** Current event row (uncached — the operator must see what they just
 *  saved, not a TTL-old copy) + its board groups. The groups go
 *  through the same CACHED loader the public board uses (roster,
 *  hierarchy, display rows), so the editor offers exactly the groups
 *  fans see — including the same up-to-one-TTL lag after a roster
 *  edit. That shared lag is the point: validating against fresher
 *  groups than the public board shows would accept starters for a
 *  group fans can't see yet. */
export async function loadAdminBoardContext(eventId: bigint) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, isDeleted: false },
    select: {
      id: true,
      boardEnabled: true,
      boardStarterSongIds: true,
      eventSeries: {
        select: { artist: { select: { id: true, isDeleted: true } } },
      },
    },
  });
  if (!event) return null;
  const primary = seriesPrimaryArtistOf(event.eventSeries);
  const groups = await loadBoardGroups({
    eventId,
    primaryArtistId: primary?.id ?? null,
    locale: ADMIN_LOCALE,
  });
  return { event, groups };
}

/** A group's base-song catalog — the same group-scoped list the public
 *  picker offers (base songs credited to the group or any descendant
 *  unit/solo, soft-deleted excluded). Cached at entity TTL. */
export function groupCatalog(groupId: string): Promise<AvailableSong[]> {
  return getAvailableSongsCached(BigInt(groupId), ADMIN_LOCALE);
}

export function catalogTitle(song: AvailableSong): string {
  return displayOriginalTitle(song, song.translations, ADMIN_LOCALE).main;
}

export function starterErrorMessage(e: StarterInputError): string {
  switch (e.code) {
    case "starter.notObject":
      return "starterSongIds: 그룹별 곡 ID 목록 객체여야 합니다.";
    case "starter.unknownGroup":
      return `starterSongIds: 이 이벤트의 보드 그룹이 아닙니다 (그룹 ${e.groupId}).`;
    case "starter.notArray":
      return `starterSongIds: 그룹 ${e.groupId}의 값은 곡 ID 배열이어야 합니다.`;
    case "starter.badSongId":
      return `starterSongIds: 그룹 ${e.groupId}에 잘못된 곡 ID가 있습니다.`;
    case "starter.duplicate":
      return `starterSongIds: 그룹 ${e.groupId}에 같은 곡(${e.songId})이 중복되었습니다.`;
    case "starter.tooMany":
      return `starterSongIds: 그룹 ${e.groupId} — 최대 ${STARTER_PICKS_PER_GROUP}곡까지입니다.`;
  }
}
