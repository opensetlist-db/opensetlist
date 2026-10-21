"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { AdminLogoAssignment, AdminLogoPreview } from "@/lib/adminLogo";
import {
  assignmentFromConflict,
  assignmentLabel,
  attemptCommittedFromConflict,
  classifyModeChangeReply,
  conflictMine,
  type ConflictMine,
  modeLabel,
  reconcileModeChange,
  reconcileUpload,
  resolutionText,
  sameAssignment,
  type LogoCardState,
  type LogoMode,
} from "@/lib/adminLogoCard";
import {
  IMAGE_INPUT_ACCEPT,
  precheckImageFile,
  startImageAttempt,
  type ImageAttempt,
} from "@/lib/imageUpload/client";
import { MAX_SOURCE_URL_LENGTH, MAX_USAGE_NOTE_LENGTH } from "@/lib/imageUpload/limits";
import { useImageFallback } from "@/components/shared/useImageFallback";

/*
 * Admin logo card — the approved 04-v1 "시리즈 로고" section (layout,
 * copy and state set follow packet 04 `app.js` / captures). Written for
 * the series edit form; the event override card is meant to reuse it with
 * its own endpoint and wording, which is why everything target-specific
 * arrives through props.
 *
 * Save unit. The card saves ONLY the logo, with its own 취소/저장 (the
 * mockup's separate `imageform`). The page's main save never writes logo
 * fields. Because both live on one page, the page — not the card — owns
 * the "leave or stay" decision: `onSaved` reports a committed logo change
 * and the page navigates only if nothing else is unsaved at that moment.
 *
 * Form ownership. The card sits inside the page's main <form> (between the
 * original-name block and the translations, as approved), but its controls
 * belong to a separate <form> rendered through a portal and linked with
 * the `form` attribute. So an invalid 출처 URL here never blocks the main
 * save's native validation, Enter in a card field submits the logo save
 * (as in the mockup), and the card's own validation runs on its save.
 * React bubbles synthetic events through portals along the COMPONENT tree,
 * so the logo form's submit would reach the main form's onSubmit:
 * stopPropagation below is load-bearing.
 *
 * Outcome handling (see adminLogoCard.ts for the rules):
 *   saving    → everything in the card locked; the page also blocks its
 *               own save and navigation (`busy`).
 *   failure   → known not saved; current value kept; explicit retry.
 *   unknown   → reply lost. The submission is frozen (attempt id, file,
 *               expected pair, provenance) and the only ways forward are
 *               "현재 상태 확인" or resending exactly that submission.
 *   conflict  → someone else changed it; show last-confirmed vs mine;
 *               "최신 값 불러오기 · 이미지 초안 폐기" refetches explicitly.
 * Nothing here ever deletes a stored file or reassigns an older asset.
 */

export type LogoCardCopy = {
  /** Section title, e.g. "시리즈 로고". */
  title: string;
  inheritTitle: string;
  customDescription: string;
  /**
   * Success notice body when nothing else is unsaved. Defaults to the
   * series page's "목록으로 이동합니다" (it navigates); a page that stays
   * after a logo save (the event edit page) says so instead.
   */
  savedBody?: string;
};

export type LogoCardStatus = {
  /** A draft differs from the saved logo. */
  dirty: boolean;
  /** A request is running or its outcome is not settled. */
  busy: boolean;
};

type Props = {
  endpoint: string;
  initialState: LogoCardState;
  copy: LogoCardCopy;
  /** Typography fallback text (saved title of the record). */
  typography: { title: string; caption?: string | null; eyebrow?: string | null };
  /** The page's other fields have unsaved edits right now. */
  otherDirty: boolean;
  /** The page's own save is running: lock the card's save. */
  externalBusy: boolean;
  /**
   * Explanation under the preview for the draft mode. Defaults to the
   * series wording; a target with a different inheritance path (an
   * event override) passes its own.
   */
  describeResolution?: typeof resolutionText;
  /** Bumped by the page after it saved its other fields (preview inputs may have changed). */
  refreshKey?: number;
  onStatusChange?: (status: LogoCardStatus) => void;
  /** Committed logo change; `otherDirty` is read at completion time. */
  onSaved?: (info: { otherDirty: boolean }) => void;
};

type Phase =
  | "idle"
  | "saving"
  | "failure"
  | "unknown"
  | "checking"
  | "unchanged"
  | "conflict"
  | "refreshing"
  | "saved"
  | "savedStay"
  | "reconciled"
  | "refreshed"
  | "invalid"
  | "cancelled";

