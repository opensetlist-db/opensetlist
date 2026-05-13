"use client";

import { forwardRef } from "react";
import { useTranslations } from "next-intl";
import { displayOriginalTitle } from "@/lib/display";
import { BRAND_NAME, BRAND_URL_DISPLAY } from "@/lib/config";
import { isSongMatched } from "@/lib/songMatch";
import type { PredictionEntry } from "@/lib/predictionsStorage";
import type { LiveSetlistItem } from "@/lib/types/setlist";
import { shareCardColors, type ShareCardTheme } from "@/styles/tokens";

/**
 * Render mode for the share card. Drives both `<ShareCardPreview>`'s
 * layout and `<ShareCardButton>`'s label / `<ShareCardModal>`'s share
 * text. The mode is derived from `status + actualSongs` at the
 * button level (see `<ShareCardButton>`):
 *
 *   - `"prediction"` — pre-show (`upcoming`) OR ongoing with no actual
 *     songs entered yet. Shows the viewer's predicted setlist in their
 *     chosen rank order. No score banner (there's nothing to compare
 *     against). Pre-show share is the viral entry point: fans share
 *     their predictions BEFORE the show, friends see them, friends
 *     show up. v0.11.1-and-earlier only enabled share post-show, which
 *     missed this whole funnel.
 *   - `"live"` — ongoing AND actualSongs has at least one row.
 *     Identical layout to `"final"` (score banner + actual setlist
 *     with hit highlighting) but with a red `LIVE` pill in the top-
 *     right corner signaling the result is partial / mid-flight.
 *   - `"final"` — completed. Current post-show layout — final score,
 *     full actual setlist.
 */
export type ShareCardMode = "prediction" | "live" | "final";

/**
 * "LIVE" badge red — intentionally theme-invariant so the captured
 * PNG reads as a live indicator regardless of whether the user
 * shared from the dark or light card theme. Tailwind red-600
 * (#dc2626) matches the project's existing `colors.live` token but
 * is duplicated here, not imported, so the share-card visual
 * language stays decoupled from event-status palette decisions that
 * might re-tone `colors.live` for accessibility or branding reasons
 * later.
 */
const LIVE_BADGE_BG = "#dc2626";

/**
 * Pixel footprint reserved on the right of the title block when the
 * LIVE badge is rendered absolutely-positioned in the corner. Drives
 * the `paddingRight` on the title container so long event titles
 * truncate (via natural wrap) rather than running under the badge.
 *
 * Locked to the badge's actual rendered width: 6px pulse dot + 6px
 * gap + ~28px "LIVE" text at 11px font + 10px+10px horizontal padding
 * + 0.5px×2 inner spacing = ~60px badge content + ~12px gap from
 * title block + ~8px right-side breathing room ≈ 80px. If the badge
 * geometry changes (font size, padding, label text), revisit this
 * constant in lockstep — coupling is explicit by design so a future
 * tweak to the badge doesn't silently overlap the title.
 */
const LIVE_BADGE_RESERVED_PX = 80;

/**
 * Row-height floor for song-title rows in the captured PNG. iOS
 * Safari's html2canvas pipeline collapses line-boxes on `overflow:
 * hidden + whiteSpace: nowrap` spans more aggressively than desktop
 * browsers do, clipping the bottom half of each title in the saved
 * image. Forcing the row's `minHeight` to a known floor bypasses
 * line-box computation entirely — the row physically owns enough
 * vertical space to contain the rendered text regardless of how the
 * capture pipeline interprets line-height.
 *
 * 28px = 1.8 × ~15px (room for 13px font + 2px descender headroom)
 * + small slop for cross-browser font-metrics variance. Browsers
 * fold this into the natural row height (no visible change in the
 * live preview); only the captured PNG depends on the floor.
 */
const CAPTURE_ROW_MIN_HEIGHT_PX = 28;

