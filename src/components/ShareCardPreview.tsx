"use client";

import { forwardRef } from "react";
import type { ShareCardMode } from "@/lib/shareCardMode";
import { useTranslations } from "next-intl";
import { displayOriginalTitle } from "@/lib/display";
import { BRAND_NAME, BRAND_URL_DISPLAY } from "@/lib/config";
import { isSongMatched } from "@/lib/songMatch";
import {
  CAPTURE_SHIFT_ATTR,
  type CaptureShiftKey,
} from "@/lib/shareCard";
import { CARD_CAPTURE_WIDTH_PX } from "@/lib/shareCardConstants";

/**
 * JSX prop spread that tags an element so html2canvas's onclone in
 * shareCard.ts will apply its capture-only vertical centering
 * shift. The key is typed via {@link CaptureShiftKey}, so a typo
 * here fails at compile time instead of silently dropping the
 * shift on capture.
 */
function captureShift(key: CaptureShiftKey) {
  return { [CAPTURE_SHIFT_ATTR]: key };
}
import type { PredictionEntry } from "@/lib/predictionsStorage";
import type { LiveSetlistItem } from "@/lib/types/setlist";
import { colors, type ShareCardTheme } from "@/styles/tokens";


/*
 * Share-card palette — approved packet 18-share-v1 (wiki
 * `output/redesign/handoffs/18/share-v1/style.css`). Each phase owns
 * an accent + header wash: pre-show pink, live blue, final lavender
 * (the card family shared with the concert-detail page); the dark
 * theme repaints the export only — the site itself stays light.
 *
 * Kept in this file (ShareCard* files may carry their own hexes) rather
 * than in `tokens.ts`: the exported bitmap is its own surface, and its
 * colours were measured on the 600px card, not against page chrome.
 * Hit rows pair a green ✓ with a tinted row; rows that were not
 * predicted get a neutral dot (and the legend says so), never a
 * red/"failed" mark — a live snapshot can't call an unplayed
 * prediction a miss yet.
 */
interface CardPalette {
  ink: string;
  muted: string;
  surface: string;
  line: string;
  row: string;
  hit: string;
  hitBg: string;
  accent: string;
  wash: string;
}

const BASE: Record<ShareCardTheme, CardPalette> = {
  light: {
    ink: "#172445",
    muted: "#52617a",
    surface: "#ffffff",
    line: "#dce2ed",
    row: "#f4f6fb",
    hit: "#176c50",
    hitBg: "#e7f6ef",
    accent: "#5b3ca1",
    wash: "#eee5ff",
  },
  dark: {
    ink: "#f3f5ff",
    muted: "#bcc7df",
    surface: "#14213a",
    line: "#3b4b65",
    row: "#1e2c45",
    hit: "#9ce6c4",
    hitBg: "#153d37",
    accent: "#cdb7ff",
    wash: "#342d51",
  },
};

const PHASE_ACCENT: Record<
  ShareCardTheme,
  Record<ShareCardMode, Pick<CardPalette, "accent" | "wash">>
> = {
  light: {
    prediction: { accent: "#99385f", wash: "#ffe3f0" },
    live: { accent: "#165dcc", wash: "#dcedff" },
    final: { accent: "#5b3ca1", wash: "#eee5ff" },
  },
  dark: {
    prediction: { accent: "#f6b9d1", wash: "#49283f" },
    live: { accent: "#a6d3ff", wash: "#1d3c5c" },
    final: { accent: "#cdb7ff", wash: "#342d51" },
  },
};

function paletteFor(theme: ShareCardTheme, mode: ShareCardMode): CardPalette {
  return { ...BASE[theme], ...PHASE_ACCENT[theme][mode] };
}

/** Thin three-colour strip on top of every card (pink / blue / lavender). */
const RIBBON =
  "linear-gradient(90deg, #e9a7c7 0 28%, #9dcaf1 28% 62%, #bfa8ec 62% 100%)";

const LIVE_PILL = {
  light: { color: colors.live, background: colors.liveBg },
  dark: { color: colors.liveDark, background: colors.liveDarkBg },
};

