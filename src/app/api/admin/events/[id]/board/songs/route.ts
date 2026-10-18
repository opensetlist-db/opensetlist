import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAPI } from "@/lib/admin-auth";
import {
  adminError,
  catalogTitle,
  groupCatalog,
  loadAdminBoardContext,
  parseEventId,
} from "../_shared";

type Props = { params: Promise<{ id: string }> };

const MAX_RESULTS = 30;

/**
 * Group-scoped base-song search for the starter-pick editor (n15).
 *
 *   GET /api/admin/events/[id]/board/songs?groupId=…&q=…
 *     → { songs: [{ songId, title }] }   (≤ 30, catalog order)
 *
 * Searches the group's cached base catalog in memory rather than the
 * generic song search: the catalog is exactly what the PATCH validates
 * against (base songs only, the group and all its units/solos), so the
 * editor can never offer a song the save would reject. `groupId` must
 * be one of the event's board groups.
 */
export async function GET(request: NextRequest, { params }: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const eventId = parseEventId((await params).id);
  if (eventId === null) {
    return adminError(400, "invalid_event_id", "잘못된 이벤트 ID입니다.");
  }
  const url = new URL(request.url);
  const groupId = url.searchParams.get("groupId") ?? "";
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

  const ctx = await loadAdminBoardContext(eventId);
  if (!ctx) return adminError(404, "not_found", "이벤트를 찾을 수 없습니다.");
  if (!ctx.groups.some((g) => String(g.artistId) === groupId)) {
    return adminError(400, "unknown_group", "이 이벤트의 보드 그룹이 아닙니다.");
  }

  const catalog = await groupCatalog(groupId);
  const songs = [];
  for (const s of catalog) {
    if (q) {
      const haystack = [s.originalTitle, ...s.translations.map((t) => t.title)]
        .join("\n")
        .toLowerCase();
      if (!haystack.includes(q)) continue;
    }
    songs.push({ songId: String(s.songId), title: catalogTitle(s) });
    if (songs.length === MAX_RESULTS) break;
  }
  return NextResponse.json({ songs });
}
