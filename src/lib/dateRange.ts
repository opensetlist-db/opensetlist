import { formatDate } from "@/lib/utils";

/**
 * Format an inclusive date range. Same-day → single date; spanning →
 * `${start} ~ ${end}`. Each side is rendered via `formatDate(date,
 * locale, options)` so the locale + timeZone behavior matches every
 * other date in the app.
 *
 * Same-day comparison uses UTC-day equality (per CLAUDE.md): two
 * timestamps that fall on the same UTC date should render as a
 * single value even if their hour/minute differ. The default
 * `formatDate` options render `{year, month, day}` which already
 * collapses to one string per UTC day; we additionally short-circuit
 * the spanning concatenation when the rendered strings would match.
 */
export function formatDateRange(
  start: Date | string,
  end: Date | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  // UTC-day equality first. The string-equality check below collapses
  // same-day ranges only when the rendered output happens to match —
  // safe for the default `{year, month, day}` options, but a caller
  // who passes `hour`/`minute` could see two distinct strings for two
  // timestamps on the same UTC day. Comparing UTC date parts up front
  // keeps the contract consistent regardless of `options`.
  const startDate = typeof start === "string" ? new Date(start) : start;
  const endDate = typeof end === "string" ? new Date(end) : end;
  if (
    !Number.isNaN(startDate.getTime()) &&
    !Number.isNaN(endDate.getTime()) &&
    startDate.getUTCFullYear() === endDate.getUTCFullYear() &&
    startDate.getUTCMonth() === endDate.getUTCMonth() &&
    startDate.getUTCDate() === endDate.getUTCDate()
  ) {
    return formatDate(startDate, locale, options);
  }
  const startStr = formatDate(start, locale, options);
  const endStr = formatDate(end, locale, options);
  if (!startStr) return endStr;
  if (!endStr) return startStr;
  if (startStr === endStr) return startStr;
  return `${startStr} ~ ${endStr}`;
}
