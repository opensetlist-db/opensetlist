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

type CreateBody = {
  albumId?: unknown;
  pattern?: unknown;
  discNumber?: unknown;
  trackNumber?: unknown;
  // pattern=vocal
  songId?: unknown;
  // pattern=off_vocal_w_parent
  parentSongId?: unknown;
  variant?: unknown;
  // pattern=direct
  title?: unknown;
  titleLanguage?: unknown;
  translations?: unknown;
};

/**
 * POST /api/admin/album-tracks
 *
 *   Pattern-dispatched create.
 *
 *   Pattern 1 (vocal): { pattern: "vocal", albumId, discNumber,
 *     trackNumber, songId }
 *   Pattern 2 (off-vocal w/ parent): { pattern: "off_vocal_w_parent",
 *     albumId, discNumber, trackNumber, parentSongId, variant }
 *     — variant must be in PATTERN2_ALBUM_TRACK_VARIANTS.
 *   Pattern 3 (direct title): { pattern: "direct", albumId,
 *     discNumber, trackNumber, variant, title, titleLanguage,
 *     translations[] }
 *     — variant must be in PATTERN3_ALBUM_TRACK_VARIANTS.
 *
 *   → 201 { ...track }
 *   → 400 invalid input (pattern mismatch, bad variant, missing field)
 *   → 401 unauthorized
 *   → 409 (albumId, discNumber, trackNumber) unique conflict
 */
export async function POST(request: NextRequest) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "잘못된 JSON입니다." }, { status: 400 });
  }

  const albumId = parseBigInt(body.albumId);
  if (albumId === null) {
    return NextResponse.json(
      { error: "앨범 ID가 필요합니다." },
      { status: 400 },
    );
  }
  const discNumber = parsePositiveInt(body.discNumber);
  const trackNumber = parsePositiveInt(body.trackNumber);
  if (discNumber === null || trackNumber === null) {
    return NextResponse.json(
      { error: "디스크/트랙 번호가 잘못되었습니다." },
      { status: 400 },
    );
  }

  let data: Prisma.AlbumTrackCreateInput;
  if (body.pattern === "vocal") {
    const songId = parseBigInt(body.songId);
    if (songId === null) {
      return NextResponse.json(
        { error: "보컬 곡을 선택해 주세요." },
        { status: 400 },
      );
    }
    data = {
      album: { connect: { id: albumId } },
      discNumber,
      trackNumber,
      song: { connect: { id: songId } },
    };
  } else if (body.pattern === "off_vocal_w_parent") {
    if (
      typeof body.variant !== "string" ||
      !isPattern2AlbumTrackVariant(body.variant)
    ) {
      return NextResponse.json(
        { error: "패턴 2 변형이 잘못되었습니다 (off-vocal/instrumental/karaoke)." },
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
    data = {
      album: { connect: { id: albumId } },
      discNumber,
      trackNumber,
      variant: body.variant,
      parentSong: { connect: { id: parentSongId } },
    };
  } else if (body.pattern === "direct") {
    if (
      typeof body.variant !== "string" ||
      !isPattern3AlbumTrackVariant(body.variant)
    ) {
      return NextResponse.json(
        { error: "패턴 3 변형이 잘못되었습니다 (drama/bgm)." },
        { status: 400 },
      );
    }
    if (typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json(
        { error: "원어 제목은 필수입니다." },
        { status: 400 },
      );
    }
    const translations = parsePattern3TrackTranslations(body.translations);
    data = {
      album: { connect: { id: albumId } },
      discNumber,
      trackNumber,
      variant: body.variant,
      title: body.title.trim(),
      titleLanguage:
        typeof body.titleLanguage === "string" && body.titleLanguage
          ? body.titleLanguage
          : "ja",
      translations: translations.length ? { create: translations } : undefined,
    };
  } else {
    return NextResponse.json(
      { error: "패턴이 잘못되었습니다." },
      { status: 400 },
    );
  }

  try {
    const created = await prisma.albumTrack.create({
      data,
      include: { translations: true },
    });
    return NextResponse.json(serializeBigInt(created), { status: 201 });
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
      return NextResponse.json(
        { error: "연결 대상(앨범 또는 곡)을 찾을 수 없습니다." },
        { status: 400 },
      );
    }
    throw e;
  }
}
