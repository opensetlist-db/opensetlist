"use client";

import { useId, useState, type ReactNode } from "react";
import styles from "./artistDetail.module.css";

/*
 * Main / other unit split on the artist detail overview.
 *
 * Only main units (`Artist.isMainUnit = true`) show by default
 * (operator preference, 2026-04-28) so a tour-heavy parent like 蓮ノ空
 * doesn't bury its canonical units under every event-specific
 * configuration. The rest sit in a second grid behind a disclosure
 * button placed between the two grids (20-v1 order: main grid →
 * button → other grid), so opening it grows the list downward from
 * where the user's focus already is.
 */

interface Props {
  mainCards: ReactNode[];
  otherCards: ReactNode[];
  showLabel: string;
  hideLabel: string;
}

export function UnitsToggle({
  mainCards,
  otherCards,
  showLabel,
  hideLabel,
}: Props) {
  const [showOthers, setShowOthers] = useState(false);
  const hasOthers = otherCards.length > 0;
  // `useId` pairs the button with its region for `aria-controls`.
  const otherCardsId = useId();
  return (
    <>
      {mainCards.length > 0 && (
        <ul className={`${styles.list} ${styles.unitGrid}`}>
          {mainCards.map((card, i) => (
            <li key={i}>{card}</li>
          ))}
        </ul>
      )}
      {hasOthers && (
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={showOthers}
          aria-controls={otherCardsId}
          onClick={() => setShowOthers((v) => !v)}
        >
          {showOthers ? hideLabel : showLabel}
        </button>
      )}
      {hasOthers && (
        // `hidden` (not CSS display) keeps the region in the DOM at a
        // stable id, so `aria-controls` always resolves.
        <ul
          id={otherCardsId}
          hidden={!showOthers}
          className={`${styles.list} ${styles.unitGrid} ${styles.otherUnits}`}
        >
          {otherCards.map((card, i) => (
            <li key={i}>{card}</li>
          ))}
        </ul>
      )}
    </>
  );
}
