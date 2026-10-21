import { NextResponse, type NextRequest } from "next/server";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { revalidatePublicData } from "@/lib/dataCache";
import { getSeriesLogoAdminState } from "@/lib/adminLogo";
import { parseModeChange, readJsonObject } from "@/lib/adminLogoRequest";
import {
  handleImageUpload,
  isUploadError,
  parseAttemptId,
  parseExpectedLogo,
  parseTargetId,
  seriesLogoTarget,
  uploadErrorResponse,
  verifySameOrigin,
  writeAssignment,
  writeLogoAssignment,
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
    const attemptId = rawAttempt === null ? null : parseAttemptId(rawAttempt);

    const state = await getSeriesLogoAdminState(seriesId, attemptId);
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

  try {
    verifySameOrigin(request);
    const seriesId = parseTargetId((await params).id);
    const { expected, next } = parseModeChange(await readJsonObject(request));

    // Shared non-upload writer: one transaction, CAS on the expected pair
    // (zero rows → 404/409 with the current value), and the commit-time
    // split — a failure before the callback finished is `not_saved`, after
    // it `outcome_unknown` (the form then re-reads instead of retrying).
    const committed = await writeAssignment(seriesLogoTarget(seriesId), (tx) =>
      writeLogoAssignment(tx, "series-logo", seriesId, expected, next),
    );

    // Committed: a cache failure must not turn into "not saved".
    safeRevalidate();
    return NextResponse.json({ status: "saved", assignment: committed });
  } catch (err) {
    return uploadErrorResponse(err);
  }
}

function safeRevalidate() {
  try {
    revalidatePublicData();
  } catch (err) {
    console.error("[series-logo] revalidate failed", err instanceof Error ? err.name : typeof err);
  }
}
