import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { parseJsonBody } from "@/lib/admin-input";
import { prisma } from "@/lib/prisma";
import { revalidateEventData } from "@/lib/dataCache";
import { lockEvent } from "@/lib/liveBroadcast";

type Props = { params: Promise<{ id: string }> };
const MAX_ID = BigInt("9223372036854775807");
function idOf(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^[1-9]\d{0,18}$/.test(value)) return null;
  const id = BigInt(value);
  return id <= MAX_ID ? id : null;
}
function error(status: number, code: string, message: string) {
  return NextResponse.json({ error: message, code }, { status });
}

// This endpoint changes only festival prediction-catalog eligibility.
// Event PUT/import do not replace these assignments, and a settings save
// neither modifies the roster nor bumps/broadcasts a setlist revision.
export async function GET(_request: NextRequest, { params }: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;
  const eventId = idOf((await params).id);
  if (eventId === null) return error(400, "invalid_event_id", "잘못된 이벤트 ID입니다.");
  try {
    const event = await prisma.event.findFirst({
      where: { id: eventId, isDeleted: false },
      select: { collaborationArtists: { select: { artistId: true } } },
    });
    if (!event) return error(404, "not_found", "이벤트를 찾을 수 없습니다.");
    const artists = await prisma.artist.findMany({
      where: { isDeleted: false, isSideProject: true, parentArtistId: null },
      select: { id: true, originalName: true, translations: { where: { locale: "ko" }, select: { name: true } } },
      orderBy: { id: "asc" },
    });
    const selected = new Set(event.collaborationArtists.map((row) => String(row.artistId)));
    return NextResponse.json({
      artists: artists.map((artist) => ({
        artistId: String(artist.id),
        label: artist.translations[0]?.name ?? artist.originalName,
        included: selected.has(String(artist.id)),
      })),
    });
  } catch (err) {
    console.error("[event-collaborations] load failed", err);
    return error(500, "load_failed", "협업 그룹 설정을 불러오지 못했습니다.");
  }
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;
  const eventId = idOf((await params).id);
  if (eventId === null) return error(400, "invalid_event_id", "잘못된 이벤트 ID입니다.");
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const raw = parsed.body.artistIds;
  if (!Array.isArray(raw) || raw.some((id) => idOf(id) === null)) {
    return error(400, "invalid_artist_ids", "artistIds: 유효한 아티스트 ID 문자열 배열이 필요합니다.");
  }
  const artistIds = raw.map((id) => idOf(id)!);
  if (new Set(artistIds).size !== artistIds.length) {
    return error(400, "duplicate_artist_ids", "협업 그룹을 중복 지정할 수 없습니다.");
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Serialize replacement with other event edits/deletion. A plain
      // read-then-replace transaction alone does not protect the event.
      await lockEvent(tx, eventId);
      const event = await tx.event.findFirst({ where: { id: eventId, isDeleted: false }, select: { id: true } });
      if (!event) return "missing";
      const eligible = await tx.artist.count({
        where: { id: { in: artistIds }, isDeleted: false, isSideProject: true, parentArtistId: null },
      });
      if (eligible !== artistIds.length) return "invalid";
      await tx.event.update({
        where: { id: eventId },
        data: { collaborationArtists: { deleteMany: {}, create: artistIds.map((artistId) => ({ artistId })) } },
        select: { id: true },
      });
      return "saved";
    }, { maxWait: 2_000, timeout: 8_000 });
    if (result === "missing") return error(404, "not_found", "이벤트를 찾을 수 없습니다.");
    if (result === "invalid") return error(400, "invalid_collaboration", "삭제되지 않은 최상위 협업 그룹만 지정할 수 있습니다.");
    revalidateEventData(eventId);
    return NextResponse.json({ artistIds: artistIds.map(String) });
  } catch (err) {
    console.error("[event-collaborations] save failed", err);
    return error(500, "save_failed", "협업 그룹 설정을 저장하지 못했습니다.");
  }
}
