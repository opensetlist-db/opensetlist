"use client";

import { forwardRef } from "react";
import { useTranslations } from "next-intl";
import { displayOriginalTitle } from "@/lib/display";
import { BRAND_NAME, BRAND_URL_DISPLAY } from "@/lib/config";
import { isSongMatched } from "@/lib/songMatch";
import type { PredictionEntry } from "@/lib/predictionsStorage";
import type { LiveSetlistItem } from "@/lib/types/setlist";
import { shareCardColors, type ShareCardTheme } from "@/styles/tokens";

interface Props {
  theme: ShareCardTheme;
  /** Pre-resolved series + event title for the card header. */
  seriesName: string;
  eventTitle: string;
  /** Pre-formatted date+venue line (page resolves via formatVenueDate). */
  dateLine: string;
  /**
   * Actual setlist filtered to song-type items already (caller does the
   * filter). Encore vs main split via `isEncore` on each row.
   */
  actualSongs: LiveSetlistItem[];
  /** User's prediction list (for hit/miss derivation). */
  predictions: PredictionEntry[];
  /** Pre-computed score from `calcShareCardScore` (order-independent). */
  matched: number;
  total: number;
  percentage: number;
  predictedCount: number;
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
    },
    ref,
  ) {
    const t = useTranslations("ShareCard");
    const T = shareCardColors[theme];
    const isLight = theme === "light";

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
          fontFamily: "'Noto Sans JP', 'Pretendard', 'Noto Sans KR', sans-serif",
          position: "relative",
        }}
      >
        {/* Dark: radial gradient overlay; light: top accent bar. */}
        {!isLight && T.radialOverlay && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: T.radialOverlay,
            }}
          />
        )}
        {isLight && T.topBar && (
          <div style={{ height: 4, background: T.topBar }} />
        )}

        <div style={{ position: "relative", zIndex: 1, padding: "26px 32px 22px" }}>
          {/* Header */}
          <div
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
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: T.title,
              lineHeight: 1.3,
              marginBottom: 3,
            }}
          >
            {eventTitle}
          </div>
          <div style={{ fontSize: 12, color: T.date, marginBottom: 20 }}>
            {dateLine}
          </div>

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
                {t("scoreLabel")}
              </div>
              <div>
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
              <div style={{ fontSize: 12, color: T.scoreSub, marginTop: 3 }}>
                {t("scoreMatchedOf", { matched, total })}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: T.scorePred }}>
                {t("scorePredicted", { count: predictedCount })}
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: T.scoreFrac,
                  lineHeight: 1,
                  marginTop: 4,
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
              <EncoreDivider label={t("encore")} T={T} />
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {encoreSongs.map((item, i) => (
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
            </>
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

function isHit(item: LiveSetlistItem, predictions: PredictionEntry[]): boolean {
  return predictions.some((p) => isSongMatched(p.songId, [item]));
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
        borderRadius: 5,
        background: hit ? T.hitRowBg : "transparent",
      }}
    >
      <span
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
      {hit ? (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: T.hitDot,
            boxShadow: T.hitDotGlow,
            flexShrink: 0,
          }}
        />
      ) : (
        <span style={{ width: 5, flexShrink: 0 }} />
      )}
      <span
        style={{
          fontSize: 13,
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
