"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { Drawer } from "vaul";
import {
  SongSearch,
  type SongSearchResult,
  type SongVariant,
} from "@/components/SongSearch";
import {
  PerformerChecklist,
  type PerformerOption,
} from "@/components/PerformerChecklist";
import { IssueTypeSelector } from "@/components/ContestReportSheet/IssueTypeSelector";
import { MAX_COMMENT_CHARS } from "@/lib/contestReportPayload";
import type { ContestReportType } from "@/generated/prisma/enums";

interface Props {
  eventId: string;
  setlistItemId: number | null;
  locale: string;
  open: boolean;
  onClose: () => void;
  /**
   * Called after a successful submit. Parent uses this to close
   * the sheet and (optionally) surface a success toast. Receives
   * the new ContestReport id for any follow-up local-storage
   * write the parent may want.
   */
  onSubmitSuccess: (reportId: string) => void;
}

interface State {
  type: ContestReportType;
  selectedSong: SongSearchResult | null;
  selectedVariant: SongVariant | null;
  missingPerformerIds: Set<string>;
  comment: string;
  submitting: boolean;
  error: string | null;
}

type Action =
  | { type: "SET_TYPE"; payload: ContestReportType }
  | {
      type: "SET_SONG";
      payload: { song: SongSearchResult; variant: SongVariant | undefined };
    }
  | { type: "TOGGLE_PERFORMER"; payload: string }
  | { type: "SET_COMMENT"; payload: string }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_ERROR"; payload: string }
  | { type: "RESET" };

function initialState(): State {
  return {
    type: "wrong_song",
    selectedSong: null,
    selectedVariant: null,
    missingPerformerIds: new Set(),
    comment: "",
    submitting: false,
    error: null,
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_TYPE":
      // Type flip clears type-specific fields; comment persists so
      // a user typing notes and then switching type doesn't lose
      // their input.
      return {
        ...state,
        type: action.payload,
        selectedSong: null,
        selectedVariant: null,
        missingPerformerIds: new Set(),
      };
    case "SET_SONG":
      return {
        ...state,
        selectedSong: action.payload.song,
        selectedVariant: action.payload.variant ?? null,
      };
    case "TOGGLE_PERFORMER": {
      const next = new Set(state.missingPerformerIds);
      if (next.has(action.payload)) next.delete(action.payload);
      else next.add(action.payload);
      return { ...state, missingPerformerIds: next };
    }
    case "SET_COMMENT":
      return { ...state, comment: action.payload };
    case "SUBMIT_START":
      return { ...state, submitting: true, error: null };
    case "SUBMIT_ERROR":
      return { ...state, submitting: false, error: action.payload };
    case "RESET":
      return initialState();
  }
}

/**
 * Phase 1C operator-queue contest report sheet. Sibling to
 * `<AddItemBottomSheet>` — distinct intent (file a report for
 * operator triage, not create a real-time sibling). Reuses the
 * vaul Drawer wrapper + `<SongSearch>` + `<PerformerChecklist>`
 * from the AddItemBottomSheet stack.
 *
 * Type-driven conditional fields:
 *   wrong_song        → SongSearch (no variant picker)
 *   missing_performer → PerformerChecklist (fetched on open)
 *   wrong_variant     → SongSearch with variantPicker enabled
 *   other             → comment-only
 *
 * The `comment` textarea is rendered for ALL types; required only
 * for `other` (server enforces; client also gates submit).
 */
