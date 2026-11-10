import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { AlbumInputError, parseAlbumInput } from "@/lib/adminAlbumInput";
import { albumTitleIssues } from "@/lib/albumTitlePolicy";
import { revalidatePublicData } from "@/lib/dataCache";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { verifyAdminAPI } from "@/lib/admin-auth";

/**
 * GET /api/admin/albums
 *
 * Returns every Album row (no soft-delete column on Album as of v0.14.x;
 * if added later, gate `where: { isDeleted: false }` here in lockstep).
 * Used by the admin EventForm's BD Album picker (b07) so the operator
 * can link an Event to its BD Album via a searchable dropdown.
 *
 * Shape kept narrow — just enough for picker display (id, slug, type,
 * release date, original title + locale translations). Heavier album
 * detail (tracks, listings, bonuses) stays on the existing
 * `/api/admin/albums/[id]` endpoint for the per-album edit page.
 *
 * Ordering: `releaseDate desc nulls last, createdAt desc` — operator's
 * mental model when picking a BD is "latest album first." The explicit
 * `nulls: "last"` matters because `Album.releaseDate` is nullable
 * (`DateTime?`) and Postgres' default NULL-ordering with `DESC` places
 * NULLs FIRST — without the override, albums missing a release date
 * would float to the top of the picker, ahead of the actual recent
 * releases the operator is looking for. Same direction the public
 * album list page sorts.
 *
 * Auth: every `/api/admin/*` handler calls `verifyAdminAPI()` first, and
 * `src/proxy.ts` gates the whole prefix as well. (An earlier version of
 * this comment claimed a cookie/middleware policy already protected the
 * route boundary — it did not; the proxy excluded `/api` entirely and
 * several admin routes, including the CSV importer, were open.)

 */
export async function GET() {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  // Wrap the query so a DB connection error returns a structured JSON
  // 500 rather than an unstructured framework error page. The EventForm
  // BD-picker reads this via `.then(r => r.json())`; a non-JSON body
  // would throw in that chain and leave the picker silently empty with
  // no operator signal. Mirrors the JSON-500 convention on
  // `/api/songs/search`.
  try {
    const albums = await prisma.album.findMany({
      select: {
        id: true,
        slug: true,
        type: true,
        releaseDate: true,
        originalTitle: true,
        translations: {
          select: { locale: true, title: true },
        },
      },
      orderBy: [
        { releaseDate: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
    });
    return NextResponse.json(serializeBigInt(albums));
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  try {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new AlbumInputError("잘못된 JSON입니다.");
    }
    const { slug, type, originalTitle, originalLanguage, releaseDate, labelName, translations: submitted = [], artistIds = [] } =
      parseAlbumInput(body as Record<string, unknown>);
    if (!slug || !type || !originalTitle || !originalLanguage) {
      throw new AlbumInputError("슬러그, 타입, 원제, 원어를 입력해 주세요.");
    }
    const translations = submitted.filter((row) => row.title);
    const issues = albumTitleIssues({ originalTitle, originalLanguage, translations });
    if (issues.length) throw new AlbumInputError(`앨범 제목: ${issues.join(", ")}`);

    const album = await prisma.album.create({
      data: {
        slug, type, originalTitle, originalLanguage, releaseDate, labelName,
        translations: { create: translations.map(({ locale, title }) => ({ locale, title })) },
        artists: { create: artistIds.map((artistId) => ({ artistId })) },
      },
      select: { id: true },
    });
    revalidatePublicData();
    return NextResponse.json({ id: String(album.id) }, { status: 201 });
  } catch (error) {
    if (error instanceof AlbumInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return NextResponse.json({ error: "이미 사용 중인 슬러그입니다." }, { status: 409 });
      }
      if (error.code === "P2003") {
        return NextResponse.json({ error: "잘못된 아티스트 ID입니다." }, { status: 400 });
      }
    }
    throw error;
  }
}
