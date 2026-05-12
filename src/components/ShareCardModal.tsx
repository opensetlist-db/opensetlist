"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslations } from "next-intl";
import {
  ShareCardPreview,
  type ShareCardMode,
} from "@/components/ShareCardPreview";
import {
  shareCard,
  copyCardToClipboard,
  renderCardToBlob,
  type ShareOutcome,
  type CopyOutcome,
} from "@/lib/shareCard";
import { useMounted } from "@/hooks/useMounted";
import { trackEvent } from "@/lib/analytics";
import type { LiveSetlistItem } from "@/lib/types/setlist";
import type { PredictionEntry } from "@/lib/predictionsStorage";
import { zIndex, type ShareCardTheme } from "@/styles/tokens";

/**
 * Classify a `shareCard()` / `copyCardToClipboard()` *error-kind*
 * message into one of the GA4 `share_card_save_failed` reason
 * buckets. The mapping is brittle by design — it inspects message
 * strings produced by `src/lib/shareCard.ts`, which means a string
 * change there will silently start emitting `'unknown'` for that
 * path. That's acceptable: the helper is one file with known throw
 * sites and the unknown bucket is the safe fallback.
 *
 * Only consumes message strings — the clipboard-specific outcomes
 * (`unsupported`, `denied`) have their own kinds in `CopyOutcome` and
 * are surfaced as `clipboard_unsupported` / `clipboard_denied` GA4
 * reasons directly by `handleCopy`, not via this classifier. Keeping
 * those separate means we don't have to invent fake message strings
 * for non-error outcomes.
 *
 * Reasons returned:
 *   - 'timeout'         → 10s `TO_BLOB_TIMEOUT_MS` elapsed
 *                         (helper returns "canvas.toBlob returned null")
 *   - 'tainted_canvas'  → CORS leak in capture (html2canvas / browser msg)
 *   - 'oom'             → memory / allocation failure
 *   - 'unknown'         → anything else, including future paths
 */
function classifyShareCardFailure(
  message: string,
): "timeout" | "tainted_canvas" | "oom" | "unknown" {
  if (message === "canvas.toBlob returned null") return "timeout";
  if (/tainted/i.test(message)) return "tainted_canvas";
  if (/(memory|OOM|allocation)/i.test(message)) return "oom";
  return "unknown";
}

/**
 * Toast auto-dismiss duration. 3s is long enough to read a short
 * Korean/Japanese sentence (the longest copy is ~30 chars) without
 * lingering past the user's attention. Mirrors the named-constant
 * pattern in `src/lib/shareCard.ts` (`TO_BLOB_TIMEOUT_MS`).
 */
const TOAST_DISMISS_MS = 3_000;

/**
 * Delay before kicking off the pre-rasterization on modal open /
 * theme change. Gives the new theme a chance to actually paint into
 * the DOM before html2canvas captures it. 100ms is a comfortable
 * margin past a single animation frame (~16ms) without making the
 * pre-rasterization feel laggy to a fast-tapping user.
 */
const PRE_RASTERIZE_DELAY_MS = 100;

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * Event id for GA4 event params. Stringified at the call site
   * (`<ShareCardButton>` already receives `eventId: string`),
   * passed through unchanged so the modal can fire share_card_*
   * events with consistent shapes alongside `<ShareCardButton>`'s
   * `share_card_open`.
   */
  eventId: string;
  /**
   * Card render mode — drives both `<ShareCardPreview>` layout and the
   * native-share text payload below. See `ShareCardMode` for the per-
   * mode meaning (`prediction` = pre-show / no-actuals-yet, no score;
   * `live` = mid-flight with partial score + LIVE pill; `final` = the
   * v0.11.1-and-earlier post-show layout).
   */
  mode: ShareCardMode;
  // Card payload + score (caller computes via calcShareCardScore).
  seriesName: string;
  eventTitle: string;
  dateLine: string;
  actualSongs: LiveSetlistItem[];
  predictions: PredictionEntry[];
  matched: number;
  total: number;
  percentage: number;
  predictedCount: number;
  locale: string;
  /**
   * Canonical event URL, forwarded as the `url` field of the
   * `shareCard({ share })` payload so URL-aware native share targets
   * (Twitter, Discord, etc.) get an unfurl when the OS sheet path is
   * taken. Ignored on the download fallback. Threaded through
   * regardless of capability — the helper only consults it inside the
   * native-share branch.
   */
  shareUrl: string;
}