/**
 * Pixel footprint reserved on the right of the header's top line for
 * the phase pill. The pill is absolutely positioned (html2canvas does
 * not reliably honour flex sizing when it captures — flex children
 * fall back to intrinsic width), so the eyebrow's box is bounded by a
 * padding instead.
 */
const PILL_RESERVED_PX = 120;

/**
 * Song-row geometry. iOS Safari's html2canvas pipeline collapses
 * line-boxes on `overflow: hidden + nowrap` spans and clipped the
 * bottom of titles in saved images; two safeguards from the earlier
 * card are kept: an explicit row `minHeight` (the row owns its height
 * whatever line-height the capture computes) and a generous title
 * line-height (≈ 7px of leading below descenders). With 14px titles,
 * `2.2 × 14 ≈ 31px` + 6px padding top and bottom lands on the
 * approved ~42px row.
 */
const ROW_MIN_HEIGHT_PX = 42;
const ROW_PADDING_Y_PX = 6;
const CAPTURE_ROW_LINE_HEIGHT = 2.2;

/**
 * Two columns from 21 rows (18-share-v1: up to 20 single column), read
 * left top→bottom then right top→bottom. The split is by entry count
 * (songs + the encore divider) so the columns stay within ±1 entry.
 */
const TWO_COLUMN_MIN_SONG_COUNT = 21;
const COLUMN_GAP_PX = 16;

/**
 * Split an array at the midpoint, biased so the LEFT column gets the
 * extra item on odd counts (a 21-item list reads 1..11 then 12..21).
 */
function splitAtMid<T>(items: T[]): [T[], T[]] {
  const mid = Math.ceil(items.length / 2);
  return [items.slice(0, mid), items.slice(mid)];
}

/** "1" → "01": the approved rows show two-digit positions. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Phase index shown in the eyebrow ("MY SETLIST / 01"). */
const PHASE_INDEX: Record<ShareCardMode, number> = {
  prediction: 1,
  live: 2,
  final: 3,
};

interface Props {
  theme: ShareCardTheme;
  mode: ShareCardMode;
  /** Pre-resolved series + event title for the card header. */
  seriesName: string;
  eventTitle: string;
  /** "2026.05.02 · venue"; empty hides the line. */
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
   * Pre-computed score from `calcShareCardScore` (order-independent,
   * actual song rows with a predicted match / actual song rows). Only
   * consumed in `live` / `final` modes; ignored in `prediction`.
   */
  matched: number;
  total: number;
  percentage: number;
  /** Display locale (drives `displayOriginalTitle` and the live stamp). */
  locale: string;
}

