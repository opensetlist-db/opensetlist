import { formatDate } from "@/lib/utils";

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

/**
 * City-group date range with the 32-v1 en dash ("5월 1일 – 5월 2일").
 * Page-local on purpose: the shared `formatDateRange` keeps its "~" for
 * every other page (owner decision, 2026-10-22). Same rules otherwise:
 * two instants on the same UTC day render as one date, and a side that
 * formats to "" (invalid input) drops out instead of leaving a dangling
 * dash.
 */
export function formatSeriesDateRange(
  start: Date | string,
  end: Date | string,
  locale: string,
): string {
  const a = new Date(start);
  const b = new Date(end);
  if (
    !Number.isNaN(a.getTime()) &&
    !Number.isNaN(b.getTime()) &&
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  ) {
    return formatDate(a, locale, SERIES_DATE_FORMAT);
  }
  const from = formatDate(start, locale, SERIES_DATE_FORMAT);
  const to = formatDate(end, locale, SERIES_DATE_FORMAT);
  if (!from || !to || from === to) return from || to;
  return `${from} – ${to}`;
}