/**
 * Share-card preview modal with two action buttons:
 *
 *   - **다운로드 / 공유** (Button A) — triggers `shareCard()` which
 *     either downloads a PNG (desktop) or opens the OS share sheet
 *     (touch-primary devices that pass `navigator.canShare({ files })`).
 *     Icon swaps dynamically: download-arrow on desktop, iOS-style
 *     share square on touch devices, so the user knows what to expect
 *     before tapping. The native-share payload includes the event
 *     title, a score-summary text body (varies by mode), and the
 *     canonical event URL.
 *   - **이미지 복사** (Button B) — triggers `copyCardToClipboard()`
 *     which writes the rendered PNG to `navigator.clipboard` as
 *     `image/png`. User can paste straight into a community-site
 *     composer (DCInside, Ruliweb), a messenger input box (KakaoTalk,
 *     Slack, Discord), or anywhere else that handles image paste —
 *     skipping the "save → open gallery → attach" loop. Capability-
 *     gated: hidden when `window.ClipboardItem` or
 *     `navigator.clipboard.write` is unavailable (older Firefox, some
 *     embedded WebViews), so the button is only ever visible where it
 *     actually works.
 *
 * Both buttons sit directly below the card preview, side-by-side,
 * `flex-1` so each takes equal width, with a 44px min-height for
 * touch-target ergonomics (Apple HIG / Material recommended minimum).
 *
 * The earlier "링크 복사" sibling CTA was removed in v0.10.2 because
 * the label implied a per-image URL, but the share card is rendered
 * client-side and never hosted — the button only ever copied the
 * event URL, under-delivering on its implied promise. The native-
 * share path's `url` field already covers the share-the-link intent
 * for OS-sheet users; everyone else can grab the URL from the event
 * page's address bar.
 *
 * Accessibility: `Escape` closes; click-outside closes; first
 * focusable element gets focus on open. role=dialog + aria-modal +
 * aria-labelledby for screen readers.
 */