/**
 * The DOM target for `html2canvas`. Forwarded ref lets the parent
 * (`<ShareCardModal>`) pass the element to the capture helper.
 *
 * Width is fixed at 600px; at scale=2 html2canvas produces a 1200px
 * PNG. Height flows from the list length.
 *
 * Renders song titles only (no performers / unit / MC / video /
 * interval). Caller is responsible for filtering `type === "song"`.
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
    const setlistT = useTranslations("Setlist");
    const P = paletteFor(theme, mode);
    const isPrediction = mode === "prediction";
    const isLive = mode === "live";

    const mainSongs = actualSongs.filter((s) => !s.isEncore);
    const encoreSongs = actualSongs.filter((s) => s.isEncore);
    const rowCount = isPrediction ? predictions.length : actualSongs.length;

    const pillLabel = isPrediction
      ? t("pillPrediction")
      : isLive
        ? t("pillLive")
        : t("pillFinal");

    // Live snapshot stamp: a live card is a moment, so it says when.
    // Viewer's locale and zone, minute precision — the modal renders
    // the visible and the capture copy within the same minute.
    const liveStamp = isLive
      ? new Intl.DateTimeFormat(locale, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
        }).format(new Date())
      : "";

    const section = (padding: string, border = true): React.CSSProperties => ({
      padding,
      borderBottom: border ? `1px solid ${P.line}` : undefined,
    });

    return (
      <div
        ref={ref}
        data-share-card=""
        style={{
          width: CARD_CAPTURE_WIDTH_PX,
          background: P.surface,
          color: P.ink,
          border: `1px solid ${P.line}`,
          borderRadius: 16,
          overflow: "hidden",
          // The same self-hosted Latin-first, locale-specific stack as
          // the site. The capture pipeline waits for these exact faces.
          fontFamily: "var(--font-body)",
          fontWeight: 400,
          fontSynthesis: "none",
          position: "relative",
        }}
      >
        <div style={{ height: 7, background: RIBBON }} />

        {/* Header: eyebrow + phase pill, series, event title, date. */}
        <div
          style={{
            padding: "28px 32px 25px",
            background: `linear-gradient(125deg, ${P.wash}, ${P.surface} 92%)`,
          }}
        >
          <div style={{ position: "relative", paddingRight: PILL_RESERVED_PX }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "1.5px",
                color: P.muted,
                lineHeight: 2,
              }}
            >
              {t("eyebrow", { index: pad2(PHASE_INDEX[mode]) })}
            </div>
            <span
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "1px",
                lineHeight: 1.6,
                padding: "4px 10px",
                borderRadius: 30,
                ...(isLive
                  ? { ...LIVE_PILL[theme], border: "1px solid transparent" }
                  : { color: P.accent, border: `1px solid ${P.accent}` }),
              }}
            >
              {/* Inner span carries the capture shift: the pill itself is
                  absolutely positioned, and the shift sets
                  `position: relative` on whatever it tags. */}
              <span {...captureShift("live-badge-label")}>
                {isLive && "● "}
                {pillLabel}
              </span>
            </span>
          </div>
          {seriesName && (
            <div
              {...captureShift("series-caption")}
              style={{
                margin: "22px 0 8px",
                fontSize: 15,
                fontWeight: 600,
                lineHeight: 1.5,
                color: P.accent,
              }}
            >
              {seriesName}
            </div>
          )}
          <div
            {...captureShift("event-title")}
            style={{
              marginTop: seriesName ? 0 : 22,
              fontSize: 29,
              fontWeight: 700,
              lineHeight: 1.4,
              letterSpacing: "-0.8px",
              overflowWrap: "anywhere",
            }}
          >
            {eventTitle}
          </div>
          {dateLine && (
            <div
              style={{
                marginTop: 12,
                fontSize: 12,
                fontWeight: 500,
                lineHeight: 1.6,
                color: P.muted,
              }}
            >
              {dateLine}
            </div>
          )}
        </div>

        {/* Score: the phase title, the big metric, its basis, a note. */}
        <div style={section("24px 32px 22px")}>
          <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.5, marginBottom: 15 }}>
            {isPrediction
              ? t("titlePrediction")
              : isLive
                ? t("titleLive")
                : t("titleFinal")}
          </div>
          {isPrediction ? (
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <span
                {...captureShift("score-percent")}
                style={{ fontSize: 74, fontWeight: 500, lineHeight: 1, letterSpacing: "-4px", color: P.accent }}
              >
                {predictions.length}
              </span>
              <span style={{ fontSize: 13, lineHeight: 1.8, color: P.muted }}>
                {t("predictedUnit")}
              </span>
            </div>
          ) : total > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <span
                {...captureShift("score-percent")}
                style={{ fontSize: 74, fontWeight: 500, lineHeight: 1, letterSpacing: "-4px", color: P.accent }}
              >
                {matched}
                <span style={{ fontSize: 38, letterSpacing: "-2px", color: P.muted, marginLeft: 8 }}>
                  / {total}
                </span>
              </span>
              <span style={{ fontSize: 13, lineHeight: 1.8, color: P.muted }}>
                <span
                  {...captureShift("score-fraction")}
                  style={{ display: "block", fontSize: 24, fontWeight: 700, color: P.accent }}
                >
                  {percentage}%
                </span>
                {isLive
                  ? t("basisLive", { count: total })
                  : t("basisFinal", { count: total })}
              </span>
            </div>
          ) : (
            // Completed with no recorded songs: no numeric result.
            <div style={{ fontSize: 14, lineHeight: 1.8, color: P.muted }}>
              {t("noResult")}
            </div>
          )}
          <div style={{ marginTop: 15, fontSize: 11, lineHeight: 1.65, color: P.muted }}>
            {isPrediction
              ? t("notePrediction")
              : isLive
                ? t("noteLive", { time: liveStamp })
                : t("noteFinal")}
          </div>
        </div>

        {/* The list: predicted order pre-show, performance order after. */}
        <div style={section("20px 32px 22px")}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
              lineHeight: 1.6,
              color: P.muted,
              marginBottom: 12,
            }}
          >
            <span>{isPrediction ? t("orderPrediction") : t("orderActual")}</span>
            <span>{t("tracks", { count: rowCount })}</span>
          </div>
          {isPrediction ? (
            <PredictionRows predictions={predictions} locale={locale} P={P} />
          ) : rowCount > 0 ? (
            <>
              <ActualRows
                mainSongs={mainSongs}
                encoreSongs={encoreSongs}
                predictions={predictions}
                locale={locale}
                P={P}
                encoreLabel={t("encore")}
                unknownLabel={setlistT("unknownSong")}
              />
              <div style={{ marginTop: 14, fontSize: 11, lineHeight: 1.6, color: P.muted }}>
                <span style={{ color: P.hit, fontWeight: 700 }}>✓</span> {t("legendHit")}
                {"　 · "}
                {t("legendMiss")}
              </div>
            </>
          ) : (
            <div style={{ padding: "24px 4px", fontSize: 14, lineHeight: 1.8, color: P.muted }}>
              {t("noResult")}
            </div>
          )}
        </div>

        {/* Footer: wordmark + domain. No image URL or user identifier. */}
        <div
          style={{
            padding: "20px 32px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontFamily: "'Josefin Sans', sans-serif",
              fontSize: 24,
              fontWeight: 400,
              letterSpacing: "0.02em",
              lineHeight: 1.5,
            }}
          >
            {BRAND_NAME.toUpperCase()}
          </span>
          <span style={{ fontSize: 12, color: P.muted }}>{BRAND_URL_DISPLAY}</span>
        </div>
      </div>
    );
  },
);

