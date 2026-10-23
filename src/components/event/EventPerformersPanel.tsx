"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { resolveUnitColor } from "@/lib/artistColor";
import { entityPath } from "@/lib/seo/entityUrl";
import type { PerformersCardItem, UnitsCardItem } from "@/lib/types/setlist";
import styles from "./eventDetail.module.css";

/*
 * Sidebar "출연진" panel (18-v3 `#roster`): group/unit chips, then the
 * performers as initial cards. Replaces the old separate units card and
 * performers pill card; the data is the same two lists
 * (`deriveSidebarUnitsAndPerformers` for a show with items,
 * `deriveLineupFromRoster` for the pre-show lineup), so the planned
 * roster vs performed-credits split of the old cards is unchanged — the
 * lineup variant only swaps the heading.
 *
 * Colours: a unit's resolved colour (`resolveUnitColor`, with its
 * deterministic palette fallback for colour-pending units) and a
 * performer's unit colour arrive as `--artist` and are only mixed into
 * backgrounds and borders; every label stays ink.
 *
 * Every card renders open in one grid (consistency-03-v3 §7.4): the
 * owner asked for the whole cast without a "더 보기" step, so the old
 * six-card cut and its <details> are gone. The list is exactly what the
 * derivation returned — no dedupe or re-sort happens here beyond the
 * host-then-guest split below, so a duplicate or a missing name is a
 * data question for the derivations, never something this panel hides.
 * Guests keep their order after the hosts and their "게스트" note.
 */

interface Props {
  locale: string;
  units: UnitsCardItem[];
  performers: PerformersCardItem[];
  /** Pre-show roster (planned lineup) instead of performed credits. */
  isLineup?: boolean;
}

function artistVar(color: string): CSSProperties {
  return { "--artist": color } as CSSProperties;
}

export function EventPerformersPanel({
  locale,
  units,
  performers,
  isLineup = false,
}: Props) {
  const t = useTranslations("Event");
  if (units.length === 0 && performers.length === 0) return null;

  const ordered = [
    ...performers.filter((p) => !p.isGuest),
    ...performers.filter((p) => p.isGuest),
  ];
  const guestLabel = t("guestLabel");

  const renderCard = (p: PerformersCardItem) => {
    const body = (
      <>
        <span aria-hidden="true" className={styles.initial}>
          {Array.from(p.name)[0] ?? ""}
        </span>
        <strong>{p.name}</strong>
        {p.isGuest && <span className={styles.memberNote}>{guestLabel}</span>}
      </>
    );
    return (
      <li key={p.id} className={styles.member} style={artistVar(p.color)}>
        {p.slug ? (
          <Link href={entityPath("members", locale, p.id, p.slug)}>{body}</Link>
        ) : (
          body
        )}
      </li>
    );
  };

  return (
    <section
      id="event-performers"
      aria-labelledby="event-performers-title"
      className={`${styles.panel} ${styles.performersPanel}`}
    >
      <div className={styles.panelHead}>
        <h2 id="event-performers-title" className={styles.panelTitle}>
          {isLineup ? t("lineupPerformersLabel") : t("performersLabel")}
        </h2>
        {ordered.length > 0 && (
          <span className={styles.panelCount}>{ordered.length}</span>
        )}
      </div>
      {units.length > 0 && (
        <ul
          className={styles.groupLine}
          aria-label={isLineup ? t("lineupUnitsLabel") : t("unitsLabel")}
        >
          {units.map((unit) => (
            <li key={unit.id}>
              <Link
                href={entityPath("artists", locale, unit.id, unit.slug)}
                className={styles.groupChip}
                style={artistVar(resolveUnitColor(unit))}
                // The unit's performing members, as the old units card
                // listed them under each row; kept as the chip's hint.
                title={unit.members.length > 0 ? unit.members.join(" · ") : undefined}
              >
                {unit.name}
                {unit.isGuest && (
                  <span className={styles.groupChipMuted}>· {guestLabel}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {ordered.length > 0 && (
        <ul className={styles.rosterGrid}>{ordered.map(renderCard)}</ul>
      )}
    </section>
  );
}
