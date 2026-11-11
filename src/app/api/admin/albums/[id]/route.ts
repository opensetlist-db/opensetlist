import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { AlbumInputError, parseAlbumInput } from "@/lib/adminAlbumInput";
import { albumTitleChanged, albumTitleIssues } from "@/lib/albumTitlePolicy";
import { revalidatePublicData } from "@/lib/dataCache";
import {
  isUploadError,
  writeAlbumImageUrl,
  type AlbumCoverAssignment,
} from "@/lib/imageUpload";
import { parseCoverUrl, parseExpectedCoverJson } from "@/lib/albumCover";

type RouteProps = { params: Promise<{ id: string }> };

/** Thrown inside the transaction to roll it back on a cover CAS miss. */
class CoverConflict extends Error {}

/**
 * PATCH /api/admin/albums/[id]
 *
 *   Body: {
 *     slug?: string,
 *     type?: AlbumType,
 *     originalTitle?: string,
 *     originalLanguage?: string,
 *     releaseDate?: string | null,   // YYYY-MM-DD
 *     labelName?: string | null,
 *     imageUrl?: string | null,          // omit = cover untouched
 *     expectedImageUrl?: string | null, // required with imageUrl
 *     translations?: { locale, title, sameSource?: string }[],
 *     artistIds?: (string | number)[],
 *   }
 *   → 200 { ...album }
 *   → 400 invalid input
 *   → 401 unauthorized
 *   → 404 not found
 *   → 409 slug conflict `{ error: <message> }`, or cover conflict in the
 *     shared image-write shape `{ error: "assignment_conflict",
 *     outcome: "conflict", message, current }` (same as the cover route)
 *
 * The cover (Album.imageUrl) is the album's only current cover source.
 * The admin form saves it through `/api/admin/albums/[id]/cover` and
 * leaves it out of this body; an info edit that omits `imageUrl` must
 * never touch the cover. A caller that does send
 * `imageUrl` must also send the value it loaded as `expectedImageUrl`:
 * the write is then a compare-and-set inside this same transaction, and
 * a mismatch rolls back every field of the request. A body with
 * `imageUrl` but no expected value is rejected rather than written
 * blindly — that is the shape an old, still-open form tab sends, and
 * writing it would bring back a cover someone has since replaced.
 *
 * Omitted fields and translation locales are preserved. An empty title
 * clears that locale and an empty array clears all translations.
 * A provided artist array replaces the artist collection.
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

  let body: Record<string, unknown>;
  try {
    const raw: unknown = await request.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error();
    body = raw as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "잘못된 JSON입니다." }, { status: 400 });
  }

  let coverChange: { expected: AlbumCoverAssignment; next: string | null } | null = null;
  if (body.imageUrl !== undefined) {
    try {
      coverChange = {
        expected: parseExpectedCoverJson(body),
        next: parseCoverUrl(body.imageUrl),
      };
    } catch (e) {
      if (isUploadError(e)) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
      }
      throw e;
    }
  }

  try {
    const { translations, artistIds, ...info } = parseAlbumInput(body);
    const updated = await prisma.$transaction(async (tx) => {
      const exists = await tx.album.findUnique({
        where: { id: albumId },
        select: {
          originalTitle: true, originalLanguage: true,
          translations: { select: { locale: true, title: true } },
        },
      });
      if (!exists) return null;

      const finalTranslations = new Map(exists.translations.map((row) => [row.locale, row]));
      if (translations?.length === 0) finalTranslations.clear();
      for (const row of translations ?? []) {
        if (row.title) finalTranslations.set(row.locale, row);
        else finalTranslations.delete(row.locale);
      }
      const nextTitle = {
        originalTitle: info.originalTitle ?? exists.originalTitle,
        originalLanguage: info.originalLanguage ?? exists.originalLanguage,
        translations: [...finalTranslations.values()],
      };
      const titleChanged = albumTitleChanged(exists, nextTitle);
      if (titleChanged || translations?.some((row) => row.sameSource)) {
        const issues = albumTitleIssues(nextTitle, { previous: exists, submitted: translations ?? [] });
        if (issues.length) throw new AlbumInputError(`앨범 제목: ${issues.join(", ")}`);
      }

      const removedLocales = exists.translations
        .filter((row) => !finalTranslations.has(row.locale))
        .map((row) => row.locale);
      if (artistIds) {
        await tx.albumArtist.deleteMany({ where: { albumId } });
      }

      const row = await tx.album.update({
        where: { id: albumId },
        data: {
          ...info,
          translations: translations && titleChanged ? {
            deleteMany: { locale: { in: removedLocales } },
            upsert: translations.filter((row) => row.title).map(({ locale, title }) => ({
              where: { albumId_locale: { albumId, locale } },
              create: { locale, title },
              update: { title },
            })),
          } : undefined,
          artists:
            artistIds?.length
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
      if (
        coverChange &&
        !(await writeAlbumImageUrl(tx, albumId, coverChange.expected, coverChange.next))
      ) {
        // Throwing rolls back the info update above as well.
        throw new CoverConflict();
      }
      return coverChange ? { ...row, imageUrl: coverChange.next } : row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (!updated) {
      return NextResponse.json(
        { error: "앨범을 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    revalidatePublicData();
    return NextResponse.json(serializeBigInt(updated));
  } catch (e) {
    if (e instanceof AlbumInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof CoverConflict) {
      // The current value is a courtesy for the caller; failing to read
      // it must not turn a definite conflict into a 500.
      const current = await prisma.album
        .findUnique({ where: { id: albumId }, select: { imageUrl: true } })
        .catch(() => null);
      return NextResponse.json(
        {
          error: "assignment_conflict",
          outcome: "conflict",
          message:
            "다른 곳에서 표지가 먼저 바뀌어 저장하지 않았습니다. 새로고침해 현재 표지를 확인한 뒤 다시 시도해 주세요.",
          current: current ? { imageUrl: current.imageUrl } : null,
        },
        { status: 409 },
      );
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2034") {
        return NextResponse.json({ error: "앨범 정보가 동시에 수정되었습니다. 새로고침한 뒤 다시 시도해 주세요." }, { status: 409 });
      }
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
