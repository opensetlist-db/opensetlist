import Link from "next/link";
import styles from "./artistDetail.module.css";
import { type LocalizedText, accentStyle, firstGrapheme } from "./artistDetail";

/*
 * Member entry on the artist detail overview (approved packet 20-v1):
 * a 40px initial circle ringed in the member's colour, the full name,
 * and the owning unit's name underneath.
 *
 * No portrait: members have no managed photos, and the redesign
 * deliberately does not add photo management. The initial is drawn in
 * ink on a faint wash of the colour (not in the colour itself) so a
 * pastel unit colour never carries text.
 *
 * Server component — the hover/focus wash is plain CSS now, so the old
 * client-side hover state is gone.
 */

interface Props {
  href: string;
  name: LocalizedText;
  /** Initial source (locale short-name cascade); falls back to `name`. */
  avatarLabel?: LocalizedText | null;
  /** Owning unit, or null when the member belongs to no sub-unit. */
  unitName: LocalizedText | null;
  /** Page resolves: owning unit colour → stage-identity colour → muted. */
  color: string;
}

export function MemberChip({ href, name, avatarLabel, unitName, color }: Props) {
  const initialSource = avatarLabel?.text ? avatarLabel : name;
  return (
    <Link href={href} className={styles.member} style={accentStyle(color)}>
      <span
        className={styles.initial}
        aria-hidden="true"
        lang={initialSource.lang}
      >
        {firstGrapheme(initialSource.text)}
      </span>
      <span className={styles.memberCopy}>
        <span className={styles.memberName} lang={name.lang}>
          {name.text}
        </span>
        {unitName && (
          <span className={styles.memberUnit} lang={unitName.lang}>
            {unitName.text}
          </span>
        )}
      </span>
    </Link>
  );
}
