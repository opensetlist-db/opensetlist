"use client";

import { useTranslations } from "next-intl";
import { colors, radius } from "@/styles/tokens";

export interface TrendingSong {
  setlistItemId: string;
  /** Original-language title (always present). */
  mainTitle: string;
  /** Localized title — set only when locale ≠ originalLanguage AND the
   *  translated title differs from the original. Mirrors the `sub` slot
   *  on `<SetlistRow>` so the trending card reads as "original · localized"
   *  with the same visual treatment everywhere songs are listed. */
  subTitle: string | null;
  /** Variant label resolved per the same locale-strict cascade as the
   *  setlist row (`displayOriginalTitle` returns this). */
  variantLabel: string | null;
  totalReactions: number;
  topReaction: { type: string; emoji: string; count: number };
}

const MEDALS = ["🥇", "🥈", "🥉"];

// Mockup `event-page-desktop-mockup-v2.jsx:621` — amber-tinted glow
// shadow specific to the trending card. Inlined here (not promoted
// to a shared token) because no other surface uses an amber drop
// shadow; the trending card is the single consumer.
const TRENDING_SHADOW =
  "0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(251,191,36,0.10)";

// Top-reaction count uses amber-800 (`#92400e`) per mockup `:639`
// — slightly darker than `colors.trendingText` (`#b45309`,
// amber-700) used for the card title. Distinct enough to read as
// "this is the count, not the section header" without inventing a
// new global token.
const TOP_COUNT_COLOR = "#92400e";

interface Props {
  songs: TrendingSong[];
  /**
   * Empty-state message shown when no songs have any reactions
   * yet. Caller resolves via `getTranslations("Reaction")` →
   * `t("trendingEmpty")` so the locale-correct nudge ("아직 반응이
   * 없어요 — 세트리스트에서 반응을 추가해보세요!") renders.
   */
  emptyLabel?: string;
}

// Trending TOP3 card per shared-components-handoff §3-4 + the
// desktop mockup `event-page-desktop-mockup-v2.jsx:617-646`. Card
// always renders when mounted — the empty state nudges the user to
// engage rather than disappearing the surface entirely.
export function TrendingSongs({ songs, emptyLabel }: Props) {
  const t = useTranslations("Reaction");
  // Defensive slice: deriveTrendingSongs() already takes top 3, but the
  // medal-strip rendering depends on `MEDALS[i]` resolving — a future
  // caller passing more than 3 would render `undefined` past index 2.
  const rankedSongs = songs.slice(0, MEDALS.length);

  return (
    <section
      className="mb-6"
      style={{
        background: colors.trendingBg,
        border: `1px solid ${colors.trendingBorder}`,
        borderRadius: radius.card,
        // Mockup `:620` — `padding: "18px 24px"`.
        padding: "18px 24px",
        boxShadow: TRENDING_SHADOW,
      }}
    >
      <h3
        // Mockup `:623` — `fontSize: 13, fontWeight: 700`.
        style={{
          color: colors.trendingText,
          fontSize: 13,
          fontWeight: 700,
          margin: 0,
          marginBottom: 14,
        }}
      >
        {t("trending")}
      </h3>

      {rankedSongs.length === 0 ? (
        // Mockup `:626-629` — keep the card visible with a subtle
        // empty nudge. Operator-driven — disappearing the card on
        // events with zero reactions hides the surface that
        // explains how reactions work.
        <div
          style={{
            fontSize: 13,
            color: TOP_COUNT_COLOR,
            opacity: 0.45,
          }}
        >
          {emptyLabel ?? t("trendingEmpty")}
        </div>
      ) : (
        <ul
          // Mobile (default): column flex with `9px` row gap. Desktop
          // (≥ lg): row flex with 32px column gap (mockup `:631` —
          // `gap: 32` ≅ `lg:gap-8`).
          className="flex flex-col gap-y-[9px] lg:flex-row lg:gap-y-0 lg:gap-x-8"
          style={{ margin: 0, padding: 0, listStyle: "none" }}
        >
          {rankedSongs.map((song, i) => (
            <li
              key={song.setlistItemId}
              className="lg:flex-1 lg:min-w-0"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              {/* Medal — mockup `:634` `fontSize: 20`. */}
              <span
                aria-hidden="true"
                style={{ fontSize: 20, flexShrink: 0 }}
              >
                {MEDALS[i]}
              </span>
              {/* Two-line block: title on top, top-reaction count
                  below. Per mockup `:635-642`. */}
              <div style={{ minWidth: 0, flex: 1 }}>
                {/* Original-primary title block — same shape as
                    <SetlistRow>'s SongTitleBlock so the trending card
                    reads consistently with every other song listing
                    (event detail setlist, song detail header, member
                    /series detail history). main = originalTitle,
                    sub = localized title (muted, smaller weight),
                    variantLabel in parens. Truncate runs at the row
                    level so a long original + localized + variant
                    triple clips with ellipsis instead of wrapping. */}
                <div
                  className="truncate"
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: colors.textPrimary,
                  }}
                >
                  {song.mainTitle}
                  {song.subTitle && (
                    <span
                      className="ml-1"
                      style={{
                        fontWeight: 400,
                        color: colors.textMuted,
                      }}
                    >
                      {song.subTitle}
                    </span>
                  )}
                  {song.variantLabel && (
                    <span
                      className="ml-1"
                      style={{
                        fontSize: 11,
                        fontWeight: 400,
                        color: colors.textMuted,
                      }}
                    >
                      ({song.variantLabel})
                    </span>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    marginTop: 2,
                  }}
                >
                  <span style={{ fontSize: 14 }}>
                    {song.topReaction.emoji}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: TOP_COUNT_COLOR,
                    }}
                  >
                    {song.topReaction.count}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
