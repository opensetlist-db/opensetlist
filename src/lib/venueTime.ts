/**
 * Venue-local rendering of an event's UTC `startTime`.
 *
 * We don't store a venue timezone — only `Event.country`. Every country
 * we currently list events in observes a single, DST-free offset, so a
 * fixed table is exact (and keeps SSR output deterministic: no
 * dependence on the server's ICU tz database or its `TZ`). A country
 * with DST or several zones (US, AU, …) deliberately isn't listed;
 * those fall back to UTC, which is correct-if-unfriendly rather than
 * silently wrong by an hour.
 *
 * Two consumers:
 *   - the pre-show empty-setlist copy (「11月14日 16:30（JST）開演」),
 *     which must read in venue time — that's what tickets and official
 *     announcements use, and the viewer-local time is already shown in
 *     the header card;
 *   - the `MusicEvent` JSON-LD `startDate`, where Google prefers an
 *     explicit offset (`+09:00`) over `Z`.
 */

interface VenueZone {
  /** Minutes east of UTC. */
  offsetMinutes: number;
  /** Abbreviation shown next to the time, same in every UI locale. */
  label: string;
}

const VENUE_ZONES: Record<string, VenueZone> = {
  JP: { offsetMinutes: 9 * 60, label: "JST" },
  KR: { offsetMinutes: 9 * 60, label: "KST" },
  TW: { offsetMinutes: 8 * 60, label: "CST" },
  CN: { offsetMinutes: 8 * 60, label: "CST" },
  HK: { offsetMinutes: 8 * 60, label: "HKT" },
  SG: { offsetMinutes: 8 * 60, label: "SGT" },
  TH: { offsetMinutes: 7 * 60, label: "ICT" },
};

const UTC_ZONE: VenueZone = { offsetMinutes: 0, label: "UTC" };

function venueZone(country: string | null | undefined): VenueZone {
  return (country && VENUE_ZONES[country.toUpperCase()]) || UTC_ZONE;
}

function toInstant(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Wall-clock parts of `instant` at the venue. Shifting the epoch by the
 * offset and then reading the `getUTC*` fields is the standard
 * fixed-offset trick — it never touches the process's local timezone.
 */
function venueParts(instant: Date, zone: VenueZone) {
  const shifted = new Date(instant.getTime() + zone.offsetMinutes * 60_000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    hh: shifted.getUTCHours(),
    mm: shifted.getUTCMinutes(),
    ss: shifted.getUTCSeconds(),
  };
}

/**
 * ISO-8601 with the venue's offset, e.g. `2026-11-14T16:30:00+09:00`.
 * Falls back to `…Z` (UTC) for countries not in the table. Null for a
 * missing/unparseable input.
 */
export function venueIsoString(
  startTime: Date | string | null | undefined,
  country: string | null | undefined,
): string | null {
  const instant = toInstant(startTime);
  if (!instant) return null;
  const zone = venueZone(country);
  const p = venueParts(instant, zone);
  const date = `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
  const time = `${pad2(p.hh)}:${pad2(p.mm)}:${pad2(p.ss)}`;
  if (zone.offsetMinutes === 0) return `${date}T${time}Z`;
  const sign = zone.offsetMinutes > 0 ? "+" : "-";
  const abs = Math.abs(zone.offsetMinutes);
  return `${date}T${time}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/**
 * Locale-formatted venue-local month/day + 24h time + zone label, as
 * separate pieces so the i18n message owns word order and punctuation:
 * `{ date: "11月14日", time: "16:30", zone: "JST" }`. Year omitted —
 * the copy is only shown for upcoming events, and the header card
 * already carries the full date.
 */
export function formatVenueStart(
  startTime: Date | string | null | undefined,
  country: string | null | undefined,
  locale: string,
): { date: string; time: string; zone: string } | null {
  const instant = toInstant(startTime);
  if (!instant) return null;
  const zone = venueZone(country);
  const p = venueParts(instant, zone);
  let date: string;
  switch (locale) {
    case "ko":
      date = `${p.m}월 ${p.d}일`;
      break;
    case "ja":
    case "zh-CN":
      date = `${p.m}月${p.d}日`;
      break;
    default:
      // en (and any future Latin-script locale): "November 14". Built
      // from a UTC-pinned Date so the month name can't shift.
      date = `${new Intl.DateTimeFormat("en-US", {
        month: "long",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(p.y, p.m - 1, p.d)))} ${p.d}`;
  }
  return { date, time: `${pad2(p.hh)}:${pad2(p.mm)}`, zone: zone.label };
}
