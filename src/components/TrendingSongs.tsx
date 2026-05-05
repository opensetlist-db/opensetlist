"use client";

import { useTranslations } from "next-intl";
import { REACTION_TYPES } from "@/lib/reactions";
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
  /** Per-reaction-type counts, indexed by Prisma `ReactionType` value
   *  ("waiting" | "best" | "surprise" | "moved"). Missing keys mean
   *  zero — the renderer iterates `REACTION_TYPES` so display order is
   *  stable regardless of which keys happen to be present. Replaced
   *  the earlier `topReaction` (single max-emotion projection) after
   *  Day-1 surfaced F17: the widget under-displayed total engagement
   *  because `max-single ≪ aggregate` once per-type counts grew past
   *  rehearsal-scale single digits. The strip below mirrors the
   *  per-row reaction display in `<ReactionButtons>` so the trending
   *  card reads consistently with the rest of the page. */
  reactionCounts: Record<string, number>;
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
                {/* All four reaction-type counts in REACTION_TYPES
                    canonical order (waiting / best / surprise / moved).
                    Mirrors `<ReactionButtons>`'s per-row strip so the
                    trending card reads consistently with the per-row
                    reaction display below it. Zero counts render as an
                    empty string (same convention as ReactionButtons:473)
                    so the strip stays visually quiet for unused types
                    while keeping the slot's width reserved. The
                    aggregate `= N` at the end names the ranking
                    criterion — the card is "TOP 3 by total reactions",
                    and four small per-type counts on their own don't
                    make that obvious. `=` and digits are i18n-neutral
                    math notation, so no translation key is needed.

                    Each per-type wrapper carries `role="img"` plus an
                    `aria-label` of "<localized type> <count>" so screen
                    readers announce the strip as four discrete
                    type-aware data points instead of bare digits. The
                    emoji glyph and count digit inside are `aria-hidden`
                    — without that the AT would announce both the
                    aria-label AND the inner content (double-read). The
                    label reuses `t(type)` (the same Reaction-namespace
                    key the per-row buttons use as their accessible name
                    in `ReactionButton:405`), so labels stay translated
                    in lockstep with the per-row UI. The total is
                    `aria-hidden` because the four per-type counts
                    already carry the full information; the visible
                    "= N" is sighted-only sugar that names the ranking
                    criterion. */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 2,
                  }}
                >
                  {REACTION_TYPES.map(({ type, emoji }) => {
                    const count = song.reactionCounts[type] ?? 0;
                    return (
                      <span
                        key={type}
                        role="img"
                        aria-label={`${t(type)} ${count}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 3,
                        }}
                      >
                        <span
                          style={{ fontSize: 14 }}
                          aria-hidden="true"
                        >
                          {emoji}
                        </span>
                        <span
                          className="tabular-nums"
                          aria-hidden="true"
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: TOP_COUNT_COLOR,
                            minWidth: 10,
                          }}
                        >
                          {count > 0 ? count : ""}
                        </span>
                      </span>
                    );
                  })}
                  <span
                    className="tabular-nums"
                    aria-hidden="true"
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: TOP_COUNT_COLOR,
                      opacity: 0.7,
                      marginLeft: 4,
                    }}
                  >
                    {`= ${song.totalReactions}`}
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
