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
import { revalidatePublicData } from "@/lib/dataCache";
import { albumTrackTitleError, trackTitleSnapshot } from "@/lib/albumTrackTitleValidation";

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
  confirmedSameLocales?: unknown;
  expectedTitleSnapshot?: unknown;
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
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
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
  let directTitle: string | undefined;
  let directLanguage: string | undefined;
  let directTranslations: { locale: string; title: string }[] | undefined;

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
    if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim())) {
      return NextResponse.json(
        { error: "원어 제목은 필수입니다." },
        { status: 400 },
      );
    }
    const translations = parsePattern3TrackTranslations(body.translations);
    if (!translations) {
      return NextResponse.json(
        { error: "트랙 표기의 언어와 제목을 확인해 주세요. 같은 언어는 한 번만 입력할 수 있습니다." },
        { status: 400 },
      );
    }
    directTitle = typeof body.title === "string" ? body.title.trim() : undefined;
    directLanguage = typeof body.titleLanguage === "string" ? body.titleLanguage.trim() || undefined : undefined;
    directTranslations = body.translations === undefined ? undefined : translations;
    scalarUpdate = {
      discNumber,
      trackNumber,
      variant: body.variant,
      song: { disconnect: true },
      parentSong: { disconnect: true },
    };
  } else {
    return NextResponse.json(
      { error: "패턴이 잘못되었습니다." },
      { status: 400 },
    );
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Validate and replace against the same row state when admin edits overlap.
      await tx.$queryRaw`SELECT id FROM "AlbumTrack" WHERE id = ${id} FOR UPDATE`;
      const existing = await tx.albumTrack.findUnique({
        where: { id },
        include: { translations: true },
      });
      if (!existing) return null;
      if (body.expectedTitleSnapshot !== undefined &&
          body.expectedTitleSnapshot !== trackTitleSnapshot(existing)) {
        return { error: "다른 곳에서 트랙 제목이 변경되었습니다. 새로고침 후 다시 저장해 주세요.", status: 409 };
      }

      let replaceTranslations = body.pattern !== "direct";
      if (body.pattern === "direct") {
        const wasDirect = existing.songId === null && existing.parentSongId === null &&
          existing.variant !== null && isPattern3AlbumTrackVariant(existing.variant);
        const oldTitle = wasDirect ? existing.title : null;
        const oldLanguage = wasDirect ? existing.titleLanguage : null;
        const title = directTitle === undefined || directTitle === oldTitle?.trim()
          ? oldTitle
          : directTitle;
        if (!title?.trim()) return { error: "원어 제목은 필수입니다." };

        const language = directLanguage ?? oldLanguage ?? "ja";
        const translations = directTranslations ?? (wasDirect ? existing.translations : []);
        replaceTranslations = !wasDirect || (directTranslations !== undefined &&
          (translations.length !== existing.translations.length ||
            translations.some(({ locale, title }) =>
              !existing.translations.some((row) => row.locale === locale && row.title.trim() === title)
            )));
        const languageChanged = language !== (oldLanguage ?? "ja");
        if (!wasDirect || title !== oldTitle || languageChanged || replaceTranslations) {
          const error = albumTrackTitleError(
            title,
            language,
            replaceTranslations ? translations : existing.translations,
            body.confirmedSameLocales,
          );
          if (error) return { error };
        }
        scalarUpdate.title = title === oldTitle ? undefined : title;
        scalarUpdate.titleLanguage = !wasDirect || languageChanged ? language : undefined;
      }

      if (replaceTranslations) {
        // eslint-disable-next-line no-restricted-syntax -- legacy delete+create; migrate to per-locale upsert (retro n15)
        await tx.albumTrackTranslation.deleteMany({
          where: { albumTrackId: id },
        });
      }

      return tx.albumTrack.update({
        where: { id },
        data: {
          ...scalarUpdate,
          translations: replaceTranslations && directTranslations?.length
            ? { create: directTranslations }
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
    if ("error" in updated) {
      return NextResponse.json({ error: updated.error }, { status: updated.status ?? 400 });
    }
    revalidatePublicData();
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
    revalidatePublicData();
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
