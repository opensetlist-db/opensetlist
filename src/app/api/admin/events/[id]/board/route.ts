import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { parseJsonBody } from "@/lib/admin-input";
import {
  revalidateBoardAggregate,
  revalidateBoardControl,
} from "@/lib/dataCache";
import {
  findStarterOutsideCatalog,
  parseStarterInput,
  readStarterMap,
} from "@/lib/board/starterPicks";
import {
  adminError,
  catalogTitle,
  groupCatalog,
  loadAdminBoardContext,
  parseEventId,
  starterErrorMessage,
} from "./_shared";

type Props = { params: Promise<{ id: string }> };

/**
 * Fan board settings (n15) — the operator's flag + starter picks.
 *
 *   GET   /api/admin/events/[id]/board
 *     → { boardEnabled, groups: [{ groupId, label, color,
 *         starters: [{ songId, title, inCatalog }] }] }
 *   PATCH /api/admin/events/[id]/board
 *     body { boardEnabled?: boolean,
 *            starterSongIds?: { [groupId]: songId[] } | null }
 *
 * Deliberately NOT part of the admin event PUT. That save runs inside
 * the live writer transaction and, after it, expires the global
 * public-data tag and the event tag — which also throws away the live
 * snapshot entries. Board settings change nothing the live path
 * serves, so this endpoint does a plain single-row update and expires
 * only the board's own entries (control row; aggregate when starters
 * change): the board read (the kill switch
 * that matters — it also gates every write) sees the change on its
 * next request; the event page picks the flag up through the event-row
 * TTL (`CACHE_TTL.event`), and a page still showing a just-disabled
 * board hides it as soon as its read answers `{ enabled: false }`.
 */

export async function GET(_request: NextRequest, { params }: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const eventId = parseEventId((await params).id);
  if (eventId === null) {
    return adminError(400, "invalid_event_id", "잘못된 이벤트 ID입니다.");
  }
  const ctx = await loadAdminBoardContext(eventId);
  if (!ctx) return adminError(404, "not_found", "이벤트를 찾을 수 없습니다.");

  const stored = readStarterMap(ctx.event.boardStarterSongIds);
  const catalogs = await Promise.all(
    ctx.groups.map((g) =>
      stored[String(g.artistId)] ? groupCatalog(String(g.artistId)) : [],
    ),
  );
  const groups = ctx.groups.map((g, i) => {
    const groupId = String(g.artistId);
    const byId = new Map(catalogs[i].map((s) => [String(s.songId), s]));
    return {
      groupId,
      label: g.label,
      color: g.color,
      // A stored id that fell out of the catalog (song soft-deleted or
      // turned into a variant) is still listed — flagged — so the
      // operator can see and remove it; the public board drops it.
      starters: (stored[groupId] ?? []).map((songId) => {
        const s = byId.get(songId);
        return s
          ? { songId, title: catalogTitle(s), inCatalog: true }
          : { songId, title: `#${songId}`, inCatalog: false };
      }),
    };
  });
  return NextResponse.json({ boardEnabled: ctx.event.boardEnabled, groups });
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const eventId = parseEventId((await params).id);
  if (eventId === null) {
    return adminError(400, "invalid_event_id", "잘못된 이벤트 ID입니다.");
  }
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const hasFlag = "boardEnabled" in body;
  const hasStarters = "starterSongIds" in body;
  if (!hasFlag && !hasStarters) {
    return adminError(
      400,
      "empty_patch",
      "boardEnabled 또는 starterSongIds 중 하나는 있어야 합니다.",
    );
  }
  if (hasFlag && typeof body.boardEnabled !== "boolean") {
    return adminError(
      400,
      "invalid_flag",
      "boardEnabled는 true 또는 false여야 합니다.",
    );
  }

  const ctx = await loadAdminBoardContext(eventId);
  if (!ctx) return adminError(404, "not_found", "이벤트를 찾을 수 없습니다.");

  let starterValue: Record<string, string[]> | null | undefined;
  if (hasStarters) {
    const groupIds = ctx.groups.map((g) => String(g.artistId));
    const check = parseStarterInput(body.starterSongIds, groupIds);
    if (!check.ok) {
      return adminError(400, check.error.code, starterErrorMessage(check.error));
    }
    starterValue = check.value;
    if (starterValue) {
      const entries = Object.keys(starterValue);
      const catalogs = await Promise.all(entries.map((g) => groupCatalog(g)));
      const catalogSets = new Map(
        entries.map((g, i) => [g, new Set(catalogs[i].map((s) => String(s.songId)))]),
      );
      const outside = findStarterOutsideCatalog(starterValue, catalogSets);
      if (outside) {
        return adminError(
          400,
          "starter.outsideCatalog",
          `starterSongIds: 곡 ${outside.songId} — 그룹 ${outside.groupId}의 기본곡 목록에 없는 곡입니다 (변형곡·삭제곡·다른 그룹 곡 불가).`,
        );
      }
    }
  }

  const updated = await prisma.event.update({
    where: { id: eventId },
    data: {
      ...(hasFlag ? { boardEnabled: body.boardEnabled as boolean } : {}),
      ...(hasStarters
        ? { boardStarterSongIds: starterValue ?? Prisma.DbNull }
        : {}),
    },
    select: { boardEnabled: true, boardStarterSongIds: true },
  });
  // Board entries only — never the event tag or the global tag, so
  // nothing the live path serves is expired. The control row always
  // (the next board read sees the new flag); the aggregate too when
  // starters changed, since it carries their resolved titles and would
  // otherwise serve the old starters for up to one board TTL.
  revalidateBoardControl(eventId);
  if (hasStarters) revalidateBoardAggregate(eventId);
  return NextResponse.json({
    boardEnabled: updated.boardEnabled,
    starterSongIds: readStarterMap(updated.boardStarterSongIds),
  });
}
