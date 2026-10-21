import type { NextRequest } from "next/server";
import { UploadError, parseExpectedLogo, type LogoAssignment } from "@/lib/imageUpload";

// Request parsing shared by the admin logo-card routes (series and event
// `/logo` PATCH). Both cards send the same JSON, so the rules for what
// counts as a complete compare-and-set request live in one place.
// Korean messages per the admin i18n exemption.

/** JSON object body, or `invalid_request` (400). */
export async function readJsonObject(request: NextRequest): Promise<Record<string, unknown>> {
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
 *
 * `next.mode` is inherit or typography only: custom is reachable solely
 * through an upload, never by re-selecting an asset id.
 */
export function parseModeChange(body: Record<string, unknown>): {
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
