import Link from "next/link";
import { IdentityName, type IdentityNamePair } from "./IdentityName";
import styles from "./artistDetail.module.css";
import { accentStyle } from "./artistDetail";

/*
 * Sub-unit card on the artist detail overview (approved packet 20-v1).
 *
 * The whole card is one link to the unit's canonical page; the member
 * names inside are plain text (member links live in the members
 * section, so nesting them here would put links inside a link).
 *
 * Colour: the caller resolves `resolveUnitColor(unit)` — stored
 * `Artist.color`, else the deterministic slug palette — so the stripe
 * matches the unit's event-page setlist pill. The colour only paints
 * the stripe and a faint background wash; the name stays ink, because
 * the palette includes pastels (#FACC15, #FCD34D) that fail text
 * contrast on white.
 */

interface Props {
  href: string;
  name: IdentityNamePair;
  color: string;
  members: IdentityNamePair[];
}

export function UnitCard({ href, name, color, members }: Props) {
  return (
    <Link href={href} className={styles.unitCard} style={accentStyle(color)}>
      <span className={styles.unitTop}>
        <i className={styles.dot} aria-hidden="true" />
        <h3 className={styles.unitName}>
          <IdentityName name={name} />
        </h3>
        <span className={styles.arrow} aria-hidden="true">
          ›
        </span>
      </span>
      {members.length > 0 && (
        <ul className={styles.unitMembers}>
          {members.map((m, i) => (
            <li key={i}>
              <IdentityName name={m} />
            </li>
          ))}
        </ul>
      )}
    </Link>
  );
}
