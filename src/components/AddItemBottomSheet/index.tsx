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
import { ItemTypeSelector } from "@/components/AddItemBottomSheet/ItemTypeSelector";
import {
  PerformerChecklist,
  type PerformerOption,
} from "@/components/AddItemBottomSheet/PerformerChecklist";
import { EncoreToggleRow } from "@/components/AddItemBottomSheet/EncoreToggleRow";
import { deriveStageType, type ItemType } from "@/lib/setlistStageType";
import type { LiveSetlistItem } from "@/lib/types/setlist";

interface Props {
  eventId: string;
  locale: string;
  open: boolean;
  onClose: () => void;
  /**
   * Target position the sheet should send in the POST body. Captured
   * by the parent (`<ActualSetlist>`) at button-click time — either
   * `currentMax + 1` for the footer "+ 곡 추가" or the contested
   * row's `position` for the per-row contest button.
   *
   * The sheet snapshots this on open into local state and never
   * updates it during the deliberation window — even if Realtime
   * push delivers new rows to `items` while the user is typing,
   * the target stays frozen. Auto-updating would re-introduce the
   * race condition the explicit-position model exists to close.
   *
   * `null` is the parent's "no current open intent" signal; an
   * open sheet always has a non-null preset.
   */
  presetPosition: number | null;
  /**
   * Live items array from the parent — Realtime-updated. The sheet
   * READS this to detect mid-deliberation occupant changes at its
   * (frozen) target position; it does NOT use it to re-compute the
   * target. When `items.filter(it => it.position === target)`
   * diverges from the snapshot captured at sheet open, the sheet
   * renders an in-place notice so the user can decide whether to
   * proceed or cancel.
   */
  items: LiveSetlistItem[];
  /**
   * Called with the newly-created SetlistItem id after a successful
   * submit. The parent uses this to (a) close the sheet and (b)
   * write to `confirm-{eventId}` via `useLocalConfirm.toggleConfirm`
   * so the user's own row renders `[✓]` immediately (matches PR
   * #283's "I confirmed this row" semantics; no separate
   * `submitted-{eventId}` storage at 1C — auto-promote at 60s makes
   * undo academic and Phase 2 attribution will replace it).
   */
  onSubmitSuccess: (itemId: number) => void;
}

interface State {
  itemType: ItemType;
  selectedSong: SongSearchResult | null;
  selectedVariant: SongVariant | null;
  performerIds: Set<string>;
  isEncore: boolean;
  submitting: boolean;
  error: string | null;
}

type Action =
  | { type: "SET_ITEM_TYPE"; payload: ItemType }
  | {
      type: "SET_SONG";
      payload: { song: SongSearchResult; variant: SongVariant | undefined };
    }
  | { type: "TOGGLE_PERFORMER"; payload: string }
  | { type: "SET_PERFORMERS"; payload: Set<string> }
  | { type: "SET_ENCORE"; payload: boolean }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_ERROR"; payload: string }
  | { type: "RESET" };

function initialState(): State {
  return {
    itemType: "song",
    selectedSong: null,
    selectedVariant: null,
    performerIds: new Set(),
    isEncore: false,
    submitting: false,
    error: null,
  };
}

