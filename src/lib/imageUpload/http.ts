import { NextResponse, type NextRequest } from "next/server";
import { revalidatePublicData } from "@/lib/dataCache";
import { UploadError, isUploadError } from "./errors";
import { parseAttemptId } from "./keys";
import { MAX_IMAGE_BYTES, MAX_UPLOAD_REQUEST_BYTES } from "./limits";
import { parseProvenance, uploadAndAssign, type UploadDeps } from "./service";
import { getImageStorage } from "./storage";
import type { TargetAdapter } from "./targets";

// HTTP boundary shared by the admin upload routes of 09 (series logo),
// 10 (event logo) and 11 (album cover). Each consumer owns its route file
// and keeps the project convention — `verifyAdminAPI()` as the handler's
// first statement (enforced by admin-api-auth-coverage.test.ts) — then
// delegates here:
//
//   export async function POST(request: NextRequest, { params }: RouteProps) {
//     const unauthorized = await verifyAdminAPI();
//     if (unauthorized) return unauthorized;
//     const { id } = await params;
//     return handleImageUpload(request, (form) => ({
//       target: seriesLogoTarget(parseTargetId(id)),
//       expected: parseExpectedLogo(form.get("expectedMode"), form.get("expectedAssetId")),
//     }));
//   }
//
// Multipart fields: `file` (the image), `attemptId` (UUID, one per selected
// file, reused on resubmission), the expected assignment fields the
// consumer parses, and optional `sourceUrl` / `usageNote`.
//
// What this layer adds, in order:
//   - same-origin check (CSRF): the admin cookie is SameSite=Lax, which
//     already keeps cross-site POSTs from carrying it; the Origin check
//     also rejects same-site but cross-origin pages (another subdomain)
//     and is cheap. Missing Origin falls back to Sec-Fetch-Site.
//   - Content-Length bound before the body is read, then the file's own
//     size (a chunked body has no Content-Length; formData() is still
//     capped by the hosting limit and the file check).
//   - error → JSON mapping: { error: code, outcome, message, ...detail }.
//   - cache invalidation on success: revalidatePublicData(), the shared
//     public tag that the 07 logo graph and every page reading a logo or
//     cover depend on (07 handoff: a per-event tag alone leaves the graph
//     and sibling events stale).

export type UploadTargetSpec<E> = { target: TargetAdapter<E>; expected: E };

/** Same-origin requirement for state-changing admin requests. */
export function verifySameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  if (origin !== null) {
    if (origin === request.nextUrl.origin) return;
  } else if (request.headers.get("sec-fetch-site") === "same-origin") {
    return;
  }
  throw new UploadError("forbidden_origin", "허용되지 않은 요청 출처입니다. 관리자 화면에서 다시 시도해 주세요.");
}

/** Positive BigInt id from a route segment, or 400. */
export function parseTargetId(raw: string): bigint {
  if (/^[1-9][0-9]{0,18}$/.test(raw)) return BigInt(raw);
  throw new UploadError("invalid_request", "대상 ID가 올바르지 않습니다.");
}

export async function handleImageUpload<E>(
  request: NextRequest,
  resolveTarget: (form: FormData) => UploadTargetSpec<E>,
  deps: Partial<UploadDeps> = {},
): Promise<NextResponse> {
  try {
    verifySameOrigin(request);

    const length = Number(request.headers.get("content-length") ?? "NaN");
    if (Number.isFinite(length) && length > MAX_UPLOAD_REQUEST_BYTES) {
      throw new UploadError("request_too_large", "요청이 너무 큽니다. 4MB 이하 이미지를 올려 주세요.", {
        detail: { maxBytes: MAX_IMAGE_BYTES },
      });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch (cause) {
      throw new UploadError("invalid_request", "업로드 요청 형식이 올바르지 않습니다.", { cause });
    }

    const file = form.get("file");
    if (!(file instanceof Blob)) {
      throw new UploadError("invalid_request", "이미지 파일이 없습니다.");
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new UploadError("image_too_large", "이미지는 4MB 이하여야 합니다.", {
        detail: { maxBytes: MAX_IMAGE_BYTES, byteSize: file.size },
      });
    }

    const attemptId = parseAttemptId(form.get("attemptId"));
    const provenance = parseProvenance(form.get("sourceUrl"), form.get("usageNote"));
    const { target, expected } = resolveTarget(form);
    const storage = deps.storage ?? getImageStorage();
    const bytes = new Uint8Array(await file.arrayBuffer());

    const result = await uploadAndAssign(
      { target, expected, attemptId, bytes, provenance },
      { ...deps, storage },
    );
    // Committed by now: a cache failure must not turn into "not saved".
    // The public tag's TTL bounds the staleness if it ever throws.
    try {
      revalidatePublicData();
    } catch (err) {
      console.error("[image-upload] revalidate failed", err instanceof Error ? err.name : typeof err);
    }
    return NextResponse.json(result, { status: result.status === "created" ? 201 : 200 });
  } catch (err) {
    return uploadErrorResponse(err);
  }
}

/** JSON body for any failure; unknown errors become `not_saved` 500s. */
export function uploadErrorResponse(err: unknown): NextResponse {
  if (isUploadError(err)) {
    return NextResponse.json(
      { error: err.code, outcome: err.outcome, message: err.message, ...err.detail },
      { status: err.status },
    );
  }
  console.error("[image-upload] unexpected", err instanceof Error ? err.name : typeof err);
  return NextResponse.json(
    {
      error: "not_saved",
      outcome: "not_saved",
      message: "예상하지 못한 오류로 저장하지 못했습니다. 기존 이미지는 그대로입니다.",
    },
    { status: 500 },
  );
}
