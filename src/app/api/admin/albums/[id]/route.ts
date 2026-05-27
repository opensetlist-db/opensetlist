import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { validateCanonicalSlug } from "@/lib/slug";
import { ALBUM_TYPE_SET } from "@/lib/albumConstants";
import { parseBigInt } from "@/lib/adminParsers";
import type { AlbumType } from "@/generated/prisma/enums";

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

  if (
    typeof body.type !== "string" ||
    !ALBUM_TYPE_SET.has(body.type as AlbumType)
  ) {
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

  // releaseDate is a calendar date (Album.releaseDate is `@db.Date`),
  // not a timestamp — the operator's form sends a YYYY-MM-DD string.
  // Strict-validate the shape so a typo like "2025/05/26" or
  // "2025-13-40" 400s with a useful message instead of either silently
  // succeeding through `new Date(...)` lenient parsing or landing
  // an "Invalid Date" sentinel into Prisma. UTC round-trip catches
  // out-of-range day/month values (2025-02-30 → reparses as 2025-03-02
  // under lenient parsing); requiring the parsed parts to equal the
  // input rejects them.
  let releaseDate: Date | null = null;
  if (body.releaseDate != null && body.releaseDate !== "") {
    if (typeof body.releaseDate !== "string") {
      return NextResponse.json(
        { error: "발매일 형식이 잘못되었습니다." },
        { status: 400 },
      );
    }
    const m = body.releaseDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      return NextResponse.json(
        { error: "발매일 형식이 잘못되었습니다." },
        { status: 400 },
      );
    }
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() + 1 !== month ||
      parsed.getUTCDate() !== day
    ) {
      return NextResponse.json(
        { error: "발매일 형식이 잘못되었습니다." },
        { status: 400 },
      );
    }
    releaseDate = parsed;
  }

  const labelName =
    typeof body.labelName === "string" && body.labelName.trim()
      ? body.labelName.trim()
      : null;
  const imageUrl =
    typeof body.imageUrl === "string" && body.imageUrl.trim()
      ? body.imageUrl.trim()
      : null;

  // Translations field is optional. "Missing" = preserve existing
  // rows (a thin client editing only the slug shouldn't wipe locale
  // titles); explicit empty array = full-replace. Any non-array
  // shape would have thrown on `.filter` before — surface as 400
  // explicitly so the operator gets a useful diagnostic.
  if (
    body.translations !== undefined &&
    !Array.isArray(body.translations)
  ) {
    return NextResponse.json(
      { error: "translations 필드는 배열이어야 합니다." },
      { status: 400 },
    );
  }
  const translationsProvided = Array.isArray(body.translations);
  const translations = translationsProvided
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

  // artistIds: same preserve-on-missing rule, but additionally
  // reject the whole request if any provided element fails to parse
  // as BigInt. Silently dropping the bad entries (the previous
  // behavior) would leave AlbumArtist rows partly-rebuilt — operator
  // sees "saved" but the connections they wanted are missing.
  const artistIdsProvided = body.artistIds !== undefined;
  const artistIds: bigint[] = [];
  if (artistIdsProvided) {
    if (!Array.isArray(body.artistIds)) {
      return NextResponse.json(
        { error: "아티스트 ID 목록 형식이 잘못되었습니다." },
        { status: 400 },
      );
    }
    for (const aid of body.artistIds) {
      // parseBigInt enforces the safe-integer guard for JSON numbers
      // and the digit-shape guard for strings — both branches return
      // null on anything unparseable, which surfaces as a 400 here
      // rather than silently anchoring onto a rounded Artist.id.
      const parsed = parseBigInt(aid);
      if (parsed === null) {
        return NextResponse.json(
          { error: "잘못된 아티스트 ID입니다." },
          { status: 400 },
        );
      }
      artistIds.push(parsed);
    }
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const exists = await tx.album.findUnique({
        where: { id: albumId },
        select: { id: true },
      });
      if (!exists) return null;

      if (translationsProvided) {
        await tx.albumTranslation.deleteMany({ where: { albumId } });
      }
      if (artistIdsProvided) {
        await tx.albumArtist.deleteMany({ where: { albumId } });
      }

      return tx.album.update({
        where: { id: albumId },
        data: {
          slug,
          type: body.type as AlbumType,
          originalTitle: (body.originalTitle as string).trim(),
          originalLanguage: body.originalLanguage as string,
          releaseDate,
          labelName,
          imageUrl,
          translations:
            translationsProvided && translations.length
              ? {
                  create: translations.map((t) => ({
                    locale: t.locale,
                    title: t.title,
                  })),
                }
              : undefined,
          artists:
            artistIdsProvided && artistIds.length
              ? { create: artistIds.map((artistId) => ({ artistId })) }
              : undefined,
        },
        // Form callers ignore the response body (they `router.refresh`
        // on success), so the include stays narrow — translations is
        // kept for debugging, artists dropped because the AlbumArtist
        // join row carries two BigInt fields that would only add
        // noise once serializeBigInt-coerced.
        include: { translations: true },
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
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") {
        // Unique constraint — `slug` is the only @unique on Album
        // that PATCH can collide on; if somehow another constraint
        // surfaces (e.g. NULL-edition listing carve-out via post-
        // deploy partial index) the message still points the operator
        // at the slug field for triage.
        return NextResponse.json(
          { error: "이미 사용 중인 슬러그입니다." },
          { status: 409 },
        );
      }
      if (e.code === "P2003") {
        // FK violation — one of the artistIds in the body doesn't
        // resolve to an Artist row. The album itself is fine; the
        // operator picked a stale option. 400 is the right shape
        // (client-fixable bad input) rather than 404 (the album
        // would-be-target case in create routes).
        return NextResponse.json(
          { error: "잘못된 아티스트 ID입니다." },
          { status: 400 },
        );
      }
    }
    throw e;
  }
}
