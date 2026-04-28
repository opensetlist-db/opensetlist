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
  const startStr = formatDate(start, locale, options);
  const endStr = formatDate(end, locale, options);
  if (!startStr) return endStr;
  if (!endStr) return startStr;
  if (startStr === endStr) return startStr;
  return `${startStr} ~ ${endStr}`;
}
