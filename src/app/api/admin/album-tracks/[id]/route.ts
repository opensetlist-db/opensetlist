import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { verifyAdminAPI } from "@/lib/admin-auth";
import {
  isPattern2AlbumTrackVariant,
  isPattern3AlbumTrackVariant,
} from "@/lib/albumTrackVariants";
import {
  parseBigInt,
  parsePositiveInt,
  parsePattern3TrackTranslations,
} from "@/lib/adminParsers";

type RouteProps = { params: Promise<{ id: string }> };

type PatchBody = {
  pattern?: unknown;
  discNumber?: unknown;
  trackNumber?: unknown;
  songId?: unknown;
  parentSongId?: unknown;
  variant?: unknown;
  title?: unknown;
  titleLanguage?: unknown;
  translations?: unknown;
};

/**
 * PATCH /api/admin/album-tracks/[id]
 *
 *   Replaces the row's pattern + values. `albumId` is NOT mutable;
 *   moving tracks between albums goes through delete-then-create so
 *   the audit story (when a05 ships) is clear.
 *
 *   Pattern-dispatched body shape mirrors POST. Translations are
 *   replaced delete-then-create inside a $transaction.
 *
 *   Pattern transitions are allowed (e.g. an off-vocal mistakenly
 *   saved as direct/drama can be edited to off_vocal_w_parent).
 *   When transitioning OUT of Pattern 3, the AlbumTrackTranslation
 *   rows are deleted; when transitioning INTO Pattern 1 or 2 the
 *   title/titleLanguage columns are cleared so the row's display
 *   doesn't fall through to a stale string.
 */
export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "잘못된 ID입니다." }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "잘못된 JSON입니다." }, { status: 400 });
  }

  const discNumber = parsePositiveInt(body.discNumber);
  const trackNumber = parsePositiveInt(body.trackNumber);
  if (discNumber === null || trackNumber === null) {
    return NextResponse.json(
      { error: "디스크/트랙 번호가 잘못되었습니다." },
      { status: 400 },
    );
  }

  // Build the update payload per pattern. `clear` keys mean "set NULL"
  // — Prisma uses `null` for nullable scalar/relation reset.
  let scalarUpdate: Prisma.AlbumTrackUpdateInput;
  let pattern3Translations: { locale: string; title: string }[] = [];

  // Pattern 1/2 transitions always wipe AlbumTrackTranslation rows —
  // those rows are Pattern 3-only and would be stale after the move.
  // Pattern 3 stays-in-pattern is the nuanced case: if the operator's
  // PATCH body omits `translations` entirely (e.g. a thin curl that
  // only adjusts the title), the existing per-locale rows should be
  // preserved; an explicit `translations: []` is the only way to
  // clear them. Distinguishing "missing field" from "empty array"
  // lives here at the parse boundary.
  let pattern3TranslationsProvided = false;

  if (body.pattern === "vocal") {
    const songId = parseBigInt(body.songId);
    if (songId === null) {
      return NextResponse.json(
        { error: "보컬 곡을 선택해 주세요." },
        { status: 400 },
      );
    }
    scalarUpdate = {
      discNumber,
      trackNumber,
      song: { connect: { id: songId } },
      parentSong: { disconnect: true },
      variant: null,
      title: null,
      titleLanguage: null,
    };
  } else if (body.pattern === "off_vocal_w_parent") {
    if (
      typeof body.variant !== "string" ||
      !isPattern2AlbumTrackVariant(body.variant)
    ) {
      return NextResponse.json(
        { error: "패턴 2 변형이 잘못되었습니다." },
        { status: 400 },
      );
    }
    const parentSongId = parseBigInt(body.parentSongId);
    if (parentSongId === null) {
      return NextResponse.json(
        { error: "원곡 (보컬 부모)을 선택해 주세요." },
        { status: 400 },
      );
    }
    scalarUpdate = {
      discNumber,
      trackNumber,
      variant: body.variant,
      song: { disconnect: true },
      parentSong: { connect: { id: parentSongId } },
      title: null,
      titleLanguage: null,
    };
  } else if (body.pattern === "direct") {
    if (
      typeof body.variant !== "string" ||
      !isPattern3AlbumTrackVariant(body.variant)
    ) {
      return NextResponse.json(
        { error: "패턴 3 변형이 잘못되었습니다." },
        { status: 400 },
      );
    }
    if (typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json(
        { error: "원어 제목은 필수입니다." },
        { status: 400 },
      );
    }
    if (
      body.translations !== undefined &&
      !Array.isArray(body.translations)
    ) {
      return NextResponse.json(
        { error: "translations 필드는 배열이어야 합니다." },
        { status: 400 },
      );
    }
    pattern3TranslationsProvided = Array.isArray(body.translations);
    pattern3Translations = pattern3TranslationsProvided
      ? parsePattern3TrackTranslations(body.translations)
      : [];
    scalarUpdate = {
      discNumber,
      trackNumber,
      variant: body.variant,
      song: { disconnect: true },
      parentSong: { disconnect: true },
      title: body.title.trim(),
      titleLanguage:
        typeof body.titleLanguage === "string" && body.titleLanguage
          ? body.titleLanguage
          : "ja",
    };
  } else {
    return NextResponse.json(
      { error: "패턴이 잘못되었습니다." },
      { status: 400 },
    );
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.albumTrack.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) return null;

      // Wipe AlbumTrackTranslation when:
      //   - moving to Pattern 1/2 (translations are Pattern-3-only)
      //   - moving Pattern 3 → Pattern 3 with translations explicitly
      //     provided (full-replace semantic).
      // Skip wipe when Pattern 3 PATCH omits `translations` — that's
      // the "I'm just editing the title, leave my locale rows alone"
      // path.
      const shouldWipeTranslations =
        body.pattern !== "direct" || pattern3TranslationsProvided;
      if (shouldWipeTranslations) {
        await tx.albumTrackTranslation.deleteMany({
          where: { albumTrackId: id },
        });
      }

      return tx.albumTrack.update({
        where: { id },
        data: {
          ...scalarUpdate,
          translations: pattern3Translations.length
            ? { create: pattern3Translations }
            : undefined,
        },
        include: { translations: true },
      });
    });

    if (!updated) {
      return NextResponse.json(
        { error: "트랙을 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    return NextResponse.json(serializeBigInt(updated));
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "이 디스크/트랙 번호에 이미 다른 곡이 등록되어 있습니다." },
        { status: 409 },
      );
    }
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2025"
    ) {
      // P2025 here covers two cases: (a) the track itself was
      // deleted in a race between findUnique and update; (b) a
      // connect target (song / parentSong) doesn't resolve. The
      // first dominates the user-visible diagnostic — return 404
      // with the track-not-found message and stay consistent with
      // album-listings/[id]'s PATCH. The bad-FK case (b) on POST
      // is still 400 because there the track itself doesn't exist
      // yet.
      return NextResponse.json(
        { error: "트랙을 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    throw e;
  }
}

/**
 * DELETE /api/admin/album-tracks/[id]
 *
 *   Hard delete. Cascades to AlbumTrackTranslation per schema's
 *   onDelete: Cascade.
 */
export async function DELETE(_request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "잘못된 ID입니다." }, { status: 400 });
  }

  try {
    await prisma.albumTrack.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2025"
    ) {
      return NextResponse.json(
        { error: "트랙을 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    throw e;
  }
}
