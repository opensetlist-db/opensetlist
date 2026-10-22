import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { entityPath } from "@/lib/seo/entityUrl";
import styles from "./songDetail.module.css";

/*
 * Variations tab of the Song detail page (28-v1): the base song and
 * every live sibling version, each with its own performance count.
 *
 * - Titles wrap (no ellipsis); the locale translation is a small second
 *   line when it differs from the original.
 * - The variant label is a pill; the base song without a label shows the
 *   "기본" chip; the current song shows "현재", is highlighted and is not
 *   a link (`aria-current="page"`).
 * - Other versions link to their own canonical URL WITHOUT `?tab=` —
 *   opening a version lands on its default history tab, as before.
 */

export interface SongVersionView {
  id: string;
  slug: string;
  title: string;
  sub: string | null;
  variantLabel: string | null;
  isBase: boolean;
  isCurrent: boolean;
  performanceCount: number;
}

export async function SongVersionsPanel({
  versions,
  locale,
}: {
  versions: SongVersionView[];
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: "Song" });

  return (
    <section className={styles.panel} aria-labelledby="song-versions-heading">
      <div className={styles.panelHead}>
        <h2 id="song-versions-heading">{t("otherVersions")}</h2>
        <span className={styles.count}>{versions.length}</span>
      </div>
      <ul className={styles.versionList}>
        {versions.map((v) => {
          const inner = (
            <>
              <span className={styles.versionCopy}>
                <strong>{v.title}</strong>
                {v.sub ? <small>{v.sub}</small> : null}
                <span className={styles.pills}>
                  {v.variantLabel ? (
                    <span className={styles.variantPill}>{v.variantLabel}</span>
                  ) : v.isBase ? (
                    <span className={styles.chip}>{t("baseVariant")}</span>
                  ) : null}
                  {v.isCurrent ? (
                    <span className={styles.chip}>{t("currentVariant")}</span>
                  ) : null}
                </span>
              </span>
              <span className={styles.versionCount}>
                {t("performanceCount", { count: v.performanceCount })}
              </span>
              <span aria-hidden="true">{v.isCurrent ? "" : "›"}</span>
            </>
          );
          return (
            <li key={v.id} className={v.isCurrent ? styles.currentVersion : undefined}>
              {v.isCurrent ? (
                <div className={styles.versionRow} aria-current="page">
                  {inner}
                </div>
              ) : (
                <Link
                  href={entityPath("songs", locale, v.id, v.slug)}
                  className={styles.versionRow}
                >
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
