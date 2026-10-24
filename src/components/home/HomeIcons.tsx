import styles from "./home.module.css";

// Inline outline icons from the approved 14 mockup (search / map pin /
// chevron). Decorative: the surrounding text or aria-label names them.
// Home-prefixed so they are not mistaken for the concert list's
// `events/ChevronIcon`, which takes a className.

export function HomeSearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </svg>
  );
}

export function HomePinIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
      <circle cx="12" cy="10" r="2" />
    </svg>
  );
}

export function HomeChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}
