"use client";

import { useTranslations } from "next-intl";
import { REACTION_TYPES } from "@/lib/reactions";
import styles from "@/components/event/eventDetail.module.css";

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

/*
 * "이번 공연 화제의 곡" — top-3 reacted songs, above the setlist card.
 *
 * Look: the owner-approved trending-v1 supplement to consistency-03-v3
 * (wiki `handoffs/03/trending-v1`), which replaced the pre-redesign amber
 * strip the redesign packets had left out: a white-led card with a faint
 * amber wash, 3px amber top rule, navy 20/18px heading, a small
 * non-interactive "TOP 3" pill, three columns from a 1024px viewport and
 * one column below, the original title with the translation and the
 * variant each on their own line. Styles live in eventDetail.module.css
 * (`.trending*`) next to the other concert-detail panels.
 *
 * Behaviour is unchanged: the caller (<LiveSetlist>) decides visibility
 * (`status !== "upcoming" && songs.length > 0`) and the ranking / ties
 * come from `deriveTrendingSongs` or the SSR query. This component only
 * renders what it is handed, in that order.
 *
 * The empty branch is the component's own defensive fallback for a
 * caller that mounts it with no songs; the event page never does today,
 * but the contract stays so a future caller gets the nudge instead of a
 * bare heading.
 *
 * Accessibility: an <ol> carries the rank, so the medals are decorative
 * (aria-hidden) and so is the TOP 3 pill (the heading already names the
 * card). Each reaction count is one labelled image ("<type> <count>")
 * with the glyph and digits hidden, so assistive tech reads it once.
 * Nothing here is focusable — it is a display-only card.
 */
export function TrendingSongs({ songs, emptyLabel }: Props) {
  const t = useTranslations("Reaction");
  // Defensive slice: deriveTrendingSongs() already takes top 3, but the
  // medal rendering depends on `MEDALS[i]` resolving — a future caller
  // passing more than 3 would render `undefined` past index 2.
  const rankedSongs = songs.slice(0, MEDALS.length);

  return (
    <section
      aria-labelledby="trending-songs-title"
      className={styles.trending}
      data-testid="trending-songs"
    >
      <div className={styles.trendingHead}>
        <h2 id="trending-songs-title" className={styles.trendingTitle}>
          {t("trending")}
        </h2>
        {rankedSongs.length > 0 && (
          <span className={styles.trendingTop} aria-hidden="true">
            TOP 3
          </span>
        )}
      </div>

      {rankedSongs.length === 0 ? (
        <p className={styles.trendingEmpty}>
          {emptyLabel ?? t("trendingEmpty")}
        </p>
      ) : (
        <ol className={styles.trendingList}>
          {rankedSongs.map((song, i) => (
            <li key={song.setlistItemId} className={styles.trendingItem}>
              <span className={styles.trendingMedal} aria-hidden="true">
                {MEDALS[i]}
              </span>
              <div className={styles.trendingContent}>
                {/* Original title first; the localized title and the
                    variant each get their own muted line (trending-v1)
                    instead of the old single truncated line. The values
                    are the SSR / deriveTrendingSongs ones, built with the
                    same cascade as <SetlistRow>'s title block. */}
                <div className={styles.trendingOriginal}>{song.mainTitle}</div>
                {song.subTitle && (
                  <div className={styles.trendingSub}>{song.subTitle}</div>
                )}
                {song.variantLabel && (
                  <div className={styles.trendingSub}>
                    ({song.variantLabel})
                  </div>
                )}
                {/* REACTION_TYPES canonical order (waiting / best /
                    surprise / moved), positive counts only — upstream
                    already drops songs with no reactions at all. */}
                <div className={styles.trendingReactions}>
                  {REACTION_TYPES.filter(
                    ({ type }) => (song.reactionCounts[type] ?? 0) > 0,
                  ).map(({ type, emoji }) => {
                    const count = song.reactionCounts[type] ?? 0;
                    return (
                      <span
                        key={type}
                        role="img"
                        aria-label={`${t(type)} ${count}`}
                      >
                        <span aria-hidden="true">{emoji}</span>
                        <span aria-hidden="true">{count}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
