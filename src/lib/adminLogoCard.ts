import type {
  AdminLogoAssignment,
  AdminLogoPreview,
  AdminSeriesLogoState,
} from "@/lib/adminLogo";

// Pure decision rules of the admin logo card (series now; the event
// override card can reuse them). No React, no fetch: the component owns
// state and I/O, these functions decide what an observation means, so the
// rules are unit-testable on their own.
//
// The hard cases are the ones where the form cannot see what happened:
//
// - A lost reply (`unknown`). The request may still be running and commit
//   later, so "nothing changed yet" is never proof that it ended. The form
//   keeps the submission frozen (same attempt, same expected pair, same
//   provenance) and only offers resending exactly that submission, which
//   the server reconciles instead of writing twice.
// - An upload whose reply was lost entirely: the browser never learned the
//   new asset id, so it asks the server for its attempt's evidence. An
//   ImageAsset row for the attempt exists only after the asset insert and
//   the assignment committed together, so "row exists but the series does
//   not hold it" means it WAS saved and then superseded — a conflict, not
//   "not saved" (the server's resend path reports the same thing as
//   `attemptCommitted: true`).
// - Value comparison cannot tell A→B→A apart from "unchanged"; the spec
//   accepts that (no revision column).

export type LogoMode = AdminLogoAssignment["mode"];

/** The card's own state shape (the series id is the route's business). */
export type LogoCardState = Omit<AdminSeriesLogoState, "seriesId">;

export function sameAssignment(a: AdminLogoAssignment, b: AdminLogoAssignment): boolean {
  return a.mode === b.mode && (a.assetId ?? null) === (b.assetId ?? null);
}

/** 409 bodies describe the current value as `{logoMode, logoAssetId}`. */
export function assignmentFromConflict(body: unknown): AdminLogoAssignment | null {
  const current = (body as { current?: { logoMode?: unknown; logoAssetId?: unknown } } | null)?.current;
  if (!current || typeof current.logoMode !== "string") return null;
  if (current.logoMode !== "inherit" && current.logoMode !== "custom" && current.logoMode !== "typography") {
    return null;
  }
  const assetId = typeof current.logoAssetId === "string" ? current.logoAssetId : null;
  return { mode: current.logoMode, assetId };
}

export function attemptCommittedFromConflict(body: unknown): boolean {
  return (body as { attemptCommitted?: unknown } | null)?.attemptCommitted === true;
}

export type ReconcileVerdict =
  /** My change is what the series holds now. */
  | "reflected"
  /** Not observed yet; only resending the same submission is allowed. */
  | "unchanged"
  /** Something else holds the slot (maybe after mine committed). */
  | "superseded"
  /** The read could not classify the attempt; stay unknown. */
  | "undetermined";

/** Upload whose outcome was lost, read back through the attempt evidence. */
export function reconcileUpload(state: LogoCardState, expected: AdminLogoAssignment): ReconcileVerdict {
  const evidence = state.attempt;
  if (!evidence || evidence.state === "ambiguous" || evidence.state === "unavailable") return "undetermined";
  if (evidence.state === "committed") return evidence.held ? "reflected" : "superseded";
  return sameAssignment(state.assignment, expected) ? "unchanged" : "superseded";
}

/** Mode change whose outcome was lost: the browser knows both values. */
export function reconcileModeChange(
  state: LogoCardState,
  expected: AdminLogoAssignment,
  next: AdminLogoAssignment,
): ReconcileVerdict {
  if (sameAssignment(state.assignment, next)) return "reflected";
  if (sameAssignment(state.assignment, expected)) return "unchanged";
  return "superseded";
}

export type ModeChangeOutcome =
  | { kind: "saved" }
  | { kind: "conflict"; body: unknown }
  | { kind: "not_saved"; message: string | null }
  | { kind: "unknown"; message: string | null };

/**
 * Meaning of one PATCH reply. `resend` = an earlier send of the same
 * change ended `unknown`: a later 4xx then says nothing about whether
 * that earlier send committed, so it stays unknown (same rule as the
 * shared upload client). A 5xx or a reply without our JSON may have cut
 * off a request that went on to commit: unknown, not failed.
 */
export function classifyModeChangeReply(
  httpStatus: number,
  body: unknown,
  resend: boolean,
): ModeChangeOutcome {
  const reply = (body ?? {}) as { outcome?: unknown; message?: unknown };
  const message = typeof reply.message === "string" ? reply.message : null;
  if (httpStatus >= 200 && httpStatus < 300) return { kind: "saved" };
  if (reply.outcome === "conflict" || httpStatus === 409) return { kind: "conflict", body };
  if (reply.outcome === "unknown") return { kind: "unknown", message };
  // No outcome field = not our handler's JSON (platform timeout/gateway
  // page, or a crash before it answered): a 5xx of that kind is unknown.
  if (reply.outcome === undefined && httpStatus >= 500) return { kind: "unknown", message };
  if (resend) return { kind: "unknown", message };
  // Our handler said not_saved (known pre-commit failure), or a 4xx
  // rejected the request before any write (auth, origin, validation).
  return { kind: "not_saved", message };
}

/** Short Korean label of an assignment for the card's badge/summary. */
export function assignmentLabel(assignment: AdminLogoAssignment, applied: AdminLogoPreview): string {
  if (assignment.mode === "custom") return applied.imageUrl ? "직접 지정" : "직접 지정 · 이미지 사용 불가";
  if (assignment.mode === "typography") return "타이포그래피만";
  return applied.imageUrl ? "상속 · 상위 시리즈 로고" : "상속 · 로고 없음";
}

/** Series wording of the explanation under the preview (default of the card). */
export function resolutionText(mode: LogoMode, preview: AdminLogoPreview, imageFailed: boolean): string {
  if (imageFailed) {
    return "선택된 로고를 불러올 수 없어 제목을 표시합니다. 상위 이미지나 포스터로 대체하지 않습니다.";
  }
  if (mode === "typography") {
    return "여기서 상속을 멈추고 제목만 표시합니다. 하위 공연의 직접 지정 로고가 있으면 그 로고가 우선합니다.";
  }
  if (mode === "custom") {
    return preview.imageUrl
      ? "직접 지정한 로고를 사용합니다. 상위 시리즈의 설정보다 우선합니다."
      : "선택된 로고를 사용할 수 없어 제목을 표시합니다. 상위 이미지나 포스터로 대체하지 않습니다.";
  }
  const name = preview.source && !preview.source.isSelf ? `「${preview.source.name}」` : "";
  switch (preview.reason) {
    case "custom":
      return `가장 가까운 상위 시리즈 ${name}의 로고를 사용합니다. 상위 로고가 바뀌면 함께 바뀝니다.`;
    case "typography-mode":
      return `상위 시리즈 ${name}에서 상속을 멈춰 제목을 표시합니다.`;
    case "unusable-asset":
      return `상위 시리즈 ${name}의 로고를 사용할 수 없어 제목을 표시합니다.`;
    case "broken-chain":
      return "상위 시리즈 연결이 끊겨(삭제·순환) 제목을 표시합니다.";
    case "exhausted":
    default:
      return "상위 시리즈에 로고가 없어 제목을 표시합니다. 하위 공연은 자체 설정이 없다면 이 규칙을 따릅니다.";
  }
}
