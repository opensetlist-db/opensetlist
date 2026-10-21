import { NextResponse, type NextRequest } from "next/server";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { revalidatePublicData } from "@/lib/dataCache";
import { prisma } from "@/lib/prisma";
import { getSeriesLogoAdminState } from "@/lib/adminLogo";
import {
  UploadError,
  conflictFor,
  handleImageUpload,
  isUploadError,
  parseAttemptId,
  parseExpectedLogo,
  parseTargetId,
  readR2Config,
  seriesLogoTarget,
  uploadErrorResponse,
  verifySameOrigin,
  writeLogoAssignment,
  type LogoAssignment,
} from "@/lib/imageUpload";

// Series logo card endpoints (admin only, Korean messages per the admin
// i18n exemption). The series' main PUT never writes logo fields, so an
// unrelated edit cannot clear an assignment; these three are the only
// writers/readers of a series' logo.
//
//   GET    current assignment + asset (with admin-only provenance) + the
//          applied result and draft previews. `?attemptId=` adds the
//          evidence a form needs after a lost upload response, and
//          `?reconcile=1` re-expires the public cache (see below).
//   POST   multipart upload → custom, delegated to the shared upload
//          contract (validation, write-once storage, one-transaction
//          insert + compare-and-set, bounded-resubmission reconcile).
//   PATCH  JSON mode change to inherit or typography (unlink = inherit),
//          compare-and-set against the expected mode+asset pair.
//
// Custom is reachable ONLY through POST. Re-selecting an asset by id is
// deliberately not offered: inherit/typography clear the asset reference
// (DB pairing rule), so going back to a previous asset would be a
// "re-pick from history" feature, and there is no library/history UI.

type RouteProps = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  try {
    const seriesId = parseTargetId((await params).id);
    const search = request.nextUrl.searchParams;
    const rawAttempt = search.get("attemptId");
    const attempt =
      rawAttempt === null ? null : { attemptId: parseAttemptId(rawAttempt), keyPrefix: storageKeyPrefix() };

    const state = await getSeriesLogoAdminState(seriesId, attempt);
    if (!state) {
      return NextResponse.json(
        { error: "target_not_found", message: "시리즈를 찾을 수 없습니다. 삭제되었을 수 있습니다." },
        { status: 404, headers: NO_STORE },
      );
    }

    // A form reconciles after a lost response. If that request committed
    // but its reply (and with it the route's own invalidation) was cut
    // off, nothing else would expire the public logo graph for up to its
    // TTL. Expiring the shared tag again is idempotent and cheap, so the
    // reconcile check does it whatever the outcome.
    if (search.get("reconcile") === "1") safeRevalidate();

    return NextResponse.json(state, { headers: NO_STORE });
  } catch (err) {
    if (isUploadError(err)) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.status, headers: NO_STORE },
      );
    }
    console.error("[series-logo] state read failed", err instanceof Error ? err.name : typeof err);
    return NextResponse.json(
      { error: "read_failed", message: "현재 로고 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503, headers: NO_STORE },
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  return handleImageUpload(request, (form) => ({
    target: seriesLogoTarget(parseTargetId(id)),
    expected: parseExpectedLogo(form.get("expectedMode"), form.get("expectedAssetId")),
  }));
}

export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  // Set once the transaction callback has finished: from then on COMMIT
  // was (or may have been) sent, so a failure no longer proves the old
  // assignment is intact. Same split as the upload service.
  let callbackFinished = false;
  try {
    verifySameOrigin(request);
    const seriesId = parseTargetId((await params).id);
    const { expected, next } = parseModeChange(await readJson(request));
    const target = seriesLogoTarget(seriesId);

    await prisma.$transaction(async (tx) => {
      if (!(await writeLogoAssignment(tx, "series-logo", seriesId, expected, next))) {
        throw await conflictFor(tx, target);
      }
      callbackFinished = true;
    });

    // Committed: a cache failure must not turn into "not saved".
    safeRevalidate();
    return NextResponse.json({ status: "saved", assignment: { mode: next.mode, assetId: null } });
  } catch (err) {
    if (isUploadError(err) || !callbackFinished) return uploadErrorResponse(err);
    console.warn("[series-logo] %s", "outcome-unknown", err instanceof Error ? err.name : typeof err);
    return uploadErrorResponse(
      new UploadError(
        "outcome_unknown",
        "저장 결과를 확인하지 못했습니다. 현재 상태를 확인한 뒤 다음 동작을 선택해 주세요.",
        { cause: err },
      ),
    );
  }
}

function storageKeyPrefix(): string | null {
  // Only the namespace is needed to rebuild the attempt's keys. Absent or
  // misconfigured storage → null → evidence "unavailable": the form keeps
  // the outcome unknown instead of guessing a prefix.
  try {
    return readR2Config()?.keyPrefix ?? null;
  } catch {
    return null;
  }
}

function safeRevalidate() {
  try {
    revalidatePublicData();
  } catch (err) {
    console.error("[series-logo] revalidate failed", err instanceof Error ? err.name : typeof err);
  }
}

async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new UploadError("invalid_request", "요청 형식이 올바르지 않습니다.");
  }
  return raw as Record<string, unknown>;
}

/**
 * `{ expected: { mode, assetId }, next: { mode } }`. Both expected fields
 * must be present — `assetId` as a string or null — because the pair is
 * what the compare-and-set compares; a missing field silently defaulting
 * to "no asset" would let a stale form overwrite a custom logo.
 */
function parseModeChange(body: Record<string, unknown>): {
  expected: LogoAssignment;
  next: { mode: "inherit" | "typography" };
} {
  const expected = body.expected as Record<string, unknown> | null | undefined;
  const next = body.next as Record<string, unknown> | null | undefined;
  if (!expected || typeof expected !== "object" || !("mode" in expected) || !("assetId" in expected)) {
    throw new UploadError("invalid_request", "현재 로고 상태 값이 없습니다. 페이지를 새로고침해 주세요.");
  }
  const assetId = expected.assetId === null ? "" : expected.assetId;
  const parsedExpected = parseExpectedLogo(expected.mode, assetId);
  if (!next || typeof next !== "object" || (next.mode !== "inherit" && next.mode !== "typography")) {
    throw new UploadError(
      "invalid_request",
      "변경할 로고 방식이 올바르지 않습니다. 직접 지정은 이미지 파일을 올려 저장합니다.",
    );
  }
  return { expected: parsedExpected, next: { mode: next.mode } };
}