function isHit(item: LiveSetlistItem, predictions: PredictionEntry[]): boolean {
  // Same matcher as the score (`calcShareCardScore` → `isSongMatched`):
  // variant + medley aware, independent of predicted order.
  return predictions.some((p) => isSongMatched(p.songId, [item]));
}

function Columns({ children }: { children: [React.ReactNode, React.ReactNode] }) {
  return (
    <div style={{ display: "flex", gap: COLUMN_GAP_PX }}>
      {/* `minWidth: 0` lets each column shrink below its content so
          long titles wrap inside the column instead of overflowing. */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {children[0]}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {children[1]}
      </div>
    </div>
  );
}

function Stack({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>;
}

/** Pre-show: the predicted order, no marks and no encore boundary. */
function PredictionRows({
  predictions,
  locale,
  P,
}: {
  predictions: PredictionEntry[];
  locale: string;
  P: CardPalette;
}) {
  const two = predictions.length >= TWO_COLUMN_MIN_SONG_COUNT;
  const row = (entry: PredictionEntry, rank: number) => (
    <Row
      key={entry.songId}
      rank={rank}
      title={displayOriginalTitle(entry.song, entry.song.translations, locale).main}
      mark={null}
      compact={two}
      P={P}
    />
  );
  if (!two) return <Stack>{predictions.map((e, i) => row(e, i + 1))}</Stack>;
  const [left, right] = splitAtMid(predictions);
  return (
    <Columns>
      {[left.map((e, i) => row(e, i + 1)), right.map((e, i) => row(e, left.length + i + 1))]}
    </Columns>
  );
}

/**
 * Live / final: the actual song rows in performance order, numbered
 * continuously through the encore (one setlist, not two lists), with
 * the dashed encore boundary inline in whichever column it lands.
 */
function ActualRows({
  mainSongs,
  encoreSongs,
  predictions,
  locale,
  P,
  encoreLabel,
  unknownLabel,
}: {
  mainSongs: LiveSetlistItem[];
  encoreSongs: LiveSetlistItem[];
  predictions: PredictionEntry[];
  locale: string;
  P: CardPalette;
  encoreLabel: string;
  unknownLabel: string;
}) {
  type Entry =
    | { kind: "song"; item: LiveSetlistItem; rank: number }
    | { kind: "encore" };
  const entries: Entry[] = [
    ...mainSongs.map<Entry>((item, i) => ({ kind: "song", item, rank: i + 1 })),
    ...(encoreSongs.length > 0 ? [{ kind: "encore" } as Entry] : []),
    ...encoreSongs.map<Entry>((item, i) => ({
      kind: "song",
      item,
      rank: mainSongs.length + i + 1,
    })),
  ];
  const two = mainSongs.length + encoreSongs.length >= TWO_COLUMN_MIN_SONG_COUNT;
  const render = (e: Entry, key: string) => {
    if (e.kind === "encore") return <EncoreDivider key={key} label={encoreLabel} P={P} />;
    // Medleys list every available title ("A / B / C"); a row with no
    // title at all says so rather than inventing a name.
    const title =
      e.item.songs
        .map((s) => displayOriginalTitle(s.song, s.song.translations, locale).main)
        .filter(Boolean)
        .join(" / ") || unknownLabel;
    return (
      <Row
        key={key}
        rank={e.rank}
        title={title}
        mark={isHit(e.item, predictions) ? "hit" : "miss"}
        compact={two}
        P={P}
      />
    );
  };
  const keyOf = (e: Entry, i: number) => (e.kind === "song" ? String(e.item.id) : `encore-${i}`);
  if (!two) return <Stack>{entries.map((e, i) => render(e, keyOf(e, i)))}</Stack>;
  const [left, right] = splitAtMid(entries);
  return (
    <Columns>
      {[
        left.map((e, i) => render(e, keyOf(e, i))),
        right.map((e, i) => render(e, keyOf(e, left.length + i))),
      ]}
    </Columns>
  );
}

function Row({
  rank,
  title,
  mark,
  compact,
  P,
}: {
  rank: number;
  title: string;
  /** null = pre-show (no comparison yet). */
  mark: "hit" | "miss" | null;
  /** Two-column rows: tighter padding, 12px titles. */
  compact: boolean;
  P: CardPalette;
}) {
  const hit = mark === "hit";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 6 : 9,
        minHeight: ROW_MIN_HEIGHT_PX,
        padding: `${ROW_PADDING_Y_PX}px ${compact ? 8 : 12}px`,
        borderRadius: 8,
        background: hit ? P.hitBg : P.row,
      }}
    >
      <span
        {...captureShift("row-number")}
        style={{
          width: compact ? 20 : 24,
          flexShrink: 0,
          fontSize: 12,
          fontWeight: 500,
          color: P.muted,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {pad2(rank)}
      </span>
      <span
        {...captureShift("row-title")}
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: compact ? 12 : 14,
          fontWeight: 600,
          lineHeight: CAPTURE_ROW_LINE_HEIGHT,
          // Long titles wrap rather than disappear (18-share-v1).
          overflowWrap: "anywhere",
        }}
      >
        {title}
      </span>
      {mark && (
        <span
          {...captureShift("row-mark")}
          aria-hidden="true"
          style={{
            width: compact ? 16 : 20,
            flexShrink: 0,
            textAlign: "center",
            fontSize: 14,
            fontWeight: hit ? 700 : 400,
            color: hit ? P.hit : P.muted,
          }}
        >
          {hit ? "✓" : "·"}
        </span>
      )}
    </div>
  );
}

function EncoreDivider({ label, P }: { label: string; P: CardPalette }) {
  return (
    <div
      style={{
        margin: "10px 0 2px",
        paddingTop: 10,
        borderTop: `1px dashed ${P.line}`,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: "2px",
        textTransform: "uppercase",
        color: P.muted,
      }}
    >
      {label}
    </div>
  );
}
