import type { CSSProperties } from "react";
import Link from "next/link";
import type { PublicLogo } from "@/lib/logoResolution";
import { SeriesLogo } from "./SeriesLogo";
import styles from "./seriesDetail.module.css";

/** A display string plus the language it is written in (`lang` attr). */
export type LangText = { text: string; lang: string };

export type SeriesMeta =
  | {
      kind: "artist";
      label: string;
      /** Locale-prefixed canonical path (`entityPath`). */
      href: string;
      name: LangText;
    }
  | { kind: "organizer"; label: string; name: LangText };

/*
 * Full-width identity panel of the series page (32-v1).
 *
 * Replaces the old sticky sidebar InfoCard: type badge, localized full
 * title with the original-language subtitle, representative artist (a
 * canonical link — the one navigation 32-v1 deliberately adds) or the
 * localized organizer for a multi-artist series, optional description,
 * and the four existing counters.
 *
 * Logo: the resolved `PublicLogo` from the cached series read. An image
 * renders above the title; typography (the default for every real
 * series today) renders the H1 alone. The source colour only tints the
 * 3px top edge.
 */
export function SeriesIdentity({
  logo,
  typeLabel,
  title,
  subtitle,
  meta,
  description,
  metrics,
}: {
  logo: PublicLogo;
  typeLabel: string;
  title: LangText;
  subtitle: LangText | null;
  meta: SeriesMeta | null;
  description: LangText | null;
  metrics: ReadonlyArray<{ label: string; value: string }>;
}) {
  const accent = logo.color
    ? ({ "--accent": logo.color } as CSSProperties)
    : undefined;
  return (
    <section
      className={styles.identity}
      style={accent}
      aria-labelledby="series-title"
    >
      {logo.image ? <SeriesLogo image={logo.image} /> : null}
      <div className={styles.titleBlock}>
        <span className={styles.badge}>{typeLabel}</span>
        <h1 id="series-title" className={styles.h1} lang={title.lang}>
          {title.text}
        </h1>
        {subtitle ? (
          <p className={styles.subtitle} lang={subtitle.lang}>
            {subtitle.text}
          </p>
        ) : null}
        {meta ? (
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>{meta.label}</span>
            {meta.kind === "artist" ? (
              <Link href={meta.href} lang={meta.name.lang}>
                {meta.name.text}
              </Link>
            ) : (
              <span className={styles.metaValue} lang={meta.name.lang}>
                {meta.name.text}
              </span>
            )}
          </div>
        ) : null}
        {description ? (
          <p className={styles.description} lang={description.lang}>
            {description.text}
          </p>
        ) : null}
      </div>
      <dl className={styles.metrics}>
        {metrics.map((m) => (
          <div key={m.label}>
            <dt>{m.label}</dt>
            <dd>{m.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