export function ShareCardModal({
  open,
  onClose,
  eventId,
  mode,
  seriesName,
  eventTitle,
  dateLine,
  actualSongs,
  predictions,
  matched,
  total,
  percentage,
  predictedCount,
  locale,
  shareUrl,
}: Props) {
  const t = useTranslations("ShareCard");
  const mounted = useMounted();
  const [theme, setTheme] = useState<ShareCardTheme>("dark");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Pre-rasterized PNG blob, refreshed on modal open + theme change.
  // **Critical for iOS Safari Web Share**: navigator.share requires
  // transient activation (user gesture) at the moment of the call,
  // and `await renderCardToBlob()` is an async I/O hop through a
  // macrotask which loses activation. If we await inside handleShare
  // BEFORE calling navigator.share, iOS rejects with NotAllowedError
  // → falls through to download → operator-reported "share button
  // still downloads on iPhone". Pre-rasterizing here means the blob
  // is already in memory when the user taps; handleShare can build
  // a File and call navigator.share synchronously inside the click
  // handler, preserving the user gesture and letting the OS share
  // sheet actually appear.
  const [preRasterizedBlob, setPreRasterizedBlob] = useState<Blob | null>(
    null,
  );

  // Drives Button A's icon + label. The HELPER (`shareCard.ts`)
  // attempts share whenever `navigator.share` exists, regardless of
  // canShare — that's the gate-free path that fixes the operator's
  // iPhone where canShare returned false even when share would work.
  // But operator-spotted: when share *does* throw (rarer, but
  // possible on platforms with API stubs only), the label said
  // "Share" while the captured behavior was Download. The label
  // wasn't honest about what would happen.
  //
  // Fix: predict the action via `canShare({ files: probePng })` for
  // the label, while keeping the helper gate-free. A probe File
  // (empty payload, image/png MIME) answers the capability question
  // at mount time without rasterizing.
  //
  // Resulting matrix:
  //   canShare true, share resolves  → label "Share",  action Share ✓
  //   canShare true, share throws    → label "Share",  action Download (rare; mismatch unavoidable)
  //   canShare false, share resolves → label "Download", action Share (operator's iPhone if share works)
  //   canShare false, share throws   → label "Download", action Download ✓
  //
  // The mismatch the operator complained about was case 2 — label
  // says Share but action is Download. Pinning the label to
  // canShare's prediction means cases 1 and 4 (the common ones)
  // always match; cases 2 and 3 are edge cases where label/action
  // diverge. Acceptable tradeoff.
  //
  // Gated on `mounted` so SSR + first client commit render the same
  // markup (both fall through to the download label until the
  // post-mount re-render flips it).
  // useMemo over `[mounted]` so the probe-File construction +
  // canShare call runs once after mount instead of every render.
  // Early-return chain reads top-to-bottom — easier to scan than a
  // short-circuit AND of four capability checks.
  const isShareCapable = useMemo(() => {
    if (!mounted) return false;
    if (typeof navigator === "undefined") return false;
    if (typeof navigator.canShare !== "function") return false;
    if (typeof navigator.share !== "function") return false;
    try {
      const probeFile = new File([], "probe.png", { type: "image/png" });
      return navigator.canShare({ files: [probeFile] });
    } catch {
      return false;
    }
  }, [mounted]);

  // Capability check for Button B. Same SSR-safety pattern as the
  // touch detection above — false on first render, may flip true
  // post-mount. The button is fully hidden when unsupported (older
  // Firefox, some embedded WebViews) so we never show an affordance
  // that can't fire. CR-anticipated edge: the API check is for
  // `clipboard.write` specifically, not `clipboard.writeText` — the
  // latter is more widely supported but only handles strings.
  const clipboardSupported =
    mounted &&
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function" &&
    typeof window !== "undefined" &&
    typeof window.ClipboardItem !== "undefined";

  // Focus the close button on open so Escape works without
  // additional focus-trap glue. On close, restore focus to the
  // element that opened the modal (typically the `결과 공유 🎯`
  // button in `<ShareCardButton>`) — standard a11y dialog pattern,
  // preserves keyboard navigation context. Mobile users get the
  // same first-tap anchor on open.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      opener?.focus?.();
    };
  }, [open]);

  // Body-scroll lock while the modal is open. Without this, a swipe
  // on the modal's dark backdrop on iOS Safari scrolls the underlying
  // event detail page (the modal is `position: fixed` so it stays in
  // place, but the document body underneath still scrolls). Operator-
  // spotted post-v0.11.5: after tapping 이미지 복사, the user's
  // gesture was scrolling the event page behind the modal even though
  // the modal stayed visible. Saving + restoring the previous
  // `overflow` value rather than blindly resetting to `""` so a
  // future caller that set its own body overflow gets it back. The
  // effect runs only when `open` flips — its cleanup restores the
  // previous value at unmount or when `open` flips to false.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Auto-dismiss toast after 3s.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  // Render-time invalidation tracker for the pre-rasterized blob.
  // The cached blob represents a snapshot of the card at a specific
  // set of visual inputs; any change to those inputs invalidates
  // the cache.
  //
  // Inputs that affect the captured PNG:
  //   - `open` / `theme`: mode / palette
  //   - `mode`: prediction vs live vs final layout
  //   - `seriesName` / `eventTitle` / `dateLine`: header strings
  //   - `actualSongs` / `predictions`: row contents (real-time push
  //     during an ongoing event mutates `actualSongs`; user edits
  //     in localStorage mutate `predictions`)
  //   - `matched` / `total` / `percentage` / `predictedCount`:
  //     score banner numerics
  //
  // For the array inputs the key encodes the id sequence so order
  // changes invalidate too (drag-reorder a prediction → new key →
  // re-rasterize). Cheap on every render: two `map().join()` over
  // ~10–30 items.
  //
  // Uses the project's canonical prev-state pattern (see
  // `useMounted.ts` docstring) — running `setPreRasterizedBlob(null)`
  // directly in the effect body trips `react-hooks/set-state-in-
  // effect`. The render-time check flips state only when the
  // tracked key actually changes.
  const rasterizationKey = [
    open ? "open" : "closed",
    theme,
    mode,
    seriesName,
    eventTitle,
    dateLine,
    actualSongs.map((s) => s.id).join(","),
    predictions.map((p) => p.songId).join(","),
    matched,
    total,
    percentage,
    predictedCount,
  ].join("|");
  const [prevRasterizationKey, setPrevRasterizationKey] = useState(
    rasterizationKey,
  );
  if (prevRasterizationKey !== rasterizationKey) {
    setPrevRasterizationKey(rasterizationKey);
    setPreRasterizedBlob(null);
  }

  // Pre-rasterize the card to a PNG blob in the background. Re-runs
  // whenever `rasterizationKey` changes — that key covers theme,
  // mode, header strings, row contents, and score numerics, so any
  // visible change to the card retriggers a fresh capture. 100ms
  // delay lets the new render paint before html2canvas reads the
  // DOM.
  //
  // The blob is the load-bearing input to the iOS Safari user-
  // gesture fix: when handleShare runs, it consumes this state
  // synchronously, skipping the async rasterization that would
  // otherwise expire the click's transient activation.
  //
  // `rasterizationKey` is the sole effect dep — it encodes every
  // input the function body cares about, so listing the underlying
  // 12 props separately would duplicate the invariant. The exhaust-
  // ive-deps suppression is justified by that contract.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const delay = setTimeout(() => {
      if (cancelled || !cardRef.current) return;
      renderCardToBlob(cardRef.current)
        .then((blob) => {
          if (!cancelled) setPreRasterizedBlob(blob);
        })
        .catch(() => {
          // Render failure is non-fatal — the share/copy handlers
          // fall back to on-demand rasterization (the v0.11.5 path)
          // which will surface the error to the user via toast if
          // the second attempt also fails.
        });
    }, PRE_RASTERIZE_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(delay);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rasterizationKey]);

  if (!open) return null;

  // While the share-card capture is in flight, every state-mutating
  // path on the modal must early-return. html2canvas walks the live
  // DOM under `cardRef.current` for ~1–3s on mobile; closing the
  // modal mid-capture would unmount the capture target and crash
  // the call, and a theme toggle would mutate the painted styles
  // partway through capture and produce a garbled image. The share
  // button's existing `busy` short-circuit covers double-tap; the
  // others (backdrop click, Escape, close-X, theme toggle, copy
  // button) need the same guard. CR #285 caught this on the
  // release diff.
  const handleClose = () => {
    if (busy) return;
    onClose();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    }
  };

  /**
   * Move focus back to the close button after an async share/copy
   * handler settles. Wrapped in `setTimeout(..., 0)` so the focus
   * call runs on the next macrotask — AFTER React commits the
   * `setBusy(false)` re-render and the close button's `disabled`
   * attribute clears. React 18 batches state updates inside event
   * handlers, so a synchronous `focus()` immediately after
   * `setBusy(false)` lands on a still-disabled element (silent
   * no-op).
   *
   * Why this is load-bearing: iOS Safari has been observed dropping
   * focus to `document.body` when an async user-gesture-required
   * API like `navigator.clipboard.write` or `navigator.share`
   * completes — the busy-button disable/enable cycle compounds the
   * blur. Pulling focus back into a known interactive inside the
   * modal keeps the keyboard-nav context anchored in the dialog and
   * resolves the "background page scrolls / modal buttons
   * unresponsive" symptom.
   *
   * Optional chain covers the close-mid-async edge case where the
   * modal unmounted between the await and the setTimeout callback.
   */
  const refocusCloseButton = (): void => {
    setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);
  };

  const handleShare = async () => {
    if (!cardRef.current || busy) return;
    setBusy(true);
    try {
      // Per-mode native-share text. The post-show `shareText` carries
      // the final hit-rate sentence; live-mode flags the partial state
      // explicitly so a friend opening the share later understands the
      // numbers are mid-flight; prediction-mode has no score yet, just
      // a "my predicted setlist — N songs" caption to seed virality
      // before the show. `title` + `url` stay the same across modes —
      // the event identity doesn't change.
      const shareText =
        mode === "prediction"
          ? t("shareTextPrediction", { count: predictedCount })
          : mode === "live"
            ? t("shareTextLive", { matched, total, percentage })
            : t("shareText", { matched, total, percentage });
      const outcome: ShareOutcome = await shareCard({
        cardEl: cardRef.current,
        // Pass the pre-rasterized blob (may be null if rasterization
        // hadn't completed before the user tapped — the helper falls
        // back to on-demand rasterization in that case). The
        // "preRasterizedBlob present" path is the iOS Safari user-
        // gesture preservation route: navigator.share is called
        // synchronously inside this click handler without an async
        // hop through canvas.toBlob, so transient activation
        // survives the call.
        preRasterizedBlob: preRasterizedBlob ?? undefined,
        // Native-share payload — only consulted when the OS sheet
        // path is taken. Title for surfaces that show one (Twitter
        // compose, KakaoTalk caption); text for ones that compose a
        // body (Messages, email); url so users on URL-aware targets
        // (Twitter, Discord) get an unfurl. The image File itself is
        // always attached regardless of which fields the platform
        // honors.
        share: {
          title: eventTitle,
          text: shareText,
          url: shareUrl,
        },
      });
      if (outcome.kind === "downloaded") {
        // GA4 Phase 1B: same event for download / share / copy
        // success — `outcome` param distinguishes the path so the KPI
        // funnel stays one query.
        trackEvent("share_card_save", {
          event_id: String(eventId),
          outcome: "downloaded",
        });
        setToast(t("imageSavedToast"));
      } else if (outcome.kind === "shared") {
        trackEvent("share_card_save", {
          event_id: String(eventId),
          outcome: "shared",
        });
        // `shared` and `cancelled` remain UI-silent — the OS share
        // sheet already gave the user feedback. Cancellation
        // intentionally fires no event (low-signal user action,
        // would inflate the share-funnel denominator).
      }
      // CR #295: surface a toast on error too. Without it, a tainted-
      // canvas / OOM / driver-bug failure leaves the user with no
      // feedback — the spinner stops, but they can't tell whether the
      // image silently succeeded or quietly broke. The toast tells
      // them to retry.
      else if (outcome.kind === "error") {
        trackEvent("share_card_save_failed", {
          event_id: String(eventId),
          reason: classifyShareCardFailure(outcome.message),
        });
        setToast(t("imageErrorToast"));
      }
    } catch {
      // Defensive: today's `shareCard()` catches every internal async
      // path and always returns a ShareOutcome rather than throwing.
      // But the dynamic `import("html2canvas")` is the kind of code
      // that could grow new throws over time (network failures,
      // bundler chunk-load errors, future refactors). Wrapping here
      // guarantees the same error toast even if shareCard rethrows,
      // and `finally` guarantees `busy` is released so the modal
      // doesn't lock. CR #295 round 2.
      trackEvent("share_card_save_failed", {
        event_id: String(eventId),
        reason: "unknown",
      });
      setToast(t("imageErrorToast"));
    } finally {
      setBusy(false);
      refocusCloseButton();
    }
  };

  const handleCopy = async () => {
    if (!cardRef.current || busy) return;
    setBusy(true);
    try {
      const outcome: CopyOutcome = await copyCardToClipboard({
        cardEl: cardRef.current,
      });
      if (outcome.kind === "copied") {
        // Same GA4 event family as download/share, with a distinct
        // `outcome` value so the funnel breakdown is one query.
        trackEvent("share_card_save", {
          event_id: String(eventId),
          outcome: "copied",
        });
        setToast(t("imageCopiedToast"));
      } else if (outcome.kind === "unsupported") {
        // Should be unreachable in practice — the button is hidden
        // when `clipboardSupported` is false, so a click can only
        // arrive when the capability check passed. Defensive log
        // for the edge case where the runtime check disagrees with
        // the mount-time check (DevTools simulation, embedded
        // WebView state changes).
        trackEvent("share_card_save_failed", {
          event_id: String(eventId),
          reason: "clipboard_unsupported",
        });
        setToast(t("imageCopyFailedToast"));
      } else if (outcome.kind === "denied") {
        // User-gesture expired (rare with our Promise<Blob> pattern)
        // or permission-policy denial. Surface the same "couldn't
        // copy" toast as the catch-all error — the distinction is
        // analytics-only.
        trackEvent("share_card_save_failed", {
          event_id: String(eventId),
          reason: "clipboard_denied",
        });
        setToast(t("imageCopyFailedToast"));
      } else if (outcome.kind === "error") {
        trackEvent("share_card_save_failed", {
          event_id: String(eventId),
          reason: classifyShareCardFailure(outcome.message),
        });
        setToast(t("imageCopyFailedToast"));
      }
    } catch {
      // Same defensive catch as handleShare — see that branch for
      // the rationale. Failure here is a thrown error from
      // `copyCardToClipboard`, which today always returns a
      // CopyOutcome but might rethrow from a future refactor.
      trackEvent("share_card_save_failed", {
        event_id: String(eventId),
        reason: "unknown",
      });
      setToast(t("imageCopyFailedToast"));
    } finally {
      setBusy(false);
      refocusCloseButton();
    }
  };

  const handleThemeChange = (m: ShareCardTheme) => {
    if (busy) return;
    setTheme(m);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-card-modal-title"
      onKeyDown={handleKeyDown}
      onClick={handleClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: zIndex.modal,
        display: "flex",
        // Operator-spotted on iPhone with a 14-row setlist: tall
        // content (card preview + theme toggle + buttons) exceeded
        // the visible viewport, and `alignItems: center` clipped the
        // top of the modal (theme toggle disappeared above the
        // scroll origin). Centering on a scrollable flex container
        // anchors the content's vertical center to the container's
        // center even when scrolled past — the overflow above is
        // unreachable. Canonical fix: `flex-start` on the parent,
        // `marginBlock: auto` on the child. Short content still
        // centers (auto margins distribute the positive free space);
        // tall content sits at the top with the rest scrollable.
        alignItems: "flex-start",
        justifyContent: "center",
        padding: 16,
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 632,
          width: "100%",
          // Auto top/bottom margins center short content vertically
          // while letting tall content overflow naturally — see the
          // parent's alignItems comment for the rationale.
          marginTop: "auto",
          marginBottom: "auto",
        }}
      >
        {/* Header strip — title + close button. */}
        <div
          className="flex items-center justify-between mb-3"
          style={{ color: "white" }}
        >
          <h2 id="share-card-modal-title" className="text-base font-medium">
            {t("modalTitle")}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            disabled={busy}
            aria-label={t("close")}
            className="text-xl leading-none p-1 cursor-pointer"
            style={{
              background: "transparent",
              border: "none",
              color: "white",
              cursor: busy ? "wait" : "pointer",
            }}
          >
            ✕
          </button>
        </div>

        {/* Theme toggle */}
        <div
          className="flex justify-center gap-2 mb-3"
          role="group"
          aria-label={t("modalTitle")}
        >
          {(["dark", "light"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => handleThemeChange(m)}
              disabled={busy}
              aria-pressed={theme === m}
              className="text-xs font-medium rounded-full px-4 py-1 cursor-pointer"
              style={{
                background: theme === m ? "#0277BD" : "white",
                color: theme === m ? "white" : "#475569",
                border: "0.5px solid #e2e8f0",
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {t(m === "dark" ? "themeDark" : "themeLight")}
            </button>
          ))}
        </div>

        {/* Card preview */}
        <div className="flex justify-center">
          <ShareCardPreview
            ref={cardRef}
            theme={theme}
            mode={mode}
            seriesName={seriesName}
            eventTitle={eventTitle}
            dateLine={dateLine}
            actualSongs={actualSongs}
            predictions={predictions}
            matched={matched}
            total={total}
            percentage={percentage}
            predictedCount={predictedCount}
            locale={locale}
          />
        </div>

        {/* Action buttons — directly below the preview, side-by-side,
            flex-1 so each takes equal width, min-h-[44px] for touch-
            target ergonomics (Apple HIG / Material recommended
            minimum). Both buttons share the brand gradient bg so
            they read as a pair of primary actions; the icon glyph +
            label communicates which intent is which. Shared style
            hoisted so a future palette change touches one place,
            not two — CR-flagged duplication. */}
        {(() => {
          const actionButtonStyle: React.CSSProperties = {
            minHeight: 44,
            background: busy
              ? "#94a3b8"
              : "linear-gradient(135deg, #4FC3F7, #0277BD)",
            color: "white",
            border: "none",
            cursor: busy ? "wait" : "pointer",
          };
          const actionButtonClass =
            "flex-1 inline-flex items-center justify-center gap-2 text-sm font-medium rounded-full px-5 cursor-pointer";
          return (
            <div
              className="flex justify-center gap-2 mt-3"
              style={{
                maxWidth: 600,
                marginLeft: "auto",
                marginRight: "auto",
              }}
            >
              <button
                type="button"
                onClick={handleShare}
                disabled={busy}
                className={actionButtonClass}
                style={actionButtonStyle}
              >
                {/* Per-platform label: touch-primary devices route to
                    `navigator.share` (OS share sheet), non-touch to a
                    direct file download. v0.11.4 used a combined
                    "다운로드 / 공유" label, which wrapped onto two lines
                    on narrow iPhone viewports + misled users about the
                    actual action. One word matches what actually
                    happens on the device — and the icon already swaps
                    for the same reason. */}
                {isShareCapable ? <ShareIcon /> : <DownloadIcon />}
                <span>
                  {isShareCapable ? t("shareImage") : t("downloadImage")}
                </span>
              </button>
              {clipboardSupported && (
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={busy}
                  className={actionButtonClass}
                  style={actionButtonStyle}
                >
                  <CopyIcon />
                  <span>{t("copyImage")}</span>
                </button>
              )}
            </div>
          );
        })()}

        {/* Toast */}
        {toast && (
          <div
            role="status"
            aria-live="polite"
            className="text-center mt-3 text-xs"
            style={{
              color: "white",
              background: "rgba(15, 23, 42, 0.85)",
              padding: "8px 12px",
              borderRadius: 8,
              maxWidth: 360,
              margin: "12px auto 0",
            }}
          >
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Inline SVG icons (no new dependency). Each is sized 16×16 with
 * stroke-based outlines so they inherit the parent's text color via
 * `currentColor` — works against the brand-gradient button bg.
 *
 * **Why inline, not lucide-react / heroicons-react**: the share-card
 * modal is the only consumer right now and we already keep the
 * client bundle lean (html2canvas is dynamic-imported for the same
 * reason). Three small SVGs cost ~30 lines vs an entire icon package.
 */
function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Downward arrow into a tray — communicates "to disk". */}
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* iOS-style share box: rounded square with an arrow exiting
          the top. Universally recognized as "send / share out". */}
      <path d="M12 3v12" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Two overlapping rounded squares — the universal "copy"
          glyph in macOS / Windows / Material / iOS keyboards. */}
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