// State machine for the bottom-sheet form. Reducer (vs 6 useStates)
// because state transitions are coupled: flipping itemType to MC
// must ALSO clear selectedSong and performerIds in one atomic update.
// Two separate setStates would render once with itemType=MC + stale
// performers, briefly showing a non-song row with checked performers
// — small visual glitch the reducer avoids.
//
// The auto-fill-on-song-pick logic lives in a parent useEffect (not
// in the reducer) because it depends on fetched `eventPerformers` /
// `current-members` data the reducer doesn't have access to.
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_ITEM_TYPE":
      // Non-song types clear the song + performers per spec
      // §"항목 유형별 자동 처리". Song type does NOT auto-fill here
      // — the parent's effect handles it (needs eventPerformers).
      if (action.payload !== "song") {
        return {
          ...state,
          itemType: action.payload,
          selectedSong: null,
          selectedVariant: null,
          performerIds: new Set(),
        };
      }
      return { ...state, itemType: action.payload };

    case "SET_SONG":
      return {
        ...state,
        selectedSong: action.payload.song,
        selectedVariant: action.payload.variant ?? null,
      };

    case "TOGGLE_PERFORMER": {
      const next = new Set(state.performerIds);
      if (next.has(action.payload)) next.delete(action.payload);
      else next.add(action.payload);
      return { ...state, performerIds: next };
    }

    case "SET_PERFORMERS":
      return { ...state, performerIds: action.payload };

    case "SET_ENCORE":
      return { ...state, isEncore: action.payload };

    case "SUBMIT_START":
      return { ...state, submitting: true, error: null };

    case "SUBMIT_ERROR":
      return { ...state, submitting: false, error: action.payload };

    case "RESET":
      return initialState();
  }
}

/**
 * Phase 1C user-input bottom sheet. Slides up from the bottom on
 * mobile (vaul Drawer); centered modal-style on desktop. Reads
 * SongSearch v2 with `variantPicker + allowCreate + scope={event}`
 * — the unbundling and 2-stage variant pick happen inside the
 * picker, this component just consumes the resolved `(song, variant)`
 * pair through the picker's `onSelect` callback.
 *
 * Data fetches (lazy, on open):
 *   - GET /api/events/[id]/performers — full event roster (host +
 *     guests) for the checklist. Once per open cycle.
 *   - GET /api/artists/[artistId]/current-members — only when the
 *     user picks a song whose stageType resolves to "unit". The
 *     resolved members get intersected with `eventPerformers` (a
 *     unit member who isn't booked for this event stays unchecked).
 *
 * Submit:
 *   POST /api/events/[id]/setlist-items
 *     body { itemType, songId, performerIds, isEncore }
 *
 *   On 200: dispatch RESET, fire `onSubmitSuccess(item.id)`, close.
 *   On 403 (flag off): surface AddItem.errorFeatureDisabled.
 *   On 400 (validation): surface AddItem.errorGeneric or
 *     specific error keys based on the server's error code.
 *   On 409 (position race after server retries): surface
 *     AddItem.errorPositionConflict.
 *   On 5xx / network: surface AddItem.errorGeneric.
 */
