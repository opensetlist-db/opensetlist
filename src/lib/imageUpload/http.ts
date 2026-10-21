import { NextResponse, type NextRequest } from "next/server";
import { revalidatePublicData } from "@/lib/dataCache";
import { UploadError, formatMiB, isUploadError } from "./errors";
import { parseAttemptId } from "./keys";
import { MAX_IMAGE_BYTES, MAX_UPLOAD_REQUEST_BYTES } from "./limits";
import { parseProvenance, uploadAndAssign, type UploadDeps } from "./service";
import { getImageStorage } from "./storage";
import type { TargetAdapter } from "./targets";

// HTTP boundary shared by the admin upload routes (series logo, event
// logo, album cover). Each route file keeps the project convention —
// `verifyAdminAPI()` as the handler's first statement (enforced by
// admin-api-auth-coverage.test.ts) — then delegates here:
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
// file, reused on resubmission), the expected assignment fields the route
// parses, and optional `sourceUrl` / `usageNote`.
//
// What this layer adds, in order:
//   - same-origin check (CSRF): the admin cookie is SameSite=Lax, which
//     already keeps cross-site POSTs from carrying it; the Origin check
//     also rejects same-site but cross-origin pages (another subdomain)
//     and is cheap. Missing Origin falls back to Sec-Fetch-Site.
//   - a hard byte bound on the body: a declared Content-Length over the
//     limit is refused before reading, and the stream itself is read with
//     a cap, so a chunked body without Content-Length is bounded too.
//   - error → JSON mapping: { error: code, outcome, message, ...detail }.
//   - cache invalidation on success: revalidatePublicData(), the shared
//     public tag that the logo resolution graph and every page reading a
//     logo or cover depend on. A per-event tag alone would leave the
//     graph and the event's sibling events stale.

export type UploadTargetSpec<E> = { target: TargetAdapter<E>; expected: E };

const INT64_MAX = BigInt("9223372036854775807");

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

/** Positive BigInt id (Postgres BIGINT range) from a route segment, or 400. */
export function parseTargetId(raw: string): bigint {
  if (/^[1-9][0-9]{0,18}$/.test(raw)) {
    const id = BigInt(raw);
    if (id <= INT64_MAX) return id;
  }
  throw new UploadError("invalid_request", "대상 ID가 올바르지 않습니다.");
}

function requestTooLarge(): UploadError {
  return new UploadError(
    "request_too_large",
    `요청이 너무 큽니다. ${formatMiB(MAX_IMAGE_BYTES)} 이하 이미지를 올려 주세요.`,
    { detail: { maxBytes: MAX_IMAGE_BYTES } },
  );
}

/** Reads the body, refusing it as soon as it passes `limit` bytes. */
async function readBodyBounded(request: NextRequest, limit: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > limit) throw requestTooLarge();
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw requestTooLarge();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.byteLength;
  }
  return body;
}

async function parseMultipart(request: NextRequest): Promise<FormData> {
  const body = await readBodyBounded(request, MAX_UPLOAD_REQUEST_BYTES);
  try {
    // Re-parse the bounded copy with the original boundary.
    return await new Response(body as BodyInit, {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch (cause) {
    throw new UploadError("invalid_request", "업로드 요청 형식이 올바르지 않습니다.", { cause });
  }
}

export async function handleImageUpload<E>(
  request: NextRequest,
  resolveTarget: (form: FormData) => UploadTargetSpec<E>,
  deps: Partial<UploadDeps> = {},
): Promise<NextResponse> {
  try {
    verifySameOrigin(request);
    const form = await parseMultipart(request);

    const file = form.get("file");
    if (!(file instanceof Blob)) {
      throw new UploadError("invalid_request", "이미지 파일이 없습니다.");
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new UploadError("image_too_large", `이미지는 ${formatMiB(MAX_IMAGE_BYTES)} 이하여야 합니다.`, {
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
