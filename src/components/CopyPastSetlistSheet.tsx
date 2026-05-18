"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Drawer } from "vaul";
import { displayOriginalName, displayOriginalTitle } from "@/lib/display";
import { formatDate } from "@/lib/utils";
import {
  mergeAppendUnique,
  dedupCountForMerge,
} from "@/lib/copyPastSetlist";
import type { PredictionEntry } from "@/lib/predictionsStorage";

/**
 * Number of song titles shown in the per-card preview before the
 * "+N more" affordance. Five fits a typical card height without
 * forcing a scroll AND is enough to identify the show — "처음 5곡으로
 * 어떤 공연인지 알아볼 수 있다"가 큐레이션 가이드.
 */
const SONG_PREVIEW_COUNT = 5;

/**
 * Bottom sheet that lets the user pre-fill their predicted setlist
 * from a past event in the same EventSeries.
 *
 * Lifecycle:
 *   - Fetch fires on first open (cached for the component's lifetime
 *     so re-opening doesn't refetch).
 *   - Picker grid renders one card per past event, ordered date DESC.
 *   - Tapping "이 공연에서 가져오기" on a card either:
 *       (a) commits immediately, when `existingPredictions.length === 0`
 *           — there's nothing to merge with, so the confirm step would
 *           just be a redundant tap.
 *       (b) opens the confirm panel with "추가하기 (중복 제외)" default
 *           vs "새로 시작하기 (교체)", when predictions already exist.
 *
 * Lock guard: `isLocked` is checked at apply time. The parent hides
 * the trigger entirely once `!isPreShow`, but a long-open sheet that
 * crosses `event.startTime` must not commit.
 */

interface PastEventTranslation {
  locale: string;
  name: string;
  shortName: string | null;
  venue: string | null;
}

interface PastEvent {
  eventId: number;
  originalName: string;
  originalShortName: string | null;
  originalLanguage: string;
  originalVenue: string | null;
  translations: PastEventTranslation[];
  date: string | null;
  songCount: number;
  songs: PredictionEntry[];
}

interface PastEventsResponse {
  ok: boolean;
  pastEvents?: PastEvent[];
  error?: string;
}

export interface CopyApplyMeta {
  sourceEventId: number;
  mode: "append" | "replace";
  incoming: number;
  added: number;
  final: number;
}

interface Props {
  eventId: string;
  locale: string;
  isLocked: boolean;
  existingPredictions: PredictionEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (merged: PredictionEntry[], meta: CopyApplyMeta) => void;
  /**
   * Fired exactly once per successful fetch (per mount), regardless of
   * whether the result is empty. Lets the parent log `predict_copy_open`
   * with the resolved count.
   */
  onFetched?: (pastEventCount: number) => void;
}

