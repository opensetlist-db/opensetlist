/*
 * Date format for the Album detail page (22-v1: "Mar 29, 2023" /
 * "2023年3月29日" / "2023년 3월 29일" — short month).
 *
 * `timeZone: "UTC"` is required: release dates and event dates are
 * stored as UTC midnights, and formatting in the server's local zone
 * printed the previous day on any host west of UTC (a local build
 * showed Dream Believers as 2023-03-28). CLAUDE.md "Date & Time".
 *
 * A plain module, not exported from a "use client" file, so server
 * components read the real object at SSR.
 */
export const ALBUM_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
};