/** What was sent, kept unchanged until the outcome is settled. */
type Frozen =
  | {
      kind: "upload";
      attempt: ImageAttempt;
      expected: AdminLogoAssignment;
      fields: Record<string, string>;
    }
  | { kind: "mode"; expected: AdminLogoAssignment; next: AdminLogoAssignment };

const LOCKED: ReadonlySet<Phase> = new Set(["saving", "unknown", "checking", "unchanged", "conflict", "refreshing"]);
const BUSY: ReadonlySet<Phase> = new Set(["saving", "unknown", "checking", "unchanged", "refreshing"]);
/** The reply of the last send is lost and not yet classified. */
const UNSETTLED: ReadonlySet<Phase> = new Set(["unknown", "checking", "unchanged"]);
/** Phases whose notice takes focus (screen readers hear the outcome). */
const FOCUS_NOTICE: ReadonlySet<Phase> = new Set([
  "failure",
  "unknown",
  "unchanged",
  "conflict",
  "saved",
  "savedStay",
  "reconciled",
  "refreshed",
  "invalid",
]);

function draftPreview(state: LogoCardState, mode: LogoMode): AdminLogoPreview {
  if (mode === "inherit") return state.previews.inherit;
  if (mode === "typography") return state.previews.typography;
  // custom without a new file = the saved custom logo.
  return state.applied;
}

