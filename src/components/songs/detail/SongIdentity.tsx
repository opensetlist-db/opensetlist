import type { CSSProperties } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { entityPath, type EntityId } from "@/lib/seo/entityUrl";
import { colors } from "@/styles/tokens";
import styles from "./songDetail.module.css";

/*
 * Identity card of the Song detail page (approved 28-v1). Full width,
 * typography-led — no song artwork exists, so there is no cover square.
 *
 * Content rules carried over from the pre-redesign sidebar card:
 *   - Title: original title leads; the locale translation is the
 *     subtitle only when it exists and differs (`displayOriginalTitle`).
 *     The variant label (locale translation → original) is its own pill.
 *   - Artist: the `primary` credit, else the first credit; one link, no
 *     new all-credits section. No credit → a plain "곡" kind badge.
 *   - Meta: song release year (UTC), and the earliest vocal album's type
 *     and title.
 *   - Stats: exact performance count of THIS song id (uncapped), and the
 *     number of distinct series within the fetched history.
 *
 * New in 28-v1: a variant links straight to its original song next to
 * the variant pill (the same relation the variations tab already
 * exposes).
 */

export interface SongIdentityProps {
  locale: string;
  title: { main: string; sub: string | null; variant: string | null };
  artist: { id: EntityId; slug: string; name: string; color: string | null } | null;
  base: { id: EntityId; slug: string; title: string } | null;
  releaseYear: number | null;
  firstAlbum: { title: string; typeLabel: string } | null;
  performanceCount: number;
  seriesCount: number;
}

// The top border is decorative, so a malformed operator colour falls
// back to the neutral control border instead of producing invalid CSS.
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

export async function SongIdentity({
  locale,
  title,
  artist,
  base,
  releaseYear,
  firstAlbum,
  performanceCount,
  seriesCount,
}: SongIdentityProps) {
  const t = await getTranslations({ locale, namespace: "Song" });
  const accent =
    artist?.color && HEX_COLOUR.test(artist.color)
      ? artist.color
      : colors.borderStrong;

  return (
    <section
      className={styles.identity}
      aria-labelledby="song-title"
      style={{ "--artist-color": accent } as CSSProperties}
    >
      <div className={styles.info}>
        {artist ? (
          <Link
            href={entityPath("artists", locale, artist.id, artist.slug)}
            className={styles.artistBadge}
          >
            {artist.name} <span aria-hidden="true">›</span>
          </Link>
        ) : (
          <span className={styles.kindBadge}>{t("kindBadge")}</span>
        )}
        <h1 id="song-title" className={styles.h1}>
          {title.main}
        </h1>
        {title.sub ? <p className={styles.subtitle}>{title.sub}</p> : null}
        {title.variant ? (
          <div className={styles.version}>
            <span className={styles.variantPill}>{title.variant}</span>
            {base ? (
              <Link
                href={entityPath("songs", locale, base.id, base.slug)}
                className={styles.baseLink}
              >
                {t("baseVersion")} · {base.title}{" "}
                <span aria-hidden="true">↗</span>
              </Link>
            ) : null}
          </div>
        ) : null}
        {releaseYear !== null || firstAlbum ? (
          <dl className={styles.meta}>
            {releaseYear !== null ? (
              <div>
                <dt>{t("releaseYearLabel")}</dt>
                <dd>{releaseYear}</dd>
              </div>
            ) : null}
            {firstAlbum ? (
              <>
                <div>
                  <dt>{t("albumTypeLabel")}</dt>
                  <dd>{firstAlbum.typeLabel}</dd>
                </div>
                <div>
                  <dt>{t("albumLabel")}</dt>
                  <dd>{firstAlbum.title}</dd>
                </div>
              </>
            ) : null}
          </dl>
        ) : null}
      </div>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <strong>{performanceCount}</strong>
          <span>{t("statsPerformances")}</span>
        </div>
        <div className={styles.stat}>
          <strong>{seriesCount}</strong>
          <span>{t("statsTours")}</span>
        </div>
      </div>
    </section>
  );
}