/**
 * Line-height multiplier for song-title spans, paired with the row
 * `minHeight` floor above. Successive iOS Safari captures pushed this
 * upward: PR #305 / v0.10.2 used 1.5 for desktop html2canvas, 1.8 was
 * needed once mobile captures showed up, and 2.2 was needed after
 * operator feedback that the bottom pixels of letters like e/v/B
 * (which extend slightly below the baseline) were still being clipped
 * by the title span's own `overflow: hidden`. 2.2 × 13px ≈ 28.6px
 * line-box, giving ~7px of leading below the descender — enough buffer
 * that any iOS Safari glyph-placement drift stays inside the span's
 * visible bounds.
 *
 * Belt-and-suspenders with `CAPTURE_ROW_MIN_HEIGHT_PX`. If a future
 * browser quirk affects one of the two, the other should still keep
 * the glyph inside the captured bounds.
 */
const CAPTURE_ROW_LINE_HEIGHT = 2.2;

/**
 * Side length of the checkbox-style hit indicator that sits before
 * the position number on every song row. Must stay in lockstep
 * across all three row variants — `ShareCardRow`'s filled-checkbox
 * (hit), `ShareCardRow`'s outline-only box (miss), and
 * `PredictionRow`'s transparent spacer — so the rank column's left
 * edge lands at the same x in every captured PNG regardless of
 * mode. 14px is the smallest size that keeps the ✓ glyph legible at
 * scale=2 capture quality.
 */
const INDICATOR_SIZE_PX = 14;

interface Props {
  theme: ShareCardTheme;
  mode: ShareCardMode;
  /** Pre-resolved series + event title for the card header. */
  seriesName: string;
  eventTitle: string;
  /** Pre-formatted date+venue line (page resolves via formatVenueDate). */
  dateLine: string;
  /**
   * Actual setlist filtered to song-type items already (caller does the
   * filter). Encore vs main split via `isEncore` on each row. Empty in
   * `mode === "prediction"`; required + non-empty in `live` / `final`.
   */
  actualSongs: LiveSetlistItem[];
  /**
   * User's prediction list. Drives the rendered rows in `prediction`
   * mode (rank = the user's chosen order). Drives hit/miss derivation
   * for `live` / `final` modes.
   */
  predictions: PredictionEntry[];
  /**
   * Pre-computed score from `calcShareCardScore` (order-independent).
   * Only consumed in `live` / `final` modes; ignored in `prediction`.
   */
  matched: number;
  total: number;
  percentage: number;
  /** Display locale (drives `displayOriginalTitle`). */
  locale: string;
}

/**
 * The DOM target for `html2canvas`. Forwarded ref lets the parent
 * (`<ShareCardModal>`) pass the element to the capture helper.
 *
 * Width is fixed at 600px per `raw/mockups/mockup-share-card.jsx`
 * — at scale=2, html2canvas produces a 1200px PNG which Twitter
 * accepts at full quality. Heights flow naturally from setlist
 * length.
 *
 * Renders song titles only (no performers / unit / subtitle / MC
 * / video / interval). Caller is responsible for filtering
 * `type === "song"`.
 */