export default function LogoAssignmentCard({
  endpoint,
  initialState,
  copy,
  typography,
  otherDirty,
  externalBusy,
  refreshKey = 0,
  describeResolution = resolutionText,
  onStatusChange,
  onSaved,
}: Props) {
  const uid = useId();
  const formId = `logo-form-${uid}`;
  const [confirmed, setConfirmed] = useState<LogoCardState>(initialState);
  const [draftMode, setDraftMode] = useState<LogoMode>(initialState.assignment.mode);
  const [attempt, setAttempt] = useState<ImageAttempt | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [usageNote, setUsageNote] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [frozen, setFrozen] = useState<Frozen | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [conflictCurrent, setConflictCurrent] = useState<AdminLogoAssignment | null>(null);
  const [conflictOwn, setConflictOwn] = useState<ConflictMine>("not_saved");
  const [imageFailed, setImageFailed] = useState(false);
  const noticeRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Latest values for async completions (decided at completion time).
  const otherDirtyRef = useRef(otherDirty);
  otherDirtyRef.current = otherDirty;
  const attemptRef = useRef<ImageAttempt | null>(null);
  attemptRef.current = attempt;

  const dirty = attempt !== null || draftMode !== confirmed.assignment.mode;
  const locked = LOCKED.has(phase);
  const busy = BUSY.has(phase);

  // The portal target (document.body) exists only in the browser: render
  // the logo <form> after hydration, without a setState-in-effect.
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  useEffect(() => {
    onStatusChange?.({ dirty, busy });
  }, [dirty, busy, onStatusChange]);

  // Revoke the local preview when the card goes away.
  useEffect(() => () => attemptRef.current?.cancel(), []);

  // After the page saved its other fields (parent/artist/title may have
  // changed), recompute the previews. The assignment the form loaded is
  // the compare-and-set baseline, so it is NOT rebased here: if it moved
  // meanwhile, the next save reports a conflict instead of silently
  // overwriting the newer value.
  const lastRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === lastRefreshKey.current) return;
    lastRefreshKey.current = refreshKey;
    let cancelled = false;
    fetchState().then((fresh) => {
      if (cancelled || !fresh) return;
      setConfirmed((prev) =>
        sameAssignment(prev.assignment, fresh.assignment) ? fresh : prev,
      );
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey is the only trigger
  }, [refreshKey]);

  useEffect(() => {
    if (FOCUS_NOTICE.has(phase)) {
      noticeRef.current?.focus();
    }
  }, [phase]);

  async function fetchState(query = ""): Promise<LogoCardState | null> {
    try {
      const res = await fetch(`${endpoint}${query}`, { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return null;
      return (await res.json()) as LogoCardState;
    } catch {
      return null;
    }
  }

  function discardDraft(next: LogoCardState) {
    attempt?.cancel();
    setAttempt(null);
    setSourceUrl("");
    setUsageNote("");
    setFrozen(null);
    setConflictCurrent(null);
    setConflictOwn("not_saved");
    setImageFailed(false);
    setConfirmed(next);
    setDraftMode(next.assignment.mode);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function markEdited() {
    setMessage(null);
    setImageFailed(false);
    if (!LOCKED.has(phase)) setPhase("idle");
  }

  function selectMode(mode: LogoMode) {
    if (locked) return;
    // As in the mockup: changing the mode drops a selected file.
    attempt?.cancel();
    setAttempt(null);
    setSourceUrl("");
    setUsageNote("");
    setDraftMode(mode);
    markEdited();
  }

  function selectFile(file: File | undefined) {
    if (locked || !file) return;
    const problem = precheckImageFile(file);
    if (problem) {
      setMessage(problem);
      setPhase("invalid");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    attempt?.cancel();
    setAttempt(startImageAttempt(file));
    setDraftMode("custom");
    markEdited();
  }

  function cancelDraft() {
    if (locked) return;
    discardDraft(confirmed);
    setMessage(null);
    setPhase("cancelled");
  }

  /** A committed change: refresh the card, then let the page decide. */
  async function finishSaved(fallback: AdminLogoAssignment, verdict: "saved" | "reconciled") {
    const fresh = await fetchState();
    const stay = otherDirtyRef.current;
    if (fresh) {
      discardDraft(fresh);
      setMessage(null);
    } else {
      // Saved, but the read-back failed: keep the confirmed value we know
      // was committed; previews may be stale until a reload.
      discardDraft({ ...confirmed, assignment: fallback, attempt: null });
      setMessage("저장은 완료했지만 현재 상태를 다시 불러오지 못했습니다. 새로고침해 확인해 주세요.");
    }
    setPhase(verdict === "reconciled" ? "reconciled" : stay ? "savedStay" : "saved");
    onSaved?.({ otherDirty: stay });
  }

  function enterConflict(kind: "upload" | "mode", body: unknown, afterLostReply: boolean) {
    setConflictCurrent(assignmentFromConflict(body));
    setConflictOwn(conflictMine(kind, { attemptCommitted: attemptCommittedFromConflict(body), afterLostReply }));
    setMessage(null);
    setPhase("conflict");
  }

  async function send(submission: Frozen, resend: boolean) {
    setFrozen(submission);
    setMessage(null);
    setPhase("saving");

    if (submission.kind === "upload") {
      // The shared client already resends the same FormData up to its
      // bound when a reply is lost; this function never loops on top.
      const outcome = await submission.attempt.submit(endpoint, submission.fields);
      if (outcome.kind === "saved") {
        const assetId = (outcome.body as { asset?: { id?: string } } | null)?.asset?.id ?? null;
        await finishSaved({ mode: "custom", assetId }, outcome.status === "reconciled" ? "reconciled" : "saved");
        return;
      }
      if (outcome.kind === "conflict") return enterConflict("upload", outcome.body, resend);
      if (outcome.kind === "unknown" || resend) {
        setMessage(replyMessage(outcome.body));
        setPhase("unknown");
        return;
      }
      setFrozen(null);
      setMessage(replyMessage(outcome.body));
      setPhase("failure");
      return;
    }

    let httpStatus = 0;
    let body: unknown = null;
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ expected: submission.expected, next: { mode: submission.next.mode } }),
      });
      httpStatus = res.status;
      body = await res.json().catch(() => null);
    } catch {
      setPhase("unknown");
      return;
    }
    const outcome = classifyModeChangeReply(httpStatus, body, resend);
    if (outcome.kind === "saved") return finishSaved(submission.next, "saved");
    if (outcome.kind === "conflict") return enterConflict("mode", outcome.body, resend);
    setMessage(outcome.message);
    if (outcome.kind === "unknown") {
      setPhase("unknown");
      return;
    }
    setFrozen(null);
    setPhase("failure");
  }

  function save() {
    if (externalBusy || !canSave) return;
    const expected = confirmed.assignment;
    if (attempt) {
      void send(
        {
          kind: "upload",
          attempt,
          expected,
          fields: {
            expectedMode: expected.mode,
            expectedAssetId: expected.assetId ?? "",
            sourceUrl: sourceUrl.trim(),
            usageNote: usageNote.trim(),
          },
        },
        false,
      );
      return;
    }
    if (draftMode === "custom") return; // custom only through a new file
    void send({ kind: "mode", expected, next: { mode: draftMode, assetId: null } }, false);
  }

  function retry() {
    // After a known failure: a fresh send of the same draft. After an
    // unconfirmed one: exactly the frozen submission (server reconciles).
    if (phase === "failure") return save();
    if (frozen) void send(frozen, true);
  }

  async function checkCurrent() {
    if (!frozen) return;
    setPhase("checking");
    const query =
      frozen.kind === "upload"
        ? `?reconcile=1&attemptId=${encodeURIComponent(frozen.attempt.attemptId)}`
        : "?reconcile=1";
    const fresh = await fetchState(query);
    if (!fresh) {
      setMessage("현재 상태를 불러오지 못했습니다. 결과는 아직 확인되지 않았습니다. 잠시 후 다시 확인해 주세요.");
      setPhase("unknown");
      return;
    }
    const verdict =
      frozen.kind === "upload"
        ? reconcileUpload(fresh, frozen.expected)
        : reconcileModeChange(fresh, frozen.expected, frozen.next);
    if (verdict === "reflected") {
      discardDraft(fresh);
      setMessage(null);
      setPhase("reconciled");
      onSaved?.({ otherDirty: otherDirtyRef.current });
      return;
    }
    if (verdict === "unchanged") {
      setMessage(null);
      setPhase("unchanged");
      return;
    }
    if (verdict === "undetermined") {
      setMessage(
        "현재 상태로는 업로드 결과를 판정할 수 없습니다(저장소 설정을 확인할 수 없음). 결과는 아직 확인되지 않았습니다. 새로고침하지 말고 운영자에게 저장소 설정을 확인해 달라고 요청한 뒤 다시 확인해 주세요.",
      );
      setPhase("unknown");
      return;
    }
    setConflictCurrent(fresh.assignment);
    setConflictOwn(
      conflictMine(frozen.kind, {
        attemptCommitted: fresh.attempt?.state === "committed",
        afterLostReply: true,
      }),
    );
    // Drop the unknown phase's message: it described the lost reply, not
    // this conflict.
    setMessage(null);
    setPhase("conflict");
  }

  async function loadLatest() {
    setPhase("refreshing");
    const fresh = await fetchState();
    if (!fresh) {
      setMessage("최신 값을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setPhase("conflict");
      return;
    }
    discardDraft(fresh);
    setMessage(null);
    setPhase("refreshed");
  }

  const canSave =
    !locked &&
    !externalBusy &&
    dirty &&
    !(draftMode === "custom" && !attempt && confirmed.assignment.mode !== "custom");

  // ── What the preview shows ────────────────────────────────────────
  const unsettled = UNSETTLED.has(phase);
  const showingSubmitted = unsettled && frozen?.kind === "upload";
  const preview = draftPreview(confirmed, draftMode);
  const previewImage = attempt ? attempt.previewUrl : preview.imageUrl;
  const previewTitle =
    showingSubmitted ? "제출한 이미지 · 결과 확인 필요" : dirty ? "저장 후 적용될 모습" : "적용 결과";
  const previewBadge = unsettled
      ? "미확정"
      : phase === "saving"
        ? "처리 중"
        : dirty
          ? "저장 전"
          : "현재 상태";

  let resolution: string;
  if (phase === "unknown" || phase === "checking") {
    resolution = "제출한 내용의 미리보기입니다. 저장이 완료되었는지는 현재 상태 확인 전까지 알 수 없습니다.";
  } else if (phase === "unchanged") {
    resolution = "현재 연결은 이전 값입니다. 제출이 반영되었는지는 아직 단정할 수 없습니다. 같은 내용으로만 다시 저장할 수 있습니다.";
  } else if (phase === "saving") {
    resolution = "제출한 내용의 미리보기입니다. 저장 완료 전에는 현재 적용값으로 확정하지 않습니다.";
  } else if (phase === "failure") {
    resolution = "이 초안은 반영되지 않았습니다. 기존 값을 유지하며 다시 저장할 수 있습니다.";
  } else if (phase === "conflict") {
    resolution = "충돌로 반영되지 않은 초안입니다. 최신 값은 다시 불러와 확인해 주세요.";
  } else if (attempt) {
    resolution = "아직 업로드하지 않았습니다. 선택 취소 시 현재 적용 상태로 돌아갑니다.";
  } else {
    resolution = describeResolution(draftMode, preview, imageFailed);
  }

  const lastConfirmed = unsettled || phase === "conflict";
  const currentLabel = assignmentLabel(confirmed.assignment, confirmed.applied);
  const headBadge = unsettled
      ? "결과 미확정"
      : phase === "conflict"
        ? "다른 곳에서 변경됨"
        : currentLabel;

  const saveNote =
    phase === "unknown" || phase === "unchanged"
      ? "현재 상태를 확인한 뒤 다음 동작을 선택하세요."
      : phase === "saving" || phase === "checking"
        ? "저장 결과를 기다리고 있습니다."
        : phase === "conflict"
          ? "최신 값을 불러온 뒤 다시 선택하세요."
          : externalBusy
            ? "기본 정보를 저장하는 중입니다."
            : dirty
              ? "저장을 눌러야 변경이 적용됩니다."
              : "이미지 변경 사항이 없습니다.";

  const asset = confirmed.asset;
  const showUnlink = confirmed.assignment.mode === "custom" || draftMode === "custom";

  return (
    <>
    <section
      aria-labelledby={`${formId}-title`}
      className="rounded-xl border border-[#dce0e9] bg-white p-4 shadow-[0_2px_5px_#19203b03] min-[481px]:p-6"
    >
      {mounted &&
        createPortal(
          <form
            id={formId}
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              save();
            }}
          />,
          document.body,
        )}

      <div className="flex items-start justify-between gap-3 min-[481px]:items-center">
        <div>
          <div className="text-[11px] tracking-[0.3px] text-[#626977]">이미지 설정</div>
          <h2 id={`${formId}-title`} className="mt-[3px] text-[19px] font-bold tracking-[-0.5px]">
            {copy.title}
          </h2>
        </div>
        <span className="inline-block shrink-0 rounded-[5px] bg-[#f1f3f6] px-2 py-1 text-[11px] font-semibold leading-normal text-[#5c6373]">
          {headBadge}
        </span>
      </div>

      <div className="mb-[19px] border-b border-[#eceef2] pb-[15px] pt-3 text-xs text-[#656b79] [overflow-wrap:anywhere]">
        {lastConfirmed ? "마지막 확인값" : "현재 적용"}: {currentLabel}
        {asset && confirmed.assignment.mode === "custom" && (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-[#626977]">
            <dt>관리 정보</dt>
            <dd>
              {asset.width}×{asset.height} · {asset.mimeType.replace("image/", "").toUpperCase()} ·{" "}
              {Math.max(1, Math.round(asset.byteSize / 1024))}KB (비공개)
            </dd>
            <dt>출처</dt>
            <dd className="[overflow-wrap:anywhere]">{asset.sourceUrl ?? "등록 정보 없음"}</dd>
            {asset.usageNote && (
              <>
                <dt>메모</dt>
                <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{asset.usageNote}</dd>
              </>
            )}
          </dl>
        )}
      </div>

      <fieldset disabled={locked} className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-2.5 text-xs font-semibold">로고 표시 방식</legend>
        {(
          [
            ["inherit", copy.inheritTitle, "가장 가까운 상위 로고를 사용합니다. 없으면 제목을 표시합니다."],
            ["custom", "직접 지정", copy.customDescription],
            ["typography", "타이포그래피만", "상위 로고를 사용하지 않고 제목만 표시합니다."],
          ] as const
        ).map(([value, title, description]) => (
          <label
            key={value}
            className={`mb-2 flex min-h-16 cursor-pointer items-start gap-[11px] rounded-lg border px-2.5 py-[11px] min-[481px]:p-3 ${
              draftMode === value ? "border-[#8da9df] bg-[#f6f9ff]" : "border-[#e2e5eb]"
            }`}
          >
            <input
              type="radio"
              form={formId}
              name="logoMode"
              value={value}
              checked={draftMode === value}
              onChange={() => selectMode(value)}
              className="mt-1 h-[18px] w-[18px] shrink-0 accent-[#245cce]"
            />
            <span>
              <b className="text-[13px] font-semibold">{title}</b>
              <small className="block text-xs leading-[1.55] text-[#6b7180]">{description}</small>
            </span>
          </label>
        ))}

        {draftMode === "custom" && (
          <>
            <div className="my-[13px] rounded-lg border border-dashed border-[#bac6da] bg-[#f9fafc] px-3 py-3.5 min-[481px]:p-[18px]">
              <strong className="mb-1 block text-[13px]">{attempt ? "선택한 파일" : "이미지 파일 선택"}</strong>
              {attempt ? (
                <>
                  <p className="my-[7px] text-xs [overflow-wrap:anywhere]">
                    {attempt.file.name}
                    <span className="block text-[10px] text-[#79588c]">이 브라우저에서만 미리보기</span>
                  </p>
                  <button
                    type="button"
                    onClick={cancelDraft}
                    className="min-h-11 rounded-[7px] border border-[#ccd0d9] bg-white px-[17px] py-[9px] font-semibold text-[#343947] hover:bg-[#f3f5fa] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    선택 취소
                  </button>
                </>
              ) : (
                <>
                  <p className="my-[7px] text-xs text-[#6b7180]">
                    PNG · JPEG · WebP
                    <br />
                    투명도와 원본 비율을 유지합니다.
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    form={formId}
                    accept={IMAGE_INPUT_ACCEPT}
                    aria-label="이미지 파일 선택"
                    onChange={(e) => selectFile(e.target.files?.[0])}
                    className="w-full border-0 bg-transparent py-2 text-xs file:mr-2 file:rounded-[5px] file:border file:border-[#cad2df] file:bg-white file:px-2.5 file:py-[7px] file:text-[#34578c]"
                  />
                  <p className="my-[7px] text-xs text-[#6b7180]">선택만으로 업로드되지 않습니다.</p>
                </>
              )}
            </div>

            {attempt && (
              <div className="my-4 grid gap-[13px]">
                <label>
                  <span className="mb-[5px] block text-xs font-semibold">
                    출처 URL <span className="text-[11px] font-normal text-[#626977]">(선택 · 관리자만)</span>
                  </span>
                  <input
                    type="url"
                    form={formId}
                    value={sourceUrl}
                    maxLength={MAX_SOURCE_URL_LENGTH}
                    placeholder="https://…"
                    onChange={(e) => setSourceUrl(e.target.value)}
                    className="w-full rounded-md border border-[#cdd2dc] bg-white px-3 py-2.5 text-[#272c39]"
                  />
                </label>
                <label>
                  <span className="mb-[5px] block text-xs font-semibold">
                    관리 메모 <span className="text-[11px] font-normal text-[#626977]">(선택 · 비공개)</span>
                  </span>
                  <textarea
                    form={formId}
                    value={usageNote}
                    maxLength={MAX_USAGE_NOTE_LENGTH}
                    placeholder="출처·사용 검토 내용을 기록하세요"
                    onChange={(e) => setUsageNote(e.target.value)}
                    className="min-h-[84px] w-full resize-y rounded-md border border-[#cdd2dc] bg-white px-3 py-2.5 text-[#272c39]"
                  />
                </label>
                <p className="text-[11px] text-[#626977]">출처와 메모는 공개 페이지에 표시되지 않습니다.</p>
              </div>
            )}
          </>
        )}
      </fieldset>

      <div className="mb-2.5 mt-[23px] flex items-start justify-between gap-2 min-[481px]:items-center">
        <h3 className="m-0 text-[13px] font-bold">{previewTitle}</h3>
        <span className="inline-block rounded-[5px] bg-[#f1ecfb] px-2 py-1 text-[11px] font-semibold leading-normal text-[#69508c]">
          {previewBadge}
        </span>
      </div>
      <div
        data-testid="logo-preview"
        data-state={previewImage && !imageFailed ? "logo" : "typography"}
        className="flex min-h-[152px] items-center justify-center overflow-hidden rounded-[9px] bg-[linear-gradient(115deg,#f4f0fc,#f0f5fc)] px-4 py-5 text-center min-[481px]:p-6"
      >
        {previewImage && !imageFailed ? (
          <PreviewImage
            key={previewImage}
            src={previewImage}
            alt={attempt ? "선택한 이미지 미리보기" : `${copy.title} 미리보기`}
            onFailed={() => setImageFailed(true)}
          />
        ) : (
          <div className="max-w-full">
            {typography.eyebrow && (
              <small className="mb-[7px] block text-[11px] text-[#726483]">{typography.eyebrow}</small>
            )}
            <strong className="block text-[23px] leading-[1.3] tracking-[-0.7px] text-[#413554] [overflow-wrap:anywhere] min-[481px]:text-[25px]">
              {typography.title}
            </strong>
            {typography.caption && (
              <p className="my-[7px] text-sm leading-normal text-[#675975] [overflow-wrap:anywhere]">
                {typography.caption}
              </p>
            )}
          </div>
        )}
      </div>
      <p className="mb-[17px] mt-2.5 text-xs leading-[1.7] text-[#6b7180] [overflow-wrap:anywhere]">{resolution}</p>
      {otherDirty && (
        <p className="mb-3 text-[11px] text-[#626977]">기본 정보 변경은 그 저장을 마친 뒤 적용 결과에 반영됩니다.</p>
      )}

      {showUnlink && (
        <button
          type="button"
          disabled={locked}
          onClick={() => selectMode("inherit")}
          className="min-h-10 border-0 bg-transparent px-0 py-1 text-xs font-medium text-[#4d6087] underline underline-offset-[3px] hover:text-[#244eac] disabled:cursor-not-allowed disabled:opacity-50"
        >
          직접 지정 해제 · 상속으로
        </button>
      )}

      <p className="mt-5 border-t border-[#eceef2] pt-[15px] text-[11px] leading-[1.75] text-[#626977]">
        연결 해제·교체는 파일 삭제가 아닙니다.
        <br />
        이전 URL은 계속 열릴 수 있습니다.
      </p>
    </section>

      <Notice
        refEl={noticeRef}
        phase={phase}
        message={message}
        conflictCurrent={conflictCurrent}
        conflictOwn={conflictOwn}
        frozen={frozen}
        onRetry={retry}
        onCheck={checkCurrent}
        onLoadLatest={loadLatest}
        savedBody={copy.savedBody}
      />

      <div className="mb-[9px] mt-5 flex justify-end gap-[9px]">
        <button
          type="button"
          onClick={cancelDraft}
          disabled={locked}
          className="min-h-11 min-w-[92px] flex-1 rounded-[7px] border border-[#ccd0d9] bg-white px-[17px] py-[9px] font-semibold text-[#343947] hover:bg-[#f3f5fa] disabled:cursor-not-allowed disabled:opacity-50 min-[481px]:flex-none"
        >
          취소
        </button>
        <button
          type="submit"
          form={formId}
          disabled={!canSave}
          className="min-h-11 min-w-[92px] flex-1 rounded-[7px] border border-[#245cce] bg-[#245cce] px-[17px] py-[9px] font-semibold text-white hover:bg-[#194cae] disabled:cursor-not-allowed disabled:opacity-50 min-[481px]:flex-none"
        >
          {phase === "saving" ? "저장 중…" : "저장"}
        </button>
      </div>
      <p className="text-left text-[11px] text-[#626977] min-[481px]:text-right" aria-live="polite">
        {saveNote}
      </p>
    </>
  );
}