export function ContestReportSheet({
  eventId,
  setlistItemId,
  locale,
  open,
  onClose,
  onSubmitSuccess,
}: Props) {
  const t = useTranslations("IssueReport");

  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const {
    type,
    selectedSong,
    selectedVariant,
    missingPerformerIds,
    comment,
    submitting,
    error,
  } = state;

  // Frozen target setlistItemId — captured at open. Subsequent
  // parent re-renders shouldn't shift it during deliberation
  // (mirrors the AddItemBottomSheet freeze pattern).
  const [frozenItemId, setFrozenItemId] = useState<number | null>(null);

  // Event performers — fetched lazily on first open. Same caching
  // strategy as AddItemBottomSheet: fetchedKeyRef tracks "have we
  // started a fetch for this eventId already" so re-opens reuse
  // the data without a round-trip.
  const [eventPerformers, setEventPerformers] = useState<
    PerformerOption[] | null
  >(null);
  // Surfaces a friendly message in the missing_performer branch
  // when the performers fetch failed (network, 404, 500). Without
  // this, the user would see a blank area with no indication that
  // loading went sideways.
  const [performerFetchFailed, setPerformerFetchFailed] = useState(false);
  const fetchedKeyRef = useRef<string | null>(null);

  // Capture setlistItemId on open transition. Reset on close.
  // The `react-hooks/set-state-in-effect` rule (ships with
  // eslint-config-next 16.x) flags intentional prop-to-local-state
  // snapshots — but the freeze IS the design (mirrors
  // AddItemBottomSheet's pattern; same rationale in PR #362). The
  // recommended alternative (compute on render via useMemo) does
  // not work here because we specifically want to capture-and-stop-
  // listening, not re-derive on every parent render.
  useEffect(() => {
    if (open && setlistItemId !== null && frozenItemId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFrozenItemId(setlistItemId);
    }
    if (!open) {
      dispatch({ type: "RESET" });
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFrozenItemId(null);
    }
  }, [open, setlistItemId, frozenItemId]);

  // Performer fetch for missing_performer issues. Fires on first
  // open per event; re-opens reuse the cached array.
  useEffect(() => {
    if (!open) return;
    if (fetchedKeyRef.current === eventId) return;
    fetchedKeyRef.current = eventId;

    let cancelled = false;
    setPerformerFetchFailed(false);
    fetch(`/api/events/${eventId}/performers`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: { performers: PerformerOption[] }) => {
        if (cancelled) return;
        setEventPerformers(data.performers);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[ContestReportSheet] performers fetch failed", err);
        // Reset the ref so a subsequent open can retry. Surface the
        // failure to the missing_performer branch so the user sees
        // an error instead of a blank area.
        fetchedKeyRef.current = null;
        setPerformerFetchFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, eventId]);

  const songSearchTexts = useMemo(
    () => ({
      placeholder: t("songSearchPlaceholder"),
      loading: t("songSearchLoading"),
      noResults: t("songSearchNoResults"),
    }),
    [t],
  );

  const handleSongPick = useCallback(
    (song: SongSearchResult, variant: SongVariant | undefined) => {
      dispatch({ type: "SET_SONG", payload: { song, variant } });
    },
    [],
  );

  const handleTogglePerformer = useCallback(
    (id: string) => dispatch({ type: "TOGGLE_PERFORMER", payload: id }),
    [],
  );

  // Per-type submit eligibility. Mirrors the server's per-type
  // validation so the user can't tap submit on an incomplete form.
  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (frozenItemId === null) return false;
    if (type === "wrong_song" || type === "wrong_variant") {
      return selectedSong !== null;
    }
    if (type === "missing_performer") {
      return missingPerformerIds.size > 0;
    }
    if (type === "other") {
      return comment.trim().length > 0;
    }
    return true;
  }, [
    submitting,
    frozenItemId,
    type,
    selectedSong,
    missingPerformerIds,
    comment,
  ]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || frozenItemId === null) return;
    dispatch({ type: "SUBMIT_START" });

    // Build the payload per type. Matches the typed schema in
    // `src/lib/contestReportPayload.ts`; the server parses + casts
    // to the same union before insert.
    let payload: Record<string, unknown> = {};
    if (type === "wrong_song" && selectedSong) {
      payload = { proposedSongId: selectedSong.id };
    } else if (type === "wrong_variant" && selectedSong) {
      // For wrong_variant: SongSearch v2's two-stage picker returns
      // the BASE song as `selectedSong` (with baseVersionId=null by
      // definition — it IS the base) plus a `selectedVariant` for
      // the picked child variant (or undefined if the user picked
      // 원곡). So:
      //   - selectedSong.id    → proposedSongId (the base)
      //   - selectedVariant.id → proposedVariantId (the child, if picked)
      //
      // The earlier guard `selectedSong.baseVersionId !== null` was
      // always false because the base song has baseVersionId=null
      // by construction — that branch never fired and
      // proposedVariantId was silently dropped. Checking
      // `selectedVariant` alone is the right gate.
      if (selectedVariant) {
        payload = {
          proposedSongId: selectedSong.id,
          proposedVariantId: selectedVariant.id,
        };
      } else {
        payload = { proposedSongId: selectedSong.id };
      }
    } else if (type === "missing_performer") {
      payload = { stageIdentityIds: [...missingPerformerIds] };
    }
    // "other": payload stays {}

    try {
      const trimmedComment = comment.trim();
      const res = await fetch(
        `/api/setlist-items/${frozenItemId}/contests`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            payload,
            ...(trimmedComment.length > 0
              ? { comment: trimmedComment }
              : {}),
          }),
        },
      );

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const code = data?.error as string | undefined;
        let msg = t("errorGeneric");
        if (code === "feature_flag_disabled") msg = t("errorFeatureDisabled");
        else if (code === "setlist_item_not_found")
          msg = t("errorSetlistItemNotFound");
        else if (code === "song_not_found") msg = t("errorSongNotFound");
        else if (code === "performer_not_in_event")
          msg = t("errorPerformerNotInEvent");
        dispatch({ type: "SUBMIT_ERROR", payload: msg });
        return;
      }

      const reportId = data?.report?.id as string | undefined;
      if (typeof reportId !== "string") {
        dispatch({ type: "RESET" });
        onClose();
        return;
      }
      onSubmitSuccess(reportId);
      dispatch({ type: "RESET" });
      onClose();
    } catch (err) {
      console.error("[ContestReportSheet] submit failed", err);
      dispatch({ type: "SUBMIT_ERROR", payload: t("errorGeneric") });
    }
  }, [
    canSubmit,
    frozenItemId,
    type,
    selectedSong,
    selectedVariant,
    missingPerformerIds,
    comment,
    t,
    onClose,
    onSubmitSuccess,
  ]);

  return (
    <Drawer.Root open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-[200]" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[210] mt-24 flex h-fit max-h-[90vh] flex-col rounded-t-2xl bg-white outline-none">
          <div className="mx-auto mt-3 h-1.5 w-12 flex-shrink-0 rounded-full bg-gray-300" />
          <Drawer.Title className="sr-only">{t("sheetTitle")}</Drawer.Title>

          <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {t("sheetTitle")}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("close")}
                className="text-gray-500 hover:text-gray-900 text-xl leading-none"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {t("typeSection")}
                </label>
                <IssueTypeSelector
                  value={type}
                  onChange={(next) =>
                    dispatch({ type: "SET_TYPE", payload: next })
                  }
                />
              </div>

              {/* wrong_song: SongSearch without variant picker */}
              {type === "wrong_song" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    {t("proposedSongSection")}
                  </label>
                  <SongSearch
                    onSelect={handleSongPick}
                    locale={locale}
                    texts={songSearchTexts}
                    scope={{ kind: "event", eventId: Number(eventId) }}
                  />
                  {selectedSong && (
                    <div className="mt-2 text-sm text-gray-700">
                      ✓ {selectedSong.originalTitle}
                    </div>
                  )}
                </div>
              )}

              {/* wrong_variant: SongSearch with 2-stage variant picker */}
              {type === "wrong_variant" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    {t("proposedVariantSection")}
                  </label>
                  <SongSearch
                    onSelect={handleSongPick}
                    locale={locale}
                    texts={songSearchTexts}
                    variantPicker
                    scope={{ kind: "event", eventId: Number(eventId) }}
                  />
                  {selectedSong && (
                    <div className="mt-2 text-sm text-gray-700">
                      ✓ {selectedSong.originalTitle}
                      {selectedVariant?.variantLabel && (
                        <span className="text-gray-500">
                          {" "}
                          ({selectedVariant.variantLabel})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* missing_performer: PerformerChecklist (multi-select) */}
              {type === "missing_performer" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    {t("missingPerformersSection")}
                  </label>
                  {eventPerformers ? (
                    <PerformerChecklist
                      performers={eventPerformers}
                      checkedIds={missingPerformerIds}
                      onToggle={handleTogglePerformer}
                      locale={locale}
                    />
                  ) : performerFetchFailed ? (
                    // Fetch failed (network, 404, 500). Surface the
                    // error so the user knows the checklist isn't
                    // just slow loading. Tapping "submit" with no
                    // performers checked stays disabled — they can
                    // close and re-open to retry.
                    <div
                      role="alert"
                      className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
                    >
                      {t("errorGeneric")}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500">…</div>
                  )}
                </div>
              )}

              {/* comment: optional for all types except `other` */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {t("commentSection")}{" "}
                  <span className="text-xs text-gray-400">
                    ({type === "other" ? t("commentRequired") : t("commentOptional")})
                  </span>
                </label>
                <textarea
                  value={comment}
                  onChange={(e) =>
                    dispatch({
                      type: "SET_COMMENT",
                      payload: e.target.value,
                    })
                  }
                  placeholder={
                    type === "other"
                      ? t("commentRequiredPlaceholder")
                      : t("commentPlaceholder")
                  }
                  maxLength={MAX_COMMENT_CHARS}
                  rows={3}
                  className="w-full rounded-md border border-gray-200 px-2.5 py-2 text-sm focus:border-gray-400 focus:outline-none"
                />
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
                >
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={
                  canSubmit
                    ? "w-full rounded-md bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:bg-gray-800 active:bg-gray-700"
                    : "w-full rounded-md bg-gray-200 px-4 py-3 text-sm font-semibold text-gray-400 cursor-not-allowed"
                }
              >
                {submitting ? t("submitting") : t("submit")}
              </button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
