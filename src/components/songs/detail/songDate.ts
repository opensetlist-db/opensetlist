/*
 * Date format for the Song detail history rows (28-v1: "May 24, 2026" /
 * "2026年5月24日" / "2026년 5월 24일" — short month, like the album page).
 *
 * `timeZone: "UTC"` is required: event dates are stored as UTC
 * midnights, and formatting in the server's local zone would print the
 * previous day on any host west of UTC. CLAUDE.md "Date & Time".
 *
 * A plain module, not exported from a "use client" file, so server
 * components read the real object at SSR.
 */
export const SONG_HISTORY_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
};

/** UTC calendar year of a stored date (ISO string or Date), or null. */
export function utcYear(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  const year = d.getUTCFullYear();
  return Number.isNaN(year) ? null : year;
}