export const ShareCardPreview = forwardRef<HTMLDivElement, Props>(
  function ShareCardPreview(
    {
      theme,
      mode,
      seriesName,
      eventTitle,
      dateLine,
      actualSongs,
      predictions,
      matched,
      total,
      percentage,
      locale,
    },
    ref,
  ) {
    const t = useTranslations("ShareCard");
    const T = shareCardColors[theme];
    const isPredictionMode = mode === "prediction";
    const isLiveMode = mode === "live";

    const mainSongs = actualSongs.filter((s) => !s.isEncore);
    const encoreSongs = actualSongs.filter((s) => s.isEncore);

    return (
      <div
        ref={ref}
        style={{
          width: 600,
          background: T.cardBg,
          borderRadius: 20,
          overflow: "hidden",
          border: T.cardBorder,
          // Latin-first fallback chain so ASCII characters (Latin
          // letters, digits, spaces) render with the system Latin
          // font's metrics — `system-ui` resolves to SF Pro on
          // iOS/macOS, Segoe UI on Windows, Roboto on Android — and
          // CJK characters fall through to Noto Sans JP / Pretendard
          // / Noto Sans KR. The pre-v0.11.5 order put `Noto Sans JP`
          // first which the live browser handled fine (modern CSS
          // text-shaping uses per-script font selection), but
          // html2canvas's capture pipeline on iOS Safari fell back
          // wholesale to Hiragino for the whole run and rendered
          // ASCII spaces at ideographic (full-width) metrics —
          // operator-spotted: "Garden  Stage  /  兵庫  公演  Day .1"
          // in the captured PNG vs tight "Garden Stage／兵庫公演 Day.1"
          // in the live preview. Putting the Latin-resolving system
          // font first makes the per-script selection more robust
          // through the capture pipeline.
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Noto Sans JP', 'Pretendard', 'Noto Sans KR', sans-serif",
          position: "relative",
        }}
      >
        {/* Dark: radial gradient overlay covers the whole card.
            Both themes: 4px top accent bar (light-blue → brand-blue
            gradient). The accent bar is rendered with explicit
            stacking (position: relative, z-index: 2) so it sits
            above the dark theme's absolutely-positioned radial
            overlay — without the stacking, the overlay would paint
            over the top 4px and hide the accent. */}
        {T.radialOverlay && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: T.radialOverlay,
            }}
          />
        )}
        {T.topBar && (
          <div
            style={{
              position: "relative",
              zIndex: 2,
              height: 4,
              background: T.topBar,
            }}
          />
        )}

        <div style={{ position: "relative", zIndex: 1, padding: "26px 32px 22px" }}>
          {/* Header — series + event title + date. Live-mode adds a red
              LIVE pill in the top-right corner so anyone re-seeing this
              image after the show ends still knows it was captured
              mid-flight (the percentage in the banner is partial, not
              final). Pre-show prediction cards don't carry the pill —
              there's no result to qualify.

              v0.11.4 originally used `display: flex` here with a
              `flex: 1` title block. Operator-spotted on the captured
              PNG: the event title rendered noticeably wider than the
              live browser preview, ignoring the flex constraint.
              Cause: html2canvas doesn't reliably honor flexbox sizing
              when capturing — flex children fall back to intrinsic
              width rather than the computed share. Switched to
              absolute positioning for the LIVE badge with explicit
              `paddingRight` on the title block when present, so the
              title's width is bounded by a paddingBox rather than a
              flex computation. Renders identically in the live
              preview (paddingRight reserves the badge's pixel
              footprint, see LIVE_BADGE_RESERVED_PX) and the captured
              PNG (paddingRight is a standard box-model property
              html2canvas honors). */}
          <div
            style={{
              position: "relative",
              marginBottom: 20,
              paddingRight: isLiveMode ? LIVE_BADGE_RESERVED_PX : 0,
            }}
          >
            {/* Series row: hidden entirely when seriesName is empty
                so standalone events (no series) get a card with just
                title + date instead of an empty caps-style row at the
                top. v0.11.5 plumbed real seriesName values through;
                pre-v0.11.5 the field was a placeholder duplicated
                from the title. */}
            {seriesName && (
              <div
                data-capture-shift="series-caption"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: T.series,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                {seriesName}
              </div>
            )}
            <div
              data-capture-shift="event-title"
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: T.title,
                // Bumped from 1.3 → 1.5 to match the same html2canvas-
                // glyph-clipping fix PR #305 applied to song-title
                // rows. Tight line-heights collapse the line-box on
                // capture and clip glyph extents; 1.5 reserves enough
                // vertical room for Latin descenders + CJK glyph
                // extents without making the title noticeably taller
                // in the live browser preview.
                lineHeight: 1.5,
                marginBottom: 3,
              }}
            >
              {eventTitle}
            </div>
            {dateLine && (
              <div style={{ fontSize: 12, color: T.date }}>
                {dateLine}
              </div>
            )}
            {isLiveMode && (
              <div style={{ position: "absolute", top: 0, right: 0 }}>
                <LiveBadge label={t("liveBadge")} />
              </div>
            )}
          </div>

          {isPredictionMode ? (
            <PredictionList
              predictions={predictions}
              locale={locale}
              T={T}
              sectionLabel={t("predictionLabel")}
              countLabel={t("predictionCount", { count: predictions.length })}
            />
          ) : (
            <ActualResultBody
              mainSongs={mainSongs}
              encoreSongs={encoreSongs}
              predictions={predictions}
              matched={matched}
              total={total}
              percentage={percentage}
              locale={locale}
              T={T}
              labels={{
                scoreLabel: t("scoreLabel"),
                encore: t("encore"),
              }}
            />
          )}

          {/* Footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 18,
              paddingTop: 14,
              borderTop: `1px solid ${T.footerBorder}`,
            }}
          >
            <span
              style={{
                fontFamily: "'Josefin Sans', sans-serif",
                fontSize: 12,
                fontWeight: 700,
                color: T.footerBrand,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              {BRAND_NAME}
            </span>
            <span style={{ fontSize: 10, color: T.footerUrl }}>
              {BRAND_URL_DISPLAY}
            </span>
          </div>
        </div>
      </div>
    );
  },
);

/**
 * Pre-show / no-actuals-yet variant. Renders a section label + the
 * viewer's predictions in their chosen rank order. No hit/miss state
 * because there's no actual setlist to compare against — the dots +
 * underline + green tint that drive the live/final variants would be
 * meaningless. The rank number stays so the card communicates the
 * predicted ORDER, not just the song set.
 */
function PredictionList({
  predictions,
  locale,
  T,
  sectionLabel,
  countLabel,
}: {
  predictions: PredictionEntry[];
  locale: string;
  T: typeof shareCardColors.dark;
  sectionLabel: string;
  countLabel: string;
}) {
  return (
    <>
      {/* Section label strip — replaces the score banner. Keeps the
          card's visual rhythm (header → labeled section → list) without
          claiming an accuracy number that doesn't exist yet. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
          paddingBottom: 8,
          borderBottom: `1px solid ${T.footerBorder}`,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: T.scoreLabel,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {sectionLabel}
        </span>
        <span style={{ fontSize: 12, color: T.scorePred }}>{countLabel}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 4 }}>
        {predictions.map((entry, i) => (
          <PredictionRow
            key={entry.songId}
            entry={entry}
            rank={i + 1}
            T={T}
            locale={locale}
          />
        ))}
      </div>
    </>
  );
}

/**
 * Live / final result body. Identical to the pre-v0.11.2 layout —
 * score banner + actual setlist rows with hit/miss highlighting +
 * encore divider. The LIVE pill in the parent header is the only
 * visual difference between `live` and `final` modes; everything in
 * this body is shared.
 */
function ActualResultBody({
  mainSongs,
  encoreSongs,
  predictions,
  matched,
  total,
  percentage,
  locale,
  T,
  labels,
}: {
  mainSongs: LiveSetlistItem[];
  encoreSongs: LiveSetlistItem[];
  predictions: PredictionEntry[];
  matched: number;
  total: number;
  percentage: number;
  locale: string;
  T: typeof shareCardColors.dark;
  labels: {
    scoreLabel: string;
    encore: string;
  };
}) {
  return (
    <>
      {/* Score banner */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: T.bannerBg,
          border: T.bannerBorder,
          boxShadow: T.bannerShadow,
          borderRadius: 12,
          padding: "14px 20px",
          marginBottom: 20,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: T.scoreLabel,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            {labels.scoreLabel}
          </div>
          <div data-capture-shift="score-percent">
            <span
              style={{
                fontSize: 36,
                fontWeight: 700,
                color: T.scoreMain,
                lineHeight: 1,
                letterSpacing: "-0.02em",
              }}
            >
              {percentage}
            </span>
            <span
              style={{
                fontSize: 20,
                fontWeight: 600,
                color: T.scorePct,
                marginLeft: 3,
              }}
            >
              %
            </span>
          </div>
          {/* "X of Y songs hit" subline removed in v0.11.6 — the big
              fraction in the right column already encodes that count,
              and the captured card reads tighter without the
              redundant phrasing under the percentage. */}
        </div>
        <div style={{ textAlign: "right" }}>
          {/* "X predicted" caption removed in v0.11.6 alongside the
              "X of Y hit" subline — the big M/T fraction is the only
              right-column element now. */}
          <div
            data-capture-shift="score-fraction"
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: T.scoreFrac,
              lineHeight: 1,
            }}
          >
            {matched} / {total}
          </div>
        </div>
      </div>

      {/* Setlist rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 4 }}>
        {mainSongs.map((item, i) => (
          <ShareCardRow
            key={item.id}
            item={item}
            rank={i + 1}
            hit={isHit(item, predictions)}
            T={T}
            locale={locale}
          />
        ))}
      </div>

      {encoreSongs.length > 0 && (
        <>
          <EncoreDivider label={labels.encore} T={T} />
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {encoreSongs.map((item, i) => (
              <ShareCardRow
                key={item.id}
                item={item}
                // Continue numbering past the main set rather than
                // restart at 1 — the share card is a single setlist
                // surface, so an event with 15 main + 3 encore reads
                // as 1..18, not 1..15 followed by 1..3 (the latter
                // would visually suggest two unrelated lists).
                rank={mainSongs.length + i + 1}
                hit={isHit(item, predictions)}
                T={T}
                locale={locale}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

/**
 * Red pill rendered in the top-right of the card header during
 * `live` mode. Uses inline RGB values (not theme tokens) because
 * "LIVE" semantics are theme-invariant — same red pulses in both
 * dark and light cards, so the OS share / saved image reads
 * unambiguously regardless of theme. The pulsing dot is a static
 * filled circle in the captured PNG (animation doesn't survive
 * html2canvas), styled to mirror the live-now visual language
 * used elsewhere on the site.
 */
function LiveBadge({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
        padding: "4px 10px",
        borderRadius: 999,
        background: LIVE_BADGE_BG,
        color: "white",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        lineHeight: 1,
      }}
    >
      <span
        data-capture-shift="live-badge-dot"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "white",
          flexShrink: 0,
        }}
      />
      <span data-capture-shift="live-badge-label">{label}</span>
    </span>
  );
}

function isHit(item: LiveSetlistItem, predictions: PredictionEntry[]): boolean {
  return predictions.some((p) => isSongMatched(p.songId, [item]));
}

/**
 * Renders a single song row in `prediction` mode. Compared to the
 * live/final `<ShareCardRow>`, this one drops the hit-dot and the
 * green hit-highlight palette — there's no comparison surface yet,
 * so every prediction renders identically in the muted "miss"
 * color (which here just reads as "neutral, not yet scored").
 */
function PredictionRow({
  entry,
  rank,
  T,
  locale,
}: {
  entry: PredictionEntry;
  rank: number;
  T: typeof shareCardColors.dark;
  locale: string;
}) {
  const display = displayOriginalTitle(
    entry.song,
    entry.song.translations,
    locale,
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 8px",
        // Explicit minHeight so html2canvas can't compute a row taller
        // than the line-box it ends up rendering. PR #305 / v0.11.4
        // set `lineHeight: 1.5` on the title span; operator's iPhone
        // capture still showed the bottom half of every song title
        // clipped, which is too much to be just a descender issue —
        // html2canvas on iOS Safari was rendering the line-box at
        // roughly half the computed CSS height. Forcing a row floor
        // of 28px (= 1.5 × 18px line-height for 13px font + 1px slop)
        // means the row physically owns enough vertical space to
        // contain the rendered text regardless of how html2canvas
        // interprets line-height. Live preview reads the same since
        // the natural row height with the same content is ~28px
        // anyway — this is a no-op for the browser, a load-bearing
        // floor for the capture.
        minHeight: CAPTURE_ROW_MIN_HEIGHT_PX,
        borderRadius: 5,
      }}
    >
      {/* 14px spacer placed BEFORE the rank, mirroring the live/final
          mode's filled-checkbox / empty-box that occupies the same
          slot. Pre-show there's nothing to compare against — every
          prediction is just a prediction, no match status to show —
          so a transparent spacer keeps the title's horizontal
          position aligned with the post-show capture of the same
          event. Without it (or with a 5px spacer matching the
          pre-v0.11.6 hit-dot width), titles would shift between
          modes and the "this is the same surface" mental model
          would break. */}
      <span style={{ width: INDICATOR_SIZE_PX, flexShrink: 0 }} />
      <span
        data-capture-shift="row-number"
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: T.numColor,
          width: 18,
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {rank}
      </span>
      <span
        data-capture-shift="row-title"
        style={{
          fontSize: 13,
          lineHeight: CAPTURE_ROW_LINE_HEIGHT,
          flex: 1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          color: T.missColor,
          fontWeight: 400,
        }}
      >
        {display.main}
      </span>
    </div>
  );
}

