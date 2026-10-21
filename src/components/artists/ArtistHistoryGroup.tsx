"use client";

import { useId, useState, type ReactNode } from "react";
import styles from "./artistDetail.module.css";

/*
 * One series group on the artist history tab (approved packet 20-v1).
 * Groups start expanded; the header button collapses one group at a
 * time. The group title is plain text inside the button — series pages
 * are reachable from the event rows, and a link nested in a toggle
 * button would be invalid interactive content.
 *
 * Rows arrive pre-rendered from the server page (`children`) so this
 * client island carries only the open/closed state.
 */

interface Props {
  title: string;
  titleLang?: string;
  /** Pre-formatted "N concerts" label. */
  countLabel: string;
  /** LIVE label when the group contains an ongoing event, else null. */
  liveLabel: string | null;
  columns: { dateStatus: string; event: string; songs: string };
  children: ReactNode;
}

export function ArtistHistoryGroup({
  title,
  titleLang,
  countLabel,
  liveLabel,
  columns,
  children,
}: Props) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  return (
    <section className={styles.historyGroup}>
      <h3 className={styles.groupHeading}>
        <button
          type="button"
          className={styles.groupToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={styles.groupName} lang={titleLang}>
            {title}
          </span>
          <span className={styles.groupCount}>
            {liveLabel && (
              <span className={styles.status} data-status="ongoing">
                {liveLabel}
              </span>
            )}
            {countLabel}
            <span aria-hidden="true">⌄</span>
          </span>
        </button>
      </h3>
      <div id={bodyId} className={styles.groupBody} hidden={!open}>
        {/* Visual column labels only; each row's cells already read in
            this order, so the strip is hidden from assistive tech
            rather than faking table semantics. */}
        <div className={styles.historyColumns} aria-hidden="true">
          <span>{columns.dateStatus}</span>
          <span>{columns.event}</span>
          <span>{columns.songs}</span>
          <span />
        </div>
        {children}
      </div>
    </section>
  );
}
