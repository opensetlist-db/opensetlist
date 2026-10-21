import { NextResponse, type NextRequest } from "next/server";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { revalidatePublicData } from "@/lib/dataCache";
import {
  UploadError,
  albumCoverTarget,
  handleImageUpload,
  parseAttemptId,
  parseExpectedAlbumCover,
  parseTargetId,
  targetNotFound,
  uploadErrorResponse,
  verifySameOrigin,
  writeAlbumImageUrl,
  writeAssignment,
} from "@/lib/imageUpload";
import {
  parseCoverUrl,
  parseExpectedCoverJson,
  readCoverState,
} from "@/lib/albumCover";

type RouteProps = { params: Promise<{ id: string }> };

// The album cover's own mutation surface, separate from the album-info
// PATCH so a cover save never re-sends (and never re-writes) the title,
// slug, translations or artists, and a cover conflict never blocks an
// unrelated info save.
//
//   GET  ?attemptId=<uuid>  current cover + admin provenance (+ whether
//                           that upload attempt committed), read-only,
//                           one snapshot. Used to resolve an unknown
//                           outcome and to load the latest value after a
//                           409 — never cached.
//   PUT  JSON { expectedImageUrl, imageUrl }  external URL edit or
//                           unlink (imageUrl null), compare-and-set.
//   POST multipart          upload (shared upload contract, expected
//                           field `expectedImageUrl`, "" = no cover).
//
// Every failure answers with the shared `{ error, outcome, message }`
// shape, so the form branches on `outcome` (not_saved / conflict /
// unknown) exactly like it does for uploads.

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  try {
    const albumId = parseTargetId((await params).id);
    const rawAttempt = request.nextUrl.searchParams.get("attemptId");
    const attemptId =
      rawAttempt === null ? undefined : parseAttemptId(rawAttempt);
    const state = await readCoverState(albumId, attemptId);
    if (!state) throw targetNotFound();
    return NextResponse.json(state, { headers: NO_STORE });
  } catch (err) {
    return uploadErrorResponse(err);
  }
}

export async function PUT(request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  try {
    verifySameOrigin(request);
    const albumId = parseTargetId((await params).id);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new UploadError("invalid_request", "잘못된 JSON입니다.");
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new UploadError(
        "invalid_request",
        "요청 형식이 올바르지 않습니다.",
      );
    }
    const fields = body as Record<string, unknown>;
    if (!("imageUrl" in fields)) {
      throw new UploadError(
        "invalid_request",
        "저장할 표지 값(imageUrl)이 없습니다.",
      );
    }
    const expected = parseExpectedCoverJson(fields);
    const next = parseCoverUrl(fields.imageUrl);

    const target = albumCoverTarget(albumId);
    const saved = await writeAssignment(target, (tx) =>
      writeAlbumImageUrl(tx, albumId, expected, next),
    );

    // Committed. Neither the cache expiry nor the provenance lookup may
    // turn this into a failure; a stale public page is bounded by the
    // public tag's TTL.
    try {
      revalidatePublicData();
    } catch (err) {
      console.error(
        "[album-cover] revalidate failed",
        err instanceof Error ? err.name : typeof err,
      );
    }
    let provenance = null;
    try {
      provenance = (await readCoverState(albumId))?.provenance ?? null;
    } catch {
      provenance = null;
    }
    return NextResponse.json(
      { status: "saved", imageUrl: saved.imageUrl, provenance },
      { headers: NO_STORE },
    );
  } catch (err) {
    return uploadErrorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  return handleImageUpload(request, (form) => ({
    target: albumCoverTarget(parseTargetId(id)),
    expected: parseExpectedAlbumCover(form.get("expectedImageUrl")),
  }));
}