/**
 * The preview <img>, failure-tracked by the shared hook: the edit page is
 * server-rendered, so a saved logo URL that 404s fast fails BEFORE
 * hydration and React never sees its error event — the hook's ref check
 * catches that case too. Remounted per URL (`key`), which resets it.
 */
function PreviewImage({ src, alt, onFailed }: { src: string; alt: string; onFailed: () => void }) {
  const { failed, imgProps } = useImageFallback();
  useEffect(() => {
    if (failed) onFailed();
  }, [failed, onFailed]);
  return (
    // Plain <img>: a local blob: preview or a storage URL — next/image
    // cannot optimise either usefully. object-contain: a logo is never
    // cropped or stretched.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      {...imgProps}
      className="block max-h-48 w-full object-contain"
    />
  );
}

function noopSubscribe() {
  return () => {};
}

function replyMessage(body: unknown): string | null {
  const m = (body as { message?: unknown } | null)?.message;
  return typeof m === "string" ? m : null;
}

function Notice({
  refEl,
  phase,
  message,
  conflictCurrent,
  conflictOwn,
  frozen,
  onRetry,
  onCheck,
  onLoadLatest,
  savedBody,
}: {
  refEl: React.RefObject<HTMLDivElement | null>;
  phase: Phase;
  message: string | null;
  conflictCurrent: AdminLogoAssignment | null;
  conflictOwn: ConflictMine;
  frozen: Frozen | null;
  onRetry: () => void;
  onCheck: () => void;
  onLoadLatest: () => void;
  savedBody?: string;
}) {
  const tone = {
    info: "border-[#b5caec] bg-[#eff5ff] text-[#305385]",
    warn: "border-[#ead3a4] bg-[#fff9ee] text-[#805818]",
    error: "border-[#edc4c1] bg-[#fff3f2] text-[#933b3a]",
    success: "border-[#b5d8c8] bg-[#eff8f4] text-[#306a54]",
  };
  const button =
    "mt-[9px] min-h-11 rounded-[7px] border border-current bg-white/50 px-[17px] py-[9px] text-xs font-semibold";

  let kind: keyof typeof tone = "info";
  let title: string;
  let body: string;
  let action: React.ReactNode = null;

  switch (phase) {
    case "saving":
      title = "저장 중입니다";
      body =
        frozen?.kind === "upload"
          ? "이미지 검증·업로드 후 연결을 저장합니다. 완료할 때까지 기다려 주세요."
          : "로고 표시 방식을 저장합니다. 완료할 때까지 기다려 주세요.";
      break;
    case "failure":
      kind = "error";
      title = "저장하지 못했습니다";
      body = `${message ?? "저장이 반영되지 않은 실패입니다."} 현재 적용값은 유지되었습니다.`;
      action = (
        <button type="button" className={button} onClick={onRetry}>
          다시 저장
        </button>
      );
      break;
    case "unknown":
    case "checking":
      kind = "warn";
      title = "저장 결과를 확인하지 못했습니다";
      body =
        message ??
        "서버에는 저장되었을 수 있습니다. 다시 저장하거나 되돌리기 전에 현재 상태를 확인하세요.";
      action = (
        <button type="button" className={button} onClick={onCheck} disabled={phase === "checking"}>
          {phase === "checking" ? "확인 중…" : "현재 상태 확인"}
        </button>
      );
      break;
    case "unchanged":
      title = "현재 값은 아직 바뀌지 않았습니다";
      body =
        "재조회에서 기존 적용값을 확인했습니다. 제출이 늦게 반영될 수도 있으므로 같은 내용으로만 다시 저장할 수 있습니다(중복 저장되지 않습니다).";
      action = (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={onRetry}>
            같은 내용으로 다시 저장
          </button>
          <button type="button" className={button} onClick={onCheck}>
            다시 확인
          </button>
        </div>
      );
      break;
    case "conflict":
    case "refreshing":
      kind = "error";
      title = "다른 곳에서 이미지 설정이 변경되었습니다";
      body =
        conflictOwn === "saved"
          ? "내 업로드는 저장되었지만 그 뒤 다른 곳에서 설정이 바뀌었습니다. 되돌리지 않습니다. 최신 값을 불러와 확인해 주세요. 이미지 외 입력값은 유지합니다."
          : conflictOwn === "unknown"
            ? "내 변경이 저장되었는지 확인할 수 없습니다. 저장된 뒤 다른 곳에서 다시 바뀌었을 수도 있습니다. 같은 값을 다시 고르기 전에 최신 값을 불러와 확인해 주세요. 이미지 외 입력값은 유지합니다."
            : `${message ? `${message} ` : ""}내 변경은 저장되지 않았습니다. 최신 값을 불러온 후 다시 선택해 주세요. 이미지 외 입력값은 유지합니다.`;
      action = (
        <>
          <div className="mt-2.5 border-t border-black/10 pt-[9px] text-[11px]">
            내 변경: {frozen?.kind === "upload" ? "새 이미지" : modeLabel(frozen?.kind === "mode" ? frozen.next : null)}
            <br />
            서버 최신값: {modeLabel(conflictCurrent)}
          </div>
          <button type="button" className={button} onClick={onLoadLatest} disabled={phase === "refreshing"}>
            {phase === "refreshing" ? "불러오는 중…" : "최신 값 불러오기 · 이미지 초안 폐기"}
          </button>
        </>
      );
      break;
    case "saved":
      kind = "success";
      title = "저장되었습니다";
      body = message ?? savedBody ?? "로고 설정을 저장했습니다. 목록으로 이동합니다.";
      break;
    case "savedStay":
      kind = "success";
      title = "로고만 저장했습니다";
      body =
        message ??
        "다른 입력에 저장하지 않은 변경이 있어 이 화면에 머뭅니다. 기본 정보는 아래 저장으로 따로 저장하세요.";
      break;
    case "reconciled":
      kind = "success";
      title = "현재 상태를 확인했습니다";
      body = "내 변경이 반영되어 있습니다. 추가로 저장할 필요가 없습니다.";
      break;
    case "refreshed":
      title = "최신 값을 불러왔습니다";
      body = "이전 초안은 폐기했습니다. 필요하면 다시 선택하세요.";
      break;
    case "invalid":
      kind = "error";
      title = "사용할 수 없는 파일입니다";
      body = `${message ?? "PNG, JPEG 또는 WebP 파일을 선택하세요."} 현재 적용값은 그대로입니다.`;
      break;
    case "cancelled":
      title = "변경을 취소했습니다";
      body = "업로드하거나 저장하지 않았습니다. 현재 적용값을 유지합니다.";
      break;
    default:
      return <div ref={refEl} tabIndex={-1} />;
  }

  return (
    <div
      ref={refEl}
      tabIndex={-1}
      role={kind === "error" ? "alert" : "status"}
      className={`mt-4 rounded-lg border p-4 text-xs outline-none focus-visible:outline-[3px] focus-visible:outline-[#7d5dd1] ${tone[kind]}`}
    >
      <strong className="mb-1 block text-[13px]">{title}</strong>
      <p className="my-[7px]">{body}</p>
      {action}
    </div>
  );
}
