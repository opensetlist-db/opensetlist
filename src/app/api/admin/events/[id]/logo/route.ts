import { NextResponse, type NextRequest } from "next/server";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { revalidatePublicData } from "@/lib/dataCache";
import { getEventLogoAdminState } from "@/lib/adminEventLogo";
import { parseModeChange, readJsonObject } from "@/lib/adminLogoRequest";
import {
  eventLogoTarget,
  handleImageUpload,
  isUploadError,
  parseAttemptId,
  parseExpectedLogo,
  parseTargetId,
  uploadErrorResponse,
  verifySameOrigin,
  writeAssignment,
  writeLogoAssignment,
} from "@/lib/imageUpload";

// Event logo override card endpoints (admin only, Korean messages per the
// admin i18n exemption) — the same three as the series card, over the
// same shared pieces, so the two cards cannot drift in what a save, a
// conflict or a lost reply means:
//
//   GET    current assignment + asset (with admin-only provenance) + the
//          applied result and draft previews (adminEventLogo.ts).
//          `?attemptId=` adds the evidence a form needs after a lost
//          upload response; `?reconcile=1` re-expires the public cache.
//   POST   multipart upload → custom, through the shared upload contract.
//   PATCH  JSON mode change to inherit or typography (unlink = inherit),
//          compare-and-set against the expected mode+asset pair.
//
// The event's main PUT never writes logo fields, so an unrelated edit
// cannot clear an override, and none of these touch `posterUrl` — the
// poster stays a poster. A logo change is not a setlist edit: these
// handlers are not live writers and never bump `setlistRevision`.

type RouteProps = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  try {
    const eventId = parseTargetId((await params).id);
    const search = request.nextUrl.searchParams;
    const rawAttempt = search.get("attemptId");
    const attemptId = rawAttempt === null ? null : parseAttemptId(rawAttempt);

    const state = await getEventLogoAdminState(eventId, attemptId);
    if (!state) {
      return NextResponse.json(
        { error: "target_not_found", message: "이벤트를 찾을 수 없습니다. 삭제되었을 수 있습니다." },
        { status: 404, headers: NO_STORE },
      );
    }

    // After a lost reply the write may have committed while its own
    // invalidation was cut off with the response; expiring the shared tag
    // again is idempotent, so the reconcile read does it whatever it finds.
    if (search.get("reconcile") === "1") safeRevalidate();

    return NextResponse.json(state, { headers: NO_STORE });
  } catch (err) {
    if (isUploadError(err)) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.status, headers: NO_STORE },
      );
    }
    console.error("[event-logo] state read failed", err instanceof Error ? err.name : typeof err);
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
    target: eventLogoTarget(parseTargetId(id)),
    expected: parseExpectedLogo(form.get("expectedMode"), form.get("expectedAssetId")),
  }));
}

export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  try {
    verifySameOrigin(request);
    const eventId = parseTargetId((await params).id);
    const { expected, next } = parseModeChange(await readJsonObject(request));

    // Shared non-upload writer: CAS on the expected pair in one
    // transaction (zero rows → 404/409 with the current value); a failure
    // before the callback finished is `not_saved`, after it
    // `outcome_unknown`.
    const committed = await writeAssignment(eventLogoTarget(eventId), (tx) =>
      writeLogoAssignment(tx, "event-logo", eventId, expected, next),
    );

    // Committed: a cache failure must not turn into "not saved". The
    // shared public tag (not just the event tag) because the logo graph
    // and every list/card showing this event read through it.
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
    console.error("[event-logo] revalidate failed", err instanceof Error ? err.name : typeof err);
  }
}
