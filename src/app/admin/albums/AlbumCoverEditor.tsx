"use client";

import { useEffect, useId, useRef, useState } from "react";
import { classifyImageSource } from "@/lib/imageSourceBadge";
import {
  IMAGE_INPUT_ACCEPT,
  precheckImageFile,
  startImageAttempt,
  type ImageAttempt,
} from "@/lib/imageUpload/client";

// Album cover editor (approved admin design 04-v1, album screen).
//
// Its own <form> with its own 표지 저장 / 표지 변경 취소, outside the
// album-info form: a cover save sends only the cover, so it can be
// conflict-checked and recovered on its own, and a cover conflict never
// blocks an info save (or vice versa).
//
// Album.imageUrl is the only current cover. Upload → managed URL, URL
// entry → that URL, unlink → null; nothing ever falls back to an older
// URL. Every write carries the value this editor last confirmed
// (`current.imageUrl`, verbatim) as the expected value.
//
// Outcome handling follows the shared upload contract:
//   saving   — every image control, save and cancel are locked;
//   unknown  — the response was lost / unobservable: still locked. The
//              operator resolves it with 현재 상태 확인 (a read), never
//              with a blind resend: a URL write that did commit would
//              conflict with itself on a resend;
//   conflict — someone else changed the cover. Nothing of this draft was
//              saved (unless the server says the upload committed
//              earlier and was superseded afterwards). 최신 값 불러오기
//              re-reads the server and drops only the image draft;
//   failed   — known not saved: the current cover is intact; the action
//              offered depends on why (re-pick the file, sign in again,
//              or resend the same attempt).

export type CoverProvenance = {
  sourceUrl: string | null;
  usageNote: string | null;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: string;
};

type Current = { imageUrl: string | null; provenance: CoverProvenance | null };

type Draft =
  | { kind: "none" }
  | { kind: "url"; value: string }
  | { kind: "unlink" }
  | { kind: "upload"; attempt: ImageAttempt };

/** What was sent, frozen until its outcome is definite. */
type Submitted =
  | { kind: "url"; expected: string | null; next: string | null }
  | {
      kind: "upload";
      attempt: ImageAttempt;
      expected: string | null;
      sourceUrl: string;
      usageNote: string;
    };

type Phase =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; reconciled: boolean }
  | { kind: "unknown"; checkError?: string }
  | { kind: "unchanged" }
  | {
      kind: "conflict";
      attemptCommitted: boolean;
      latest: string | null | undefined;
    }
  | { kind: "attempt_conflict" }
  | {
      kind: "failed";
      code: string;
      message: string;
      retry: "same" | "reselect" | "relogin" | "none";
    }
  | { kind: "refreshed" }
  | { kind: "cancelled" }
  | { kind: "invalid"; message: string };

type CoverStateResponse = {
  imageUrl: string | null;
  provenance: CoverProvenance | null;
  attempt?:
    | { state: "committed"; assetId: string; publicUrl: string }
    | { state: "not-observed" }
    | { state: "ambiguous" }
    | { state: "unavailable" };
};

const RESELECT_CODES = new Set([
  "unsupported_image_type",
  "invalid_image",
  "image_dimensions",
  "image_too_large",
  "request_too_large",
]);

function normalizeUrl(value: string): string | null {
  const v = value.trim();
  return v === "" ? null : v;
}

function errorFields(body: unknown): {
  error?: string;
  message?: string;
  current?: { imageUrl?: string | null };
  attemptCommitted?: boolean;
} {
  return body !== null && typeof body === "object" ? (body as never) : {};
}