function ShareCardRow({
  item,
  rank,
  hit,
  T,
  locale,
}: {
  item: LiveSetlistItem;
  rank: number;
  hit: boolean;
  T: typeof shareCardColors.dark;
  locale: string;
}) {
  // Pull the first song's display payload — share card titles
  // collapse medleys to the first song for legibility (full medley
  // detail belongs in the live tab, not the share card).
  const song = item.songs[0]?.song;
  const display = song
    ? displayOriginalTitle(song, song.translations, locale)
    : { main: "", sub: null, variant: null };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 8px",
        // See <PredictionRow> for the minHeight rationale — iOS
        // Safari's html2canvas pipeline collapses the line-box,
        // forcing a 28px row floor keeps the rendered text fully
        // inside the captured bounds. No-op for the live browser
        // preview where the natural row height matches.
        minHeight: CAPTURE_ROW_MIN_HEIGHT_PX,
        borderRadius: 5,
        background: hit ? T.hitRowBg : "transparent",
      }}
    >
      {/* Checkbox-style hit indicator placed BEFORE the position
          number (operator preference) so the matched/unmatched
          signal is the first thing a viewer's eye lands on as the
          list reads top-to-bottom. Filled box + white ✓ for hit
          rows; same-size outline-only box for miss rows so titles
          stay vertically aligned across the captured PNG. Pre-
          v0.11.6 used a 5px dot on hit + a 5px spacer on miss; the
          dot's vertical centering was inconsistent at small sizes
          and the size-asymmetry between dot/spacer let titles
          drift by ~half a pixel. */}
      {hit ? (
        <span
          style={{
            width: INDICATOR_SIZE_PX,
            height: INDICATOR_SIZE_PX,
            borderRadius: 3,
            background: T.hitDot,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            // Box stays at flex-center (no positional shift). The
            // generous CAPTURE_ROW_LINE_HEIGHT (2.2) makes the row
            // tall enough that the title's flex-centered cap-middle
            // and the box's geometric center land within ~1.4px of
            // each other — close enough to read as aligned without
            // requiring a `position: relative; top: -n` nudge that
            // would couple the box's position to the line-height in
            // ways that drift as either is retuned.
          }}
        >
          {/* Inline SVG check mark instead of the U+2713 text glyph.
              The text glyph's vertical positioning varies by font —
              with a Latin-first fontFamily, html2canvas picks up
              SF Pro / system-ui, whose ✓ baselines higher than
              Hiragino's and visibly drifts above the box center.
              SVG geometry is deterministic: the polyline sits at
              fixed coordinates inside the viewBox, and the parent
              flex `alignItems: center` / `justifyContent: center`
              then centers the 10×10 SVG cleanly inside the 14×14
              box on every renderer. */}
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      ) : (
        <span
          style={{
            width: INDICATOR_SIZE_PX,
            height: INDICATOR_SIZE_PX,
            borderRadius: 3,
            border: `1.5px solid ${T.missColor}`,
            boxSizing: "border-box",
            flexShrink: 0,
            // Matches the filled-hit box above — both variants rely
            // on the row's flex-centering + the generous line-height
            // to land aligned with the title text without a manual
            // shift. Keeping hit + miss in lockstep means rows stack
            // with identical vertical positioning regardless of
            // match status.
          }}
        />
      )}
      <span
        data-capture-shift="row-number"
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: T.numColor,
          width: 18,
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {rank}
      </span>
      <span
        data-capture-shift="row-title"
        style={{
          fontSize: 13,
          lineHeight: CAPTURE_ROW_LINE_HEIGHT,
          flex: 1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          color: hit ? T.hitText : T.missColor,
          fontWeight: hit ? 600 : 400,
          textDecoration: hit ? "underline" : "none",
          textDecorationColor: hit ? T.hitUnderline : "transparent",
          textUnderlineOffset: 3,
          textDecorationThickness: 2,
        }}
      >
        {display.main}
      </span>
    </div>
  );
}

function EncoreDivider({
  label,
  T,
}: {
  label: string;
  T: typeof shareCardColors.dark;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        margin: "8px 8px 4px",
      }}
    >
      <div style={{ flex: 1, height: 1, background: T.encLine }} />
      <span
        style={{
          fontSize: 9,
          color: T.encLabel,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: T.encLine }} />
    </div>
  );
}
