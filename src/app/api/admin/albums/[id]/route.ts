import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { validateCanonicalSlug } from "@/lib/slug";

type RouteProps = { params: Promise<{ id: string }> };

type PatchBody = {
  slug?: unknown;
  type?: unknown;
  originalTitle?: unknown;
  originalLanguage?: unknown;
  releaseDate?: unknown;
  labelName?: unknown;
  imageUrl?: unknown;
  translations?: unknown;
  artistIds?: unknown;
};

const ALBUM_TYPES = new Set([
  "single",
  "album",
  "ep",
  "live_album",
  "soundtrack",
]);

/**
 * PATCH /api/admin/albums/[id]
 *
 *   Body: {
 *     slug: string,
 *     type: AlbumType,
 *     originalTitle: string,
 *     originalLanguage: string,
 *     releaseDate: string | null,   // YYYY-MM-DD
 *     labelName: string | null,
 *     imageUrl: string | null,
 *     translations: { locale, title }[],
 *     artistIds: number[],
 *   }
 *   → 200 { ...album }
 *   → 400 invalid input
 *   → 401 unauthorized
 *   → 404 not found
 *   → 409 slug conflict
 *
 * Translations + artists are replaced delete-then-create (mirrors
 * `PUT /api/admin/songs/[id]`). This is the only Album mutation
 * endpoint b05 ships — Album rows themselves come from CSV import,
 * so there's no `POST /api/admin/albums` create surface (yet).
 */
export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  let albumId: bigint;
  try {
    albumId = BigInt(id);
  } catch {
    return NextResponse.json(
      { error: "유효하지 않은 앨범 ID입니다." },
      { status: 400 },
    );
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "잘못된 JSON입니다." }, { status: 400 });
  }

  // Slug — canonical-only (same contract as every other admin route).
  if (typeof body.slug !== "string") {
    return NextResponse.json(
      { error: "슬러그는 필수입니다." },
      { status: 400 },
    );
  }
  const slug = validateCanonicalSlug(body.slug);
  if (!slug) {
    return NextResponse.json(
      {
        error:
          "슬러그는 영소문자, 숫자, 하이픈으로만 구성된 URL-safe 형식이어야 합니다.",
      },
      { status: 400 },
    );
  }

  if (typeof body.type !== "string" || !ALBUM_TYPES.has(body.type)) {
    return NextResponse.json(
      { error: "잘못된 앨범 타입입니다." },
      { status: 400 },
    );
  }
  if (typeof body.originalTitle !== "string" || !body.originalTitle.trim()) {
    return NextResponse.json(
      { error: "원제는 필수입니다." },
      { status: 400 },
    );
  }
  if (typeof body.originalLanguage !== "string" || !body.originalLanguage) {
    return NextResponse.json(
      { error: "원어를 선택해 주세요." },
      { status: 400 },
    );
  }

  const releaseDate =
    body.releaseDate == null || body.releaseDate === ""
      ? null
      : typeof body.releaseDate === "string"
        ? new Date(body.releaseDate)
        : null;
  if (releaseDate && Number.isNaN(releaseDate.getTime())) {
    return NextResponse.json(
      { error: "발매일 형식이 잘못되었습니다." },
      { status: 400 },
    );
  }

  const labelName =
    typeof body.labelName === "string" && body.labelName.trim()
      ? body.labelName.trim()
      : null;
  const imageUrl =
    typeof body.imageUrl === "string" && body.imageUrl.trim()
      ? body.imageUrl.trim()
      : null;

  const translations = Array.isArray(body.translations)
    ? (body.translations as Array<{ locale: unknown; title: unknown }>)
        .filter(
          (t) =>
            typeof t.locale === "string" &&
            typeof t.title === "string" &&
            t.title.trim().length > 0,
        )
        .map((t) => ({
          locale: t.locale as string,
          title: (t.title as string).trim(),
        }))
    : [];

  const artistIds = Array.isArray(body.artistIds)
    ? body.artistIds
        .filter((aid) => typeof aid === "number" || typeof aid === "string")
        .map((aid) => {
          try {
            return BigInt(aid as number | string);
          } catch {
            return null;
          }
        })
        .filter((b): b is bigint => b !== null)
    : [];

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const exists = await tx.album.findUnique({
        where: { id: albumId },
        select: { id: true },
      });
      if (!exists) return null;

      await tx.albumTranslation.deleteMany({ where: { albumId } });
      await tx.albumArtist.deleteMany({ where: { albumId } });

      return tx.album.update({
        where: { id: albumId },
        data: {
          slug,
          type: body.type as
            | "single"
            | "album"
            | "ep"
            | "live_album"
            | "soundtrack",
          originalTitle: (body.originalTitle as string).trim(),
          originalLanguage: body.originalLanguage as string,
          releaseDate,
          labelName,
          imageUrl,
          translations: {
            create: translations.map((t) => ({
              locale: t.locale,
              title: t.title,
            })),
          },
          artists: artistIds.length
            ? {
                create: artistIds.map((artistId) => ({ artistId })),
              }
            : undefined,
        },
        include: { translations: true, artists: true },
      });
    });

    if (!updated) {
      return NextResponse.json(
        { error: "앨범을 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    return NextResponse.json(serializeBigInt(updated));
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      // Unique constraint — `slug` is the only @unique on Album that
      // PATCH can collide on; if somehow another constraint surfaces
      // (e.g. NULL-edition listing carve-out via post-deploy partial
      // index) the message still points the operator at the slug field
      // for triage, which is the most common cause.
      return NextResponse.json(
        { error: "이미 사용 중인 슬러그입니다." },
        { status: 409 },
      );
    }
    throw e;
  }
}