export default function AlbumCoverEditor({
  albumId,
  albumTitle,
  initial,
  r2PublicHost,
  uploadConfigured,
  onDirtyChange,
}: {
  albumId: string;
  albumTitle: string;
  initial: Current;
  r2PublicHost: string | null;
  uploadConfigured: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const coverUrl = `/api/admin/albums/${albumId}/cover`;
  const [current, setCurrent] = useState<Current>(initial);
  const [tab, setTab] = useState<"url" | "upload">("url");
  const [urlInput, setUrlInput] = useState(initial.imageUrl ?? "");
  const [draft, setDraft] = useState<Draft>({ kind: "none" });
  const [sourceUrl, setSourceUrl] = useState("");
  const [usageNote, setUsageNote] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const noticeRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ids = useId();

  const locked =
    phase.kind === "saving" ||
    phase.kind === "unknown" ||
    phase.kind === "conflict";
  const dirty = draft.kind !== "none";

  useEffect(() => {
    onDirtyChange?.(dirty || locked);
  }, [dirty, locked, onDirtyChange]);

  // Local preview lifetime: every attempt this editor created stays in
  // `liveAttempts` until neither the draft nor the submitted request
  // (still awaiting a definite outcome) refers to it; then its blob URL
  // is released. Unmount releases whatever is left.
  const liveAttempts = useRef(new Set<ImageAttempt>());
  useEffect(() => {
    const keep = new Set<ImageAttempt>();
    if (draft.kind === "upload") keep.add(draft.attempt);
    if (submitted?.kind === "upload") keep.add(submitted.attempt);
    for (const a of liveAttempts.current) {
      if (!keep.has(a)) {
        a.cancel();
        liveAttempts.current.delete(a);
      }
    }
    for (const a of keep) liveAttempts.current.add(a);
  }, [draft, submitted]);
  useEffect(() => {
    const live = liveAttempts.current;
    return () => {
      for (const a of live) a.cancel();
      live.clear();
    };
  }, []);

  function focusNotice() {
    // After React commits the new notice.
    requestAnimationFrame(() => noticeRef.current?.focus());
  }

  function resetDraft(nextCurrent: Current = current) {
    setDraft({ kind: "none" });
    setUrlInput(nextCurrent.imageUrl ?? "");
    setSourceUrl("");
    setUsageNote("");
    setPreviewFailed(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function cancelChanges() {
    if (locked) return;
    const hadDraft = dirty;
    resetDraft();
    setSubmitted(null);
    setPhase(hadDraft ? { kind: "cancelled" } : { kind: "idle" });
  }

  function switchTab(next: "url" | "upload") {
    if (locked || next === tab) return;
    setTab(next);
    cancelChanges();
  }

  function onUrlChange(value: string) {
    setUrlInput(value);
    setPreviewFailed(false);
    setSubmitted(null);
    setPhase({ kind: "idle" });
    const next = normalizeUrl(value);
    if (next === current.imageUrl) setDraft({ kind: "none" });
    else if (next === null) setDraft({ kind: "unlink" });
    else setDraft({ kind: "url", value });
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    const problem = precheckImageFile(file);
    if (problem) {
      if (fileRef.current) fileRef.current.value = "";
      setPhase({ kind: "invalid", message: problem });
      return;
    }
    setSubmitted(null);
    setPreviewFailed(false);
    setDraft({ kind: "upload", attempt: startImageAttempt(file) });
    setPhase({ kind: "idle" });
  }

  function unlink() {
    if (locked) return;
    setUrlInput("");
    setSourceUrl("");
    setUsageNote("");
    setSubmitted(null);
    setPreviewFailed(false);
    setDraft({ kind: "unlink" });
    setPhase({ kind: "idle" });
  }

  function applySaved(
    imageUrl: string | null,
    provenance: CoverProvenance | null,
    reconciled: boolean,
  ) {
    const nextCurrent = { imageUrl, provenance };
    setCurrent(nextCurrent);
    resetDraft(nextCurrent);
    setSubmitted(null);
    setPhase({ kind: "saved", reconciled });
    focusNotice();
  }

  async function readState(attemptId?: string): Promise<CoverStateResponse> {
    const qs = attemptId ? `?attemptId=${encodeURIComponent(attemptId)}` : "";
    const res = await fetch(`${coverUrl}${qs}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as CoverStateResponse;
  }

  async function refreshProvenance(imageUrl: string | null) {
    try {
      const state = await readState();
      if (state.imageUrl === imageUrl)
        setCurrent({ imageUrl, provenance: state.provenance });
    } catch {
      // Display-only; the saved value is already confirmed.
    }
  }

  /** The upload request, identical on every resend of the attempt. */
  function submitUpload(sub: Extract<Submitted, { kind: "upload" }>) {
    return sub.attempt.submit(coverUrl, {
      expectedImageUrl: sub.expected ?? "",
      sourceUrl: sub.sourceUrl,
      usageNote: sub.usageNote,
    });
  }

  async function send(sub: Submitted) {
    setSubmitted(sub);
    setPhase({ kind: "saving" });
    if (sub.kind === "upload") {
      let outcome: Awaited<ReturnType<ImageAttempt["submit"]>>;
      try {
        outcome = await submitUpload(sub);
      } catch {
        // submit() itself threw (e.g. the attempt was released). Never
        // leave the editor locked on "saving"; a re-read settles it.
        setPhase({ kind: "unknown" });
        focusNotice();
        return;
      }
      handleUploadOutcome(outcome);
      return;
    }

    let res: Response;
    try {
      res = await fetch(coverUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          expectedImageUrl: sub.expected,
          imageUrl: sub.next,
        }),
      });
    } catch {
      setPhase({ kind: "unknown" });
      focusNotice();
      return;
    }
    const body: unknown = await res.json().catch(() => null);
    if (res.ok) {
      const b = body as {
        imageUrl?: string | null;
        provenance?: CoverProvenance | null;
      } | null;
      if (!b || !("imageUrl" in b)) {
        // Saved, but the reply does not say to what: re-read rather than
        // guess (and never stay locked on "saving").
        setPhase({ kind: "unknown" });
        focusNotice();
        return;
      }
      applySaved(b.imageUrl ?? null, b.provenance ?? null, false);
      return;
    }
    handleFailure(res.status, body);
  }

  function handleUploadOutcome(
    outcome: Awaited<ReturnType<ImageAttempt["submit"]>>,
  ) {
    if (outcome.kind === "saved") {
      const asset = (outcome.body as { asset?: { publicUrl?: string } } | null)
        ?.asset;
      if (!asset?.publicUrl) {
        // A success without the assigned URL cannot be shown as "no
        // cover" - that would claim an unlink. Re-read instead.
        setPhase({ kind: "unknown" });
        focusNotice();
        return;
      }
      applySaved(asset.publicUrl, null, outcome.status === "reconciled");
      void refreshProvenance(asset.publicUrl);
      return;
    }
    if (outcome.kind === "unknown") {
      setPhase({ kind: "unknown" });
      focusNotice();
      return;
    }
    handleFailure(
      outcome.kind === "conflict" ? 409 : (outcome.httpStatus ?? 0),
      outcome.body,
    );
  }

  function handleFailure(status: number, body: unknown) {
    const f = errorFields(body);
    const outcome = (body as { outcome?: string } | null)?.outcome;
    if (outcome === "unknown" || (outcome === undefined && status >= 500)) {
      setPhase({ kind: "unknown" });
    } else if (f.error === "attempt_conflict") {
      setPhase({ kind: "attempt_conflict" });
    } else if (outcome === "conflict" || status === 409) {
      setPhase({
        kind: "conflict",
        attemptCommitted: f.attemptCommitted === true,
        latest: f.current ? (f.current.imageUrl ?? null) : undefined,
      });
    } else if (status === 401) {
      setPhase({
        kind: "failed",
        code: "unauthorized",
        message:
          "관리자 로그인이 만료되었습니다. 다른 탭에서 다시 로그인한 뒤 저장해 주세요.",
        retry: "relogin",
      });
    } else {
      const code = f.error ?? `http_${status}`;
      setPhase({
        kind: "failed",
        code,
        message: f.message ?? "저장하지 못했습니다. 현재 표지는 그대로입니다.",
        retry: RESELECT_CODES.has(code)
          ? "reselect"
          : code === "storage_not_configured" ||
              code === "target_not_found" ||
              code === "invalid_request"
            ? "none"
            : "same",
      });
    }
    focusNotice();
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (locked || !dirty) return;
    if (draft.kind === "upload") {
      void send({
        kind: "upload",
        attempt: draft.attempt,
        expected: current.imageUrl,
        sourceUrl: sourceUrl.trim(),
        usageNote: usageNote.trim(),
      });
    } else {
      void send({
        kind: "url",
        expected: current.imageUrl,
        next: draft.kind === "url" ? normalizeUrl(draft.value) : null,
      });
    }
  }

  /** Same request again — same attempt, same expected value. */
  function retrySame() {
    if (submitted) void send(submitted);
  }

  async function checkState() {
    if (!submitted) return;
    const attemptId =
      submitted.kind === "upload" ? submitted.attempt.attemptId : undefined;
    let state: CoverStateResponse;
    try {
      state = await readState(attemptId);
    } catch {
      setPhase({
        kind: "unknown",
        checkError:
          "현재 상태를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.",
      });
      focusNotice();
      return;
    }
    if (submitted.kind === "upload") {
      const a = state.attempt;
      if (a?.state === "committed") {
        if (state.imageUrl === a.publicUrl) {
          // Committed and still current. Resend the same attempt once:
          // the server answers "reconciled" without assigning again, and
          // that path expires the public cache, which the lost request
          // may never have reached. Its result cannot undo the confirmed
          // save. Started before the draft is cleared below, which
          // releases the attempt's local preview.
          void submitUpload(submitted).catch(() => undefined);
          applySaved(state.imageUrl, state.provenance, true);
          return;
        }
        setPhase({
          kind: "conflict",
          attemptCommitted: true,
          latest: state.imageUrl,
        });
      } else if (a?.state === "not-observed") {
        if (state.imageUrl === submitted.expected) {
          setPhase({ kind: "unchanged" });
        } else {
          setPhase({
            kind: "conflict",
            attemptCommitted: false,
            latest: state.imageUrl,
          });
        }
      } else {
        setPhase({
          kind: "unknown",
          checkError:
            "이 업로드의 저장 여부를 판정할 수 없습니다. 새로고침해 현재 표지를 확인해 주세요.",
        });
      }
    } else if (state.imageUrl === submitted.next) {
      // The cover now holds the requested value. Whether this request or
      // another one wrote it cannot be told apart; say only that.
      applySaved(state.imageUrl, state.provenance, true);
    } else if (state.imageUrl === submitted.expected) {
      setPhase({ kind: "unchanged" });
    } else {
      setPhase({
        kind: "conflict",
        attemptCommitted: false,
        latest: state.imageUrl,
      });
    }
    focusNotice();
  }

  async function loadLatest() {
    let state: CoverStateResponse;
    try {
      state = await readState();
    } catch {
      setPhase((p) =>
        p.kind === "conflict"
          ? p
          : { kind: "unknown", checkError: "최신 값을 불러오지 못했습니다." },
      );
      return;
    }
    const nextCurrent = {
      imageUrl: state.imageUrl,
      provenance: state.provenance,
    };
    setCurrent(nextCurrent);
    resetDraft(nextCurrent);
    setSubmitted(null);
    setTab("url");
    setPhase({ kind: "refreshed" });
    focusNotice();
  }

  function reselect() {
    resetDraft();
    setSubmitted(null);
    setTab("upload");
    setPhase({ kind: "idle" });
    requestAnimationFrame(() => fileRef.current?.focus());
  }

  // ── derived display ────────────────────────────────────────────────

  const r2 = { r2Host: r2PublicHost };
  function describe(c: Current): string {
    if (!c.imageUrl) return "표지 없음";
    if (c.provenance) return "업로드 이미지 · R2";
    return `URL · ${classifyImageSource(c.imageUrl, r2).label}`;
  }

  const currentBadge =
    phase.kind === "unknown"
      ? "결과 미확정"
      : phase.kind === "conflict"
        ? "다른 곳에서 변경됨"
        : describe(current);
  const summaryLead =
    phase.kind === "unknown" || phase.kind === "conflict"
      ? "마지막 확인값"
      : "현재 적용";

  // What the preview shows: the submitted draft while saving / unknown,
  // otherwise the draft, otherwise the current cover.
  const shown: { kind: "image"; src: string; alt: string } | { kind: "empty" } =
    (() => {
      const fromSubmitted =
        (phase.kind === "saving" || phase.kind === "unknown") && submitted
          ? submitted.kind === "upload"
            ? {
                kind: "image" as const,
                src: submitted.attempt.previewUrl,
                alt: "제출한 이미지 미리보기",
              }
            : submitted.next
              ? {
                  kind: "image" as const,
                  src: submitted.next,
                  alt: "제출한 표지 URL 미리보기",
                }
              : { kind: "empty" as const }
          : null;
      if (fromSubmitted) return fromSubmitted;
      if (draft.kind === "upload")
        return {
          kind: "image",
          src: draft.attempt.previewUrl,
          alt: "선택한 이미지 미리보기",
        };
      if (draft.kind === "url")
        return {
          kind: "image",
          src: draft.value.trim(),
          alt: "입력한 표지 URL 미리보기",
        };
      if (draft.kind === "unlink") return { kind: "empty" };
      return current.imageUrl
        ? {
            kind: "image",
            src: current.imageUrl,
            alt: `${albumTitle} 현재 표지`,
          }
        : { kind: "empty" };
    })();

  const previewTitle =
    phase.kind === "unknown"
      ? "제출한 이미지 · 결과 확인 필요"
      : dirty
        ? "저장 후 적용될 모습"
        : "적용 결과";
  const draftBadge =
    phase.kind === "unknown"
      ? "미확정"
      : phase.kind === "saving"
        ? "처리 중"
        : dirty
          ? "저장 전"
          : "현재 상태";

  const resolution = (() => {
    switch (phase.kind) {
      case "unknown":
        return "제출한 이미지의 미리보기입니다. 업로드·연결이 완료되었는지는 현재 상태 확인 전까지 알 수 없습니다.";
      case "saving":
        return "제출한 이미지의 미리보기입니다. 저장 완료 전에는 현재 적용값으로 확정하지 않습니다.";
      case "unchanged":
        return "현재 연결은 이전값입니다. 초안을 확인한 뒤 다시 저장할 수 있습니다.";
      case "conflict":
        return "충돌로 반영되지 않은 초안입니다. 최신 표지를 다시 불러와 확인해 주세요.";
      case "failed":
        return "이 초안은 반영되지 않았습니다. 기존 표지를 유지합니다.";
    }
    if (previewFailed)
      return "현재 URL은 유지됩니다. 이미지 표시 실패가 표지 연결을 해제하지는 않습니다.";
    if (draft.kind === "unlink")
      return "저장하면 현재 표지가 비어 있게 됩니다. 교체 전 URL을 다시 사용하지 않습니다.";
    if (draft.kind === "upload")
      return "아직 업로드하지 않았습니다. 선택 취소 시 현재 적용 상태로 돌아갑니다.";
    if (draft.kind === "url")
      return "저장하면 이 URL이 현재 표지가 됩니다. 서버는 이 주소를 내려받지 않습니다.";
    if (!current.imageUrl)
      return "현재 표지가 없습니다. 이전 이미지로 돌아가지 않습니다.";
    return current.provenance
      ? "현재 표지는 업로드한 이미지 한 개입니다. 다른 앨범 정보만 수정하면 표지는 그대로 유지합니다."
      : "현재 표지는 이 URL 한 개입니다. 다른 앨범 정보만 수정하면 표지는 그대로 유지합니다.";
  })();

  const saveNote =
    phase.kind === "unknown"
      ? "현재 상태를 확인한 뒤 다음 동작을 선택하세요."
      : phase.kind === "saving"
        ? "저장 결과를 기다리고 있습니다."
        : phase.kind === "conflict"
          ? "최신 값을 불러온 뒤 다시 선택하세요."
          : dirty
            ? "표지 저장을 눌러야 표지 변경이 적용됩니다. 앨범 정보 저장은 표지를 저장하지 않습니다."
            : "표지 변경 사항이 없습니다.";

  const draftSource = classifyImageSource(urlInput.trim(), r2);

  return (
    <form
      onSubmit={onSave}
      aria-labelledby={`${ids}-title`}
      className="space-y-4"
      data-testid="album-cover-editor"
    >
      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="text-xs text-zinc-500">이미지 설정</span>
            <h2 id={`${ids}-title`} className="text-lg font-bold">
              앨범 표지
            </h2>
          </div>
          <span
            className="rounded bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-600"
            data-testid="cover-current-badge"
          >
            {currentBadge}
          </span>
        </div>
        <p className="mt-3 border-b border-zinc-100 pb-4 text-xs break-all text-zinc-600">
          {summaryLead}: {describe(current)}
          {current.imageUrl ? ` · ${current.imageUrl}` : ""}
        </p>

        <fieldset disabled={locked} className="mt-4 min-w-0">
          <legend className="mb-2 text-xs font-semibold">표지 변경 방법</legend>
          <div
            className="flex gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1"
            role="group"
            aria-label="표지 변경 방법"
          >
            {(
              [
                ["upload", "파일 업로드"],
                ["url", "URL 입력"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={tab === value}
                onClick={() => switchTab(value)}
                className={`min-h-10 flex-1 rounded-md px-2 text-sm font-semibold ${
                  tab === value
                    ? "bg-white text-blue-700 shadow-sm"
                    : "text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "url" ? (
            <div className="mt-4">
              <label
                htmlFor={`${ids}-url`}
                className="mb-1 flex items-center gap-2 text-xs font-semibold"
              >
                표지 이미지 URL
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${draftSource.color}`}
                >
                  {draftSource.label}
                </span>
              </label>
              <input
                id={`${ids}-url`}
                type="url"
                inputMode="url"
                value={urlInput}
                onChange={(e) => onUrlChange(e.target.value)}
                placeholder="R2 URL 또는 Amazon CDN URL (m.media-amazon.com)"
                className="w-full rounded border border-zinc-300 px-3 py-2 font-mono text-xs"
              />
              <p className="mt-1 text-xs text-zinc-500">
                기존 외부 URL은 명시적으로 바꾸기 전까지 유지합니다.
              </p>
              {draftSource.warn && urlInput.trim() !== "" && (
                <p className="mt-1 text-xs text-red-600">
                  정책 외 URL입니다. 임시 placeholder라면 wiki/log.md 에
                  기록하세요 (album-image-source-policy).
                </p>
              )}
              <p
                className="mt-1 text-xs break-all text-zinc-500"
                data-testid="cover-provenance"
              >
                출처 메타데이터:{" "}
                {current.provenance
                  ? `관리 업로드 · ${current.provenance.width}×${current.provenance.height} · ${
                      current.provenance.sourceUrl
                        ? `출처 ${current.provenance.sourceUrl}`
                        : "출처 미기록"
                    }${current.provenance.usageNote ? ` · 메모: ${current.provenance.usageNote}` : ""}`
                  : "등록 정보 없음"}
              </p>
            </div>
          ) : (
            <div className="mt-4">
              <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4">
                <strong className="block text-sm">
                  {draft.kind === "upload" ? "선택한 파일" : "이미지 파일 선택"}
                </strong>
                {!uploadConfigured && (
                  <p className="mt-1 text-xs text-red-600">
                    이미지 저장소(R2)가 설정되지 않아 지금은 업로드할 수
                    없습니다. URL 입력은 계속 사용할 수 있습니다.
                  </p>
                )}
                {draft.kind === "upload" ? (
                  <>
                    <p className="mt-1 text-xs break-all text-zinc-600">
                      {draft.attempt.file.name}{" "}
                      <span className="text-zinc-500">
                        · 이 브라우저에서만 미리보기
                      </span>
                    </p>
                    <button
                      type="button"
                      onClick={cancelChanges}
                      className="mt-2 min-h-10 rounded border border-zinc-300 bg-white px-3 text-sm hover:bg-zinc-50"
                    >
                      선택 취소
                    </button>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-xs text-zinc-600">
                      PNG · JPEG · WebP (4MB 이하). 투명도와 원본 비율을
                      유지합니다.
                    </p>
                    <input
                      ref={fileRef}
                      type="file"
                      accept={IMAGE_INPUT_ACCEPT}
                      aria-label="표지 이미지 파일 선택"
                      disabled={!uploadConfigured}
                      onChange={(e) => onFile(e.target.files?.[0])}
                      className="mt-2 block w-full text-xs"
                    />
                    <p className="mt-1 text-xs text-zinc-500">
                      선택만으로 업로드되지 않습니다.
                    </p>
                  </>
                )}
              </div>
              {draft.kind === "upload" && (
                <div className="mt-4 grid gap-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold">
                      출처 URL{" "}
                      <span className="font-normal text-zinc-500">
                        (선택 · 관리자만)
                      </span>
                    </span>
                    <input
                      type="url"
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                      placeholder="https://…"
                      className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold">
                      관리 메모{" "}
                      <span className="font-normal text-zinc-500">
                        (선택 · 비공개)
                      </span>
                    </span>
                    <textarea
                      value={usageNote}
                      onChange={(e) => setUsageNote(e.target.value)}
                      placeholder="출처·사용 검토 내용을 기록하세요"
                      className="min-h-20 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <p className="text-xs text-zinc-500">
                    출처와 메모는 공개 페이지에 표시되지 않습니다.
                  </p>
                </div>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-zinc-500">
            입력 방법을 바꾸면 저장 전 이미지 초안을 취소합니다.
          </p>
        </fieldset>

        <div className="mt-6 mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{previewTitle}</h3>
          <span className="rounded bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-800">
            {draftBadge}
          </span>
        </div>
        <div
          className="flex min-h-44 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-violet-50 to-blue-50 p-5 text-center"
          data-testid="cover-preview"
        >
          {shown.kind === "image" && !previewFailed ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered hosts; next/image would need every host allow-listed
            <img
              key={shown.src}
              src={shown.src}
              alt={shown.alt}
              referrerPolicy="no-referrer"
              onError={() => setPreviewFailed(true)}
              // The server-rendered <img> can fail before hydration
              // attaches onError; catch that case when React mounts it.
              ref={(el) => {
                if (el && el.complete && el.naturalWidth === 0)
                  setPreviewFailed(true);
              }}
              className="h-40 w-40 object-contain"
            />
          ) : (
            <div className="text-sm text-zinc-600">
              {shown.kind === "image"
                ? "표지를 불러올 수 없습니다"
                : "표지 없음"}
              <br />
              <small className="text-xs text-zinc-500">
                {shown.kind === "image"
                  ? albumTitle
                  : "이전 이미지로 돌아가지 않습니다"}
              </small>
            </div>
          )}
        </div>
        <p className="mt-2 text-xs break-words text-zinc-600">{resolution}</p>

        {draft.kind !== "unlink" && current.imageUrl !== null && (
          <button
            type="button"
            onClick={unlink}
            disabled={locked}
            className="mt-3 min-h-10 text-sm text-zinc-700 underline underline-offset-4 hover:text-blue-700 disabled:opacity-50"
          >
            표지 연결 해제
          </button>
        )}

        <p className="mt-4 border-t border-zinc-100 pt-4 text-xs text-zinc-500">
          연결 해제·교체는 파일 삭제가 아닙니다.
          <br />
          이전 URL은 계속 열릴 수 있습니다.
        </p>
      </section>

      <div
        ref={noticeRef}
        tabIndex={-1}
        aria-live="polite"
        className="outline-none"
      >
        <Notice
          phase={phase}
          submitted={submitted}
          current={current}
          describeUrl={(u) => (u ? u : "표지 없음")}
          onCheck={checkState}
          onRetry={retrySame}
          onLoadLatest={loadLatest}
          onReselect={reselect}
        />
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={cancelChanges}
          disabled={locked || !dirty}
          className="min-h-11 flex-1 rounded border border-zinc-300 bg-white px-5 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-50 sm:flex-none"
        >
          표지 변경 취소
        </button>
        <button
          type="submit"
          disabled={
            locked || !dirty || (draft.kind === "upload" && !uploadConfigured)
          }
          className="min-h-11 flex-1 rounded bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 sm:flex-none"
        >
          {phase.kind === "saving" ? "저장 중…" : "표지 저장"}
        </button>
      </div>
      <p className="text-right text-xs text-zinc-500 max-sm:text-left">
        {saveNote}
      </p>
    </form>
  );
}

function Notice({
  phase,
  submitted,
  current,
  describeUrl,
  onCheck,
  onRetry,
  onLoadLatest,
  onReselect,
}: {
  phase: Phase;
  submitted: Submitted | null;
  current: Current;
  describeUrl: (u: string | null) => string;
  onCheck: () => void;
  onRetry: () => void;
  onLoadLatest: () => void;
  onReselect: () => void;
}) {
  const box = (
    tone: "info" | "success" | "warn" | "error",
    title: string,
    body: React.ReactNode,
    action?: React.ReactNode,
  ) => {
    const tones = {
      info: "border-zinc-200 bg-zinc-50",
      success: "border-emerald-200 bg-emerald-50",
      warn: "border-amber-300 bg-amber-50",
      error: "border-red-200 bg-red-50",
    };
    return (
      <div
        className={`rounded-lg border p-4 text-sm ${tones[tone]}`}
        role={tone === "error" ? "alert" : "status"}
        data-testid="cover-notice"
      >
        <strong className="block">{title}</strong>
        <div className="mt-1 text-xs text-zinc-700">{body}</div>
        {action && <div className="mt-3">{action}</div>}
      </div>
    );
  };
  const btn = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="min-h-10 rounded border border-zinc-300 bg-white px-3 text-sm font-semibold hover:bg-zinc-50"
    >
      {label}
    </button>
  );
  const myDraft =
    submitted?.kind === "upload"
      ? "업로드한 새 이미지"
      : submitted
        ? describeUrl(submitted.next)
        : "이미지 초안";

  switch (phase.kind) {
    case "saving":
      return box(
        "info",
        "저장 중입니다",
        "이미지 검증·업로드 후 연결을 저장합니다. 완료할 때까지 기다려 주세요.",
      );
    case "saved":
      return phase.reconciled
        ? box(
            "success",
            "현재 상태를 확인했습니다",
            "현재 표지가 요청한 값입니다. 추가로 저장할 필요가 없습니다.",
          )
        : box(
            "success",
            "저장되었습니다",
            "현재 표지가 갱신되었습니다. 이 화면에 머무릅니다.",
          );
    case "unknown":
      return box(
        "warn",
        "저장 결과를 확인하지 못했습니다",
        <>
          서버에는 저장되었을 수 있습니다. 다시 저장하거나 되돌리기 전에 현재
          상태를 확인하세요.
          {phase.checkError && (
            <p className="mt-1 text-red-700">{phase.checkError}</p>
          )}
        </>,
        btn("현재 상태 확인", onCheck),
      );
    case "unchanged":
      return box(
        "info",
        "현재 값은 변경되지 않았습니다",
        "재조회에서 기존 적용값을 확인했습니다. 초안을 확인한 후 다시 저장할 수 있습니다.",
        submitted?.kind === "upload"
          ? btn("같은 파일로 다시 저장", onRetry)
          : btn("다시 저장", onRetry),
      );
    case "conflict":
      return box(
        "error",
        phase.attemptCommitted
          ? "저장된 뒤 다른 곳에서 표지가 바뀌었습니다"
          : "다른 곳에서 표지가 변경되었습니다",
        <>
          {phase.attemptCommitted
            ? "이 업로드는 저장되었지만, 그 뒤 다른 변경이 있었습니다. 최신 값을 확인한 뒤 다시 선택하세요."
            : "내 변경은 저장하지 않았습니다. 최신 값을 불러온 후 다시 선택해 주세요. 이미지 외 입력값은 유지합니다."}
          <p className="mt-2 break-all">
            내 변경: {myDraft}
            <br />
            마지막 확인값: {describeUrl(current.imageUrl)}
            {phase.latest !== undefined && (
              <>
                <br />
                서버 응답 시점 값: {describeUrl(phase.latest)}
              </>
            )}
          </p>
        </>,
        btn("최신 값 불러오기 · 이미지 초안 폐기", onLoadLatest),
      );
    case "attempt_conflict":
      return box(
        "error",
        "같은 업로드 시도로 다른 파일이 이미 저장되어 있습니다",
        "현재 표지는 그대로입니다. 파일을 다시 선택해 새로 업로드하세요.",
        btn("파일 다시 선택", onReselect),
      );
    case "failed":
      return box(
        "error",
        "저장하지 못했습니다",
        <>{phase.message} 현재 적용값은 유지되었습니다.</>,
        phase.retry === "same"
          ? btn(
              submitted?.kind === "upload"
                ? "같은 파일로 다시 저장"
                : "다시 저장",
              onRetry,
            )
          : phase.retry === "reselect"
            ? btn("파일 다시 선택", onReselect)
            : phase.retry === "relogin"
              ? btn("다시 저장", onRetry)
              : undefined,
      );
    case "refreshed":
      return box(
        "info",
        "최신 값을 불러왔습니다",
        `현재 표지: ${describeUrl(current.imageUrl)}. 이전 초안은 폐기했습니다. 필요하면 다시 선택하세요.`,
      );
    case "cancelled":
      return box(
        "info",
        "변경을 취소했습니다",
        "업로드하거나 저장하지 않았습니다. 현재 적용값을 유지합니다.",
      );
    case "invalid":
      return box(
        "error",
        "사용할 수 없는 파일입니다",
        `${phase.message} 현재 적용값은 그대로입니다.`,
      );
    default:
      return null;
  }
}