export function CopyPastSetlistSheet({
  eventId,
  locale,
  isLocked,
  existingPredictions,
  open,
  onOpenChange,
  onApply,
  onFetched,
}: Props) {
  const t = useTranslations("Predict");

  const [data, setData] = useState<PastEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PastEvent | null>(null);
  const [mode, setMode] = useState<"append" | "replace">("append");

  // Fetch on first open. We keep the cache across open/close cycles so
  // re-opening the sheet within the same mount doesn't re-hit the API —
  // confirmed past setlists are effectively immutable for the duration
  // of a page session.
  //
  // `react-hooks/set-state-in-effect` flags the synchronous
  // `setLoading(true)` / `setError(null)` here. They're an intentional
  // pair with the fetch (an external-system call): we mark "request
  // in flight" before kicking it off so a re-render mid-flight reads
  // the loading flag instead of restarting. AddItemBottomSheet uses
  // the same disable for the same shape.
  useEffect(() => {
    if (!open) return;
    if (data !== null) return;
    if (loading) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetch(`/api/events/${eventId}/past-setlists?locale=${encodeURIComponent(locale)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`http_${res.status}`);
        return res.json() as Promise<PastEventsResponse>;
      })
      .then((body) => {
        if (cancelled) return;
        const list = body.pastEvents ?? [];
        setData(list);
        setLoading(false);
        onFetched?.(list.length);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[CopyPastSetlistSheet] fetch failed", err);
        setError(t("copy.fetchError"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, data, loading, eventId, locale, t, onFetched]);

  // Reset the "selected for confirm" state when the sheet closes so
  // the next open starts back at the picker grid. The fetched `data`
  // is intentionally kept (see comment above).
  //
  // Intentional setState-in-effect: there's no derivable signal for
  // "open just transitioned to false" on render — the boolean prop
  // change is the trigger. Same shape as AddItemBottomSheet's
  // reset-on-close (`AddItemBottomSheet/index.tsx:460-472`).
  useEffect(() => {
    if (open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(null);
    setMode("append");
  }, [open]);

  const handleApply = useCallback(
    (source: PastEvent, applyMode: "append" | "replace") => {
      if (isLocked) return;
      const merged =
        applyMode === "replace"
          ? source.songs
          : mergeAppendUnique(existingPredictions, source.songs);
      const dup = dedupCountForMerge(existingPredictions, source.songs);
      const added =
        applyMode === "replace"
          ? source.songs.length
          : source.songs.length - dup;
      onApply(merged, {
        sourceEventId: source.eventId,
        mode: applyMode,
        incoming: source.songs.length,
        added,
        final: merged.length,
      });
    },
    [existingPredictions, isLocked, onApply],
  );

  const handleSelectCard = useCallback(
    (ev: PastEvent) => {
      // Skip the confirm step when there's nothing to merge against.
      // Append-from-empty is a no-op merge — semantically identical to
      // replace — so the extra tap would only add friction.
      if (existingPredictions.length === 0) {
        handleApply(ev, "append");
        return;
      }
      setSelected(ev);
      setMode("append");
    },
    [existingPredictions.length, handleApply],
  );

  const dupCount = useMemo(() => {
    if (!selected) return 0;
    return dedupCountForMerge(existingPredictions, selected.songs);
  }, [existingPredictions, selected]);

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-[200]" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[210] mt-24 flex h-fit max-h-[90vh] flex-col rounded-t-2xl bg-white outline-none">
          <div className="mx-auto mt-3 h-1.5 w-12 flex-shrink-0 rounded-full bg-gray-300" />

          <Drawer.Title className="sr-only">{t("copy.sheetTitle")}</Drawer.Title>

          <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">
                {t("copy.sheetTitle")}
              </h2>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label={t("copy.close")}
                className="text-gray-500 hover:text-gray-900 text-xl leading-none"
              >
                ✕
              </button>
            </div>

            {loading && (
              <div className="py-8 text-center text-sm text-gray-500">
                {t("copy.loading")}
              </div>
            )}

            {!loading && error && (
              <div
                role="alert"
                className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
              >
                {error}
              </div>
            )}

            {!loading && !error && data !== null && data.length === 0 && (
              <div className="py-8 text-center text-sm text-gray-500">
                {t("copy.emptyHint")}
              </div>
            )}

            {!loading && !error && selected !== null && (
              <ConfirmPanel
                source={selected}
                existingCount={existingPredictions.length}
                dupCount={dupCount}
                mode={mode}
                onModeChange={setMode}
                onBack={() => setSelected(null)}
                onCancel={() => onOpenChange(false)}
                onApply={() => handleApply(selected, mode)}
                t={t}
              />
            )}

            {!loading && !error && selected === null && data !== null && data.length > 0 && (
              <div className="space-y-3">
                {data.map((ev) => (
                  <PastEventCard
                    key={ev.eventId}
                    ev={ev}
                    locale={locale}
                    onSelect={() => handleSelectCard(ev)}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

interface CardProps {
  ev: PastEvent;
  locale: string;
  onSelect: () => void;
  t: ReturnType<typeof useTranslations<"Predict">>;
}

function PastEventCard({ ev, locale, onSelect, t }: CardProps) {
  const name = displayOriginalName(
    {
      originalName: ev.originalName,
      originalShortName: ev.originalShortName,
      originalLanguage: ev.originalLanguage,
    },
    ev.translations,
    locale,
  );
  const venueTranslation = ev.translations.find((tr) => tr.locale === locale);
  const venue = venueTranslation?.venue || ev.originalVenue;
  const dateLine = ev.date ? formatDate(ev.date, locale) : null;

  return (
    <div className="rounded-lg border border-gray-200 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-900 truncate">
            {name.main}
          </div>
          {name.sub && (
            <div className="text-xs text-gray-500 truncate">{name.sub}</div>
          )}
          <div className="mt-1 text-xs text-gray-500 flex flex-wrap gap-x-2">
            {dateLine && <span>{dateLine}</span>}
            {venue && <span>· {venue}</span>}
            <span>· {t("copy.songCount", { count: ev.songCount })}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onSelect}
          className="flex-shrink-0 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 active:bg-gray-700"
        >
          {t("copy.selectButton")}
        </button>
      </div>

      <SongPreview songs={ev.songs} locale={locale} t={t} />
    </div>
  );
}

function SongPreview({
  songs,
  locale,
  t,
}: {
  songs: PredictionEntry[];
  locale: string;
  t: ReturnType<typeof useTranslations<"Predict">>;
}) {
  if (songs.length === 0) return null;
  const previewCount = Math.min(SONG_PREVIEW_COUNT, songs.length);
  const preview = songs.slice(0, previewCount);
  const moreCount = songs.length - previewCount;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-gray-600">
        {preview
          .map((p) => {
            const td = displayOriginalTitle(
              {
                originalTitle: p.song.originalTitle,
                originalLanguage: p.song.originalLanguage,
                variantLabel: p.song.variantLabel,
              },
              p.song.translations,
              locale,
            );
            return td.main;
          })
          .join(" · ")}
        {moreCount > 0 && (
          <span className="text-gray-400">
            {" "}
            {t("copy.previewMore", { count: moreCount })}
          </span>
        )}
      </summary>
    </details>
  );
}

interface ConfirmPanelProps {
  source: PastEvent;
  existingCount: number;
  dupCount: number;
  mode: "append" | "replace";
  onModeChange: (m: "append" | "replace") => void;
  onBack: () => void;
  onCancel: () => void;
  onApply: () => void;
  t: ReturnType<typeof useTranslations<"Predict">>;
}

function ConfirmPanel({
  source,
  existingCount,
  dupCount,
  mode,
  onModeChange,
  onBack,
  onCancel,
  onApply,
  t,
}: ConfirmPanelProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700 space-y-0.5">
        <div>{t("copy.confirmIncoming", { count: source.songs.length })}</div>
        <div>{t("copy.confirmExisting", { count: existingCount })}</div>
        <div className="text-xs text-gray-500">
          {t("copy.confirmDup", { count: dupCount })}
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            name="copy-mode"
            value="append"
            checked={mode === "append"}
            onChange={() => onModeChange("append")}
            className="mt-0.5"
          />
          <div className="text-sm text-gray-800">{t("copy.modeAppend")}</div>
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            name="copy-mode"
            value="replace"
            checked={mode === "replace"}
            onChange={() => onModeChange("replace")}
            className="mt-0.5"
          />
          <div className="text-sm text-gray-800">{t("copy.modeReplace")}</div>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-gray-600 hover:text-gray-900"
        >
          {t("copy.back")}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            {t("copy.cancel")}
          </button>
          <button
            type="button"
            onClick={onApply}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            {t("copy.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
