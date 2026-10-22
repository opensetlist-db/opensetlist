/*
 * Date format of the series page (32-v1): numeric year, SHORT month,
 * numeric day, in UTC — "2026년 5월 1일" / "2026年5月1日" / "May 1, 2026".
 * ko and ja render the same as `HISTORY_ROW_DATE_FORMAT`; only English
 * differs (short month), which the approved captures use.
 *
 * Plain module (no "use client"): server components import the value.
 */
export const SERIES_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
};