export function AddItemBottomSheet({
  eventId,
  locale,
  open,
  presetPosition,
  items,
  onClose,
  onSubmitSuccess,
}: Props) {
  const t = useTranslations("AddItem");
  // SongSearch's variant-picker + create-row copy is sourced from
  // the SongSearch namespace directly (rather than duplicated into
  // AddItem). Keeps one authoritative copy across every SongSearch
  // consumer — a translator editing 원곡 in one namespace doesn't
  // silently diverge from another. Placeholder / loading / noResults
  // are caller-supplied per the SongSearch decoupling architecture,
  // so those stay in AddItem.
  const songSearchT = useTranslations("SongSearch");

  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const {
    itemType,
    selectedSong,
    selectedVariant,
    performerIds,
    isEncore,
    submitting,
    error,
  } = state;

  // Event performers — fetched on first open. Stays cached between
  // open/close cycles within the same mount so a user who closes
  // and reopens doesn't pay the round-trip twice.
  const [eventPerformers, setEventPerformers] = useState<PerformerOption[] | null>(null);

  // Ref-based "already fetched for this eventId" guard. Earlier
  // implementation had `eventPerformers` in the effect deps, so the
  // setEventPerformers inside the fetch's .then triggered a re-run
  // of THIS effect, which in turn fired the cleanup function with
  // `cancelled = true` — bailing out the in-flight fetch before
  // it ever applied the result. A ref keeps the "did we start the
  // fetch for this key already?" signal out of the dep array so the
  // effect only runs on a real {open, eventId} change.
  const fetchedKeyRef = useRef<string | null>(null);

  // Frozen target position. Captured from `presetPosition` at open;
  // unchanged for the rest of the sheet's lifecycle. The parent's
  // `presetPosition` IS allowed to change (e.g. user closes and
  // reopens via a different entry point), but the local copy stays
  // stable across the deliberation window so a Realtime push to
  // `items` doesn't auto-shift the target.
  const [frozenPosition, setFrozenPosition] = useState<number | null>(null);

  // Snapshot of `items` at this target position at sheet-open time.
  // Used to detect mid-deliberation occupant changes — if the
  // current items prop has rows at `frozenPosition` that weren't in
  // the snapshot, the sheet renders a notice (without changing the
  // target). Set of ids for cheap diff.
  const [initialOccupantIds, setInitialOccupantIds] = useState<
    ReadonlySet<number> | null
  >(null);

  // Snapshot frozen state on open + presetPosition transitions only.
  // `items` is intentionally NOT in the dep array — its array
  // reference changes on every parent render (e.g. Realtime push),
  // which would re-fire this effect and cascade re-renders that fire
  // the fetch effect's cleanup mid-flight (cancelling the
  // eventPerformers fetch). The latest `items` is read at fire time
  // through the closure; that's the right semantic anyway because
  // the snapshot is meant to capture the occupants AT THE MOMENT the
  // sheet opens / re-targets, not on every Realtime update.
  //
  // For the same reason there's no `frozenPosition` guard — once
  // open + presetPosition stabilise, the effect doesn't re-fire, so
  // we don't need to suppress redundant state writes.
  useEffect(() => {
    if (!open || presetPosition === null) return;
    // Intentional setState-in-effect: this is an explicit
    // prop-to-local-state snapshot fired on open/retarget. The
    // recommended alternative (compute on render via useMemo)
    // doesn't work here because we specifically want to FREEZE
    // the value at the transition moment and ignore subsequent
    // prop changes — that freeze is the whole point of the
    // anti-race design. The `react-hooks/set-state-in-effect`
    // rule's default heuristic flags this; we disable it
    // narrowly here with the rationale documented.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrozenPosition(presetPosition);
    setInitialOccupantIds(
      new Set(
        items
          .filter((it) => it.position === presetPosition)
          .map((it) => it.id),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetPosition]);

  // Detect mid-deliberation occupant change at the frozen position.
  // The sheet shows a notice when the current set of ids at
  // `frozenPosition` diverges from the initial snapshot — typically
  // because Realtime delivered a new sibling submission while the
  // user was typing. Doesn't shift the target; just informs.
  const occupantNoticeVisible = useMemo(() => {
    if (frozenPosition === null || initialOccupantIds === null) return false;
    const current = items.filter((it) => it.position === frozenPosition);
    if (current.length !== initialOccupantIds.size) return true;
    return current.some((it) => !initialOccupantIds.has(it.id));
  }, [items, frozenPosition, initialOccupantIds]);

  // Effect 1 — performers data fetch (once per mount-per-event).
  // Does NOT dispatch SET_PERFORMERS itself; that lives in the
  // defaults-effect below so re-opens of the sheet (where the data
  // is already cached) still re-apply the defaults after a RESET.
  useEffect(() => {
    if (!open) return;
    if (fetchedKeyRef.current === eventId) return;
    fetchedKeyRef.current = eventId;

    let cancelled = false;
    fetch(`/api/events/${eventId}/performers`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { performers: PerformerOption[] }) => {
        if (cancelled) return;
        setEventPerformers(data.performers);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[AddItemBottomSheet] performers fetch failed", err);
        dispatch({ type: "SUBMIT_ERROR", payload: t("errorGeneric") });
        // Reset the fetched-key ref on error so a subsequent open
        // can retry. Without this, a transient failure would
        // permanently block the checklist from loading.
        fetchedKeyRef.current = null;
      });
    return () => {
      cancelled = true;
    };
    // `t` is intentionally NOT in deps — `useTranslations` returns
    // a fresh function reference each render, which would re-fire
    // this effect on every render and trigger the cleanup (set
    // `cancelled = true`) mid-flight. The fetch only NEEDS to
    // re-run on a real `(open, eventId)` change; reading `t` in the
    // catch via closure is fine because the catch path is rare and
    // an off-by-one render's worth of stale translation is
    // acceptable for an error message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eventId]);

  // Effect 2 — performer defaults. Fires whenever the sheet is open
  // with `itemType === 'song'` and no song has been picked yet. The
  // separation from the fetch effect above is load-bearing: on a
  // close-then-reopen cycle the data fetch is skipped
  // (`fetchedKeyRef.current === eventId`), but the RESET that fired
  // on close cleared `performerIds`. Without this effect, the second
  // open would render the checklist with every box unchecked.
  //
  // The song-pick effect below overrides these defaults once a song
  // is picked (with the unit-intersection or full-group all-performers
  // logic), so this only paints the initial "no song picked yet"
  // state.
  useEffect(() => {
    if (!open || !eventPerformers) return;
    if (selectedSong) return;
    if (itemType !== "song") return;
    const defaults = new Set(
      eventPerformers
        .filter((p) => !p.isGuest)
        .map((p) => p.stageIdentityId),
    );
    dispatch({ type: "SET_PERFORMERS", payload: defaults });
  }, [open, eventPerformers, selectedSong, itemType]);

  // Auto-fill performers when the user picks a song. The classification
  // (unit-vs-full-group) is the same deriveStageType the server runs
  // for the DB write — but the server recomputes from DB rows (anti-
  // tamper), so client + server are independent calls of the same
  // function. The client computes for UX defaults; the server computes
  // for authoritative truth.
  //
  // For unit-type songs we fetch the unit's current members, then
  // intersect with `eventPerformers` — a unit member who isn't booked
  // for this show stays unchecked (defaults shouldn't hallucinate
  // members into the event's roster). User can still manually check
  // them if they actually performed.
  useEffect(() => {
    if (itemType !== "song" || !selectedSong || !eventPerformers) return;

    // Classify stageType from the song's credited artists. `type` is
    // carried on every SongSearch v2 response (post-353 addition);
    // we cast through `as` because the API returns it as the
    // enum-string but the SongSearchResult types it as the broader
    // `string` for forward-compat. The deriveStageType helper rejects
    // unknown values gracefully (falls through to `full_group`), so
    // the cast is safe even if the API ever returns an unexpected
    // value.
    const songArtists = selectedSong.artists.map((sa) => ({
      artistId: sa.artist.id,
      type: sa.artist.type as "solo" | "group" | "unit",
    }));

    const { stageType, unitArtistId } = deriveStageType("song", songArtists);

    if (stageType === "unit" && unitArtistId !== null) {
      // Fetch unit members + intersect with event performers.
      let cancelled = false;
      fetch(`/api/artists/${unitArtistId}/current-members`)
        .then((res) => res.ok ? res.json() : Promise.reject(res.status))
        .then((data: { stageIdentityIds: string[] }) => {
          if (cancelled) return;
          const unitMemberIds = new Set(data.stageIdentityIds);
          const eventPerformerIds = new Set(
            eventPerformers.map((p) => p.stageIdentityId),
          );
          const intersection = new Set(
            [...unitMemberIds].filter((id) => eventPerformerIds.has(id)),
          );
          dispatch({ type: "SET_PERFORMERS", payload: intersection });
        })
        .catch((err) => {
          console.error("[AddItemBottomSheet] current-members fetch failed", err);
          // Fall back to default (all non-guest performers) — the
          // user can manually adjust. Spec §"Performer override"
          // expects this resilience.
          const fallback = new Set(
            eventPerformers
              .filter((p) => !p.isGuest)
              .map((p) => p.stageIdentityId),
          );
          dispatch({ type: "SET_PERFORMERS", payload: fallback });
        });
      return () => {
        cancelled = true;
      };
    }

    // Non-unit (full_group / solo): all event non-guest performers.
    const allActive = new Set(
      eventPerformers
        .filter((p) => !p.isGuest)
        .map((p) => p.stageIdentityId),
    );
    dispatch({ type: "SET_PERFORMERS", payload: allActive });
  }, [selectedSong, itemType, eventPerformers]);

  // Reset the form on close so the next open starts clean. The
  // eventPerformers cache is preserved (the data hasn't changed)
  // but the reducer state goes back to initial.
  // Frozen target + occupant snapshot ALSO reset on close so the
  // next open captures fresh.
  useEffect(() => {
    if (!open) {
      dispatch({ type: "RESET" });
      // Intentional setState-in-effect: the sheet's local "frozen
      // target" + "initial occupants" caches MUST clear on close so
      // the next open captures fresh. There's no derivable signal
      // for "open just transitioned to false" that's available on
      // render — the boolean prop change is the trigger.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFrozenPosition(null);
      setInitialOccupantIds(null);
    }
  }, [open]);

  // SongSearch texts — pulled from the AddItem namespace so this
  // surface stays decoupled from the SongSearch namespace's i18n
  // keys. v2 strings (variantPicker* / create*) all optional on the
  // texts prop type; we pass them all so the future-slot rows render
  // with the right copy when the user picks the disabled future slot.
  const songSearchTexts = useMemo(
    () => ({
      placeholder: t("songSearchPlaceholder"),
      loading: t("songSearchLoading"),
      noResults: t("songSearchNoResults"),
      // The next 6 come from the SongSearch namespace directly so
      // there's one source of truth for the variant-picker + future-
      // slot copy across every SongSearch consumer.
      variantPickerTitle: songSearchT("variantPickerTitle"),
      variantPickerBack: songSearchT("variantPickerBack"),
      variantPickerOriginalLabel: songSearchT("variantPickerOriginalLabel"),
      createSongRow: songSearchT("createSongRow"),
      createVariantRow: songSearchT("createVariantRow"),
      createDisabledTooltip: songSearchT("createDisabledTooltip"),
    }),
    [t, songSearchT],
  );

  const handleSongPick = useCallback(
    (song: SongSearchResult, variant: SongVariant | undefined) => {
      dispatch({ type: "SET_SONG", payload: { song, variant } });
    },
    [],
  );

  // Submit guard: song type requires a picked song. Empty performer
  // list is permitted (the user may have deliberately unchecked all —
  // an edge case but not invalid).
  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (itemType === "song" && !selectedSong) return false;
    return true;
  }, [submitting, itemType, selectedSong]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    if (frozenPosition === null) return; // defensive — submit only fires from rendered sheet
    dispatch({ type: "SUBMIT_START" });

    // The variant pick (if any) supersedes the base song — variants
    // are separate Song rows linked via baseVersionId, so the
    // variant's `id` is the songId we write to SetlistItemSong.
    const songId =
      itemType === "song"
        ? selectedVariant?.id ?? selectedSong?.id ?? null
        : null;

    try {
      const res = await fetch(`/api/events/${eventId}/setlist-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemType,
          songId,
          performerIds: itemType === "song" ? [...performerIds] : [],
          isEncore,
          position: frozenPosition,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        // Map server error codes to user-facing copy. Generic
        // fallback keeps the surface from leaking server-internal
        // strings on an unexpected error code.
        const code = data?.error as string | undefined;
        let msg = t("errorGeneric");
        if (code === "feature_flag_disabled") msg = t("errorFeatureDisabled");
        else if (code === "event_not_ongoing") msg = t("errorEventNotOngoing");
        else if (code === "performer_not_in_event")
          msg = t("errorPerformerNotInEvent");
        else if (code === "position_conflict") msg = t("errorPositionConflict");
        else if (code === "position_already_confirmed")
          msg = t("errorPositionAlreadyConfirmed");
        dispatch({ type: "SUBMIT_ERROR", payload: msg });
        return;
      }

      // `serializeBigInt` (src/lib/utils.ts:30) coerces BigInt → Number
      // via `Number(value)` inside the replacer, so `data.item.id`
      // arrives as a JSON number — but `Number(rawId)` is defensive
      // belt-and-suspenders against the same field becoming a string
      // someday (e.g. if a future refactor switches to `String(value)`
      // to avoid Number.MAX_SAFE_INTEGER overflow). The single
      // `Number.isFinite` guard then covers both an actual missing
      // field and a NaN-producing coercion.
      const rawId = data?.item?.id;
      const itemId = rawId == null ? NaN : Number(rawId);
      if (!Number.isFinite(itemId)) {
        // Defensive: success with malformed payload. Should never
        // happen given the server's response contract, but if it
        // does, fall back to closing the sheet without the local
        // auto-confirm — Realtime will still surface the row.
        dispatch({ type: "RESET" });
        onClose();
        return;
      }

      onSubmitSuccess(itemId);
      dispatch({ type: "RESET" });
      onClose();
    } catch (err) {
      console.error("[AddItemBottomSheet] submit failed", err);
      dispatch({ type: "SUBMIT_ERROR", payload: t("errorGeneric") });
    }
  }, [
    canSubmit,
    itemType,
    selectedSong,
    selectedVariant,
    performerIds,
    isEncore,
    eventId,
    frozenPosition,
    t,
    onClose,
    onSubmitSuccess,
  ]);

  const handleTogglePerformer = useCallback(
    (id: string) => dispatch({ type: "TOGGLE_PERFORMER", payload: id }),
    [],
  );

  return (
    <Drawer.Root open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-[200]" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[210] mt-24 flex h-fit max-h-[90vh] flex-col rounded-t-2xl bg-white outline-none">
          {/* Drag handle — vaul styles it automatically; the grabber
              affords drag-down-to-dismiss on mobile. */}
          <div className="mx-auto mt-3 h-1.5 w-12 flex-shrink-0 rounded-full bg-gray-300" />

          {/* Required by vaul/Radix for screen reader announcements;
              visually hidden because the title is rendered in the
              header below. */}
          <Drawer.Title className="sr-only">{t("sheetTitle")}</Drawer.Title>

          <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4">
            <div className="flex items-center justify-between mb-1">
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
            {frozenPosition !== null && (
              // Frozen target position display. Renders immediately
              // below the sheet title so the user always knows what
              // slot they're filling. Realtime updates to the parent's
              // items don't shift this — only the next sheet open
              // (with a fresh capture at button-click time) does.
              <div className="mb-3 text-sm text-gray-500">
                {t("targetPositionLabel", { position: frozenPosition })}
              </div>
            )}
            {occupantNoticeVisible && (
              // Mid-deliberation occupant change at the frozen target.
              // Either another user submitted a row here while we
              // were typing, or an existing sibling was promoted/
              // hidden. We don't shift the target — user decides
              // whether to cancel (✕) or proceed (same-song will
              // merge, different-song creates a conflict sibling).
              <div
                role="status"
                className="mb-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800"
              >
                {t("occupantAppearedNotice")}
              </div>
            )}

            <div className="space-y-4">
              <ItemTypeSelector
                value={itemType}
                onChange={(next) =>
                  dispatch({ type: "SET_ITEM_TYPE", payload: next })
                }
              />

              {itemType === "song" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      {t("songSection")}
                    </label>
                    <SongSearch
                      onSelect={handleSongPick}
                      locale={locale}
                      texts={songSearchTexts}
                      variantPicker
                      allowCreate
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

                  {eventPerformers && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        {t("performersSection")}
                      </label>
                      <PerformerChecklist
                        performers={eventPerformers}
                        checkedIds={performerIds}
                        onToggle={handleTogglePerformer}
                        locale={locale}
                      />
                    </div>
                  )}
                </>
              )}

              <EncoreToggleRow
                checked={isEncore}
                onChange={(next) =>
                  dispatch({ type: "SET_ENCORE", payload: next })
                }
              />

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

              {/* GuestFooterLink (mailto "performer missing — let the
                  operator know") was removed in the ContestReport
                  PR: that affordance is now subsumed by the per-row
                  `<IssueReportButton>` + ContestReportSheet's
                  `missing_performer` issue type, which collects the
                  exact same signal (which performers are missing)
                  into the operator queue instead of an email. */}
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
