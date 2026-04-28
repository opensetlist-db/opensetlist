"use client";

import { useLocale } from "next-intl";
import { formatEventDateTime } from "@/lib/eventDateTime";
import { useMounted } from "@/hooks/useMounted";

interface Props {
  /**
   * Venue date — needed only to detect cross-day display (the
   * `viewerDateParens` output of `formatEventDateTime`). Pass the
   * same date the venue uses for its calendar; the component does
   * not render it.
   */
  date: Date | string | null;
  startTime: Date | string;
}

/**
 * Time-only render slice of `<EventDateTime>`. The icon-row sidebar
 * splits Date + Start into two separate rows (📅 / 🕐) so each row
 * needs its value as a single string — `<EventDateTime>`'s combined
 * `venueDate · localTime` shape would render an empty middot for the
 * Start row when wrapped with `date={null}`.
 *
 * Pre-mount renders in UTC (server-render parity); post-mount switches
 * to the viewer's local timezone via `useMounted`. Same client-island
 * pattern as `<EventDateTime>` itself.
 */
export function EventStartTime({ date, startTime }: Props) {
  const locale = useLocale();
  const mounted = useMounted();
  const f = formatEventDateTime({
    date,
    startTime,
    locale,
    viewerTimeZone: mounted ? undefined : "UTC",
  });
  if (!f.viewerTimeLabel) return null;
  return (
    <>
      {f.viewerTimeLabel}
      {f.viewerDateParens && ` ${f.viewerDateParens}`}
    </>
  );
}
