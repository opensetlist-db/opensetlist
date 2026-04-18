export interface EventDateTimeOutput {
  venueDateLabel: string;
  viewerTimeLabel: string | null;
  viewerDateParens: string | null;
}

export interface EventDateTimeInput {
  date: string | Date | null | undefined;
  startTime: string | Date | null | undefined;
  locale: string;
  viewerTimeZone?: string;
}

type VenueYMD = { y: number; m: number; d: number };

function extractVenueYMD(
  date: string | Date | null | undefined,
): VenueYMD | null {
  if (!date) return null;
  if (typeof date === "string") {
    return {
      y: +date.slice(0, 4),
      m: +date.slice(5, 7),
      d: +date.slice(8, 10),
    };
  }
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
  };
}

function formatMonthName(y: number, m: number, d: number, style: "long" | "short"): string {
  return new Intl.DateTimeFormat("en-US", { month: style }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function formatVenueDate(
  date: string | Date | null | undefined,
  locale: string,
): string {
  const ymd = extractVenueYMD(date);
  if (!ymd) return "";
  const { y, m, d } = ymd;
  switch (locale) {
    case "ko":
      return `${y}년 ${m}월 ${d}일`;
    case "ja":
    case "zh-CN":
      return `${y}年${m}月${d}日`;
    case "en":
      return `${formatMonthName(y, m, d, "long")} ${d}, ${y}`;
    default:
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
}

export function formatEventDateTime(input: EventDateTimeInput): EventDateTimeOutput {
  const venueDateLabel = formatVenueDate(input.date, input.locale);
  if (!input.startTime) {
    return { venueDateLabel, viewerTimeLabel: null, viewerDateParens: null };
  }

  const tz =
    input.viewerTimeZone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const instant =
    typeof input.startTime === "string"
      ? new Date(input.startTime)
      : input.startTime;

  if (Number.isNaN(instant.getTime())) {
    return { venueDateLabel, viewerTimeLabel: null, viewerDateParens: null };
  }

  const timeParts = new Intl.DateTimeFormat(input.locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
    timeZoneName: "short",
  }).formatToParts(instant);
  const hour = timeParts.find((p) => p.type === "hour")?.value ?? "";
  const minute = timeParts.find((p) => p.type === "minute")?.value ?? "";
  const tzAbbr = timeParts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const viewerTimeLabel = `${hour}:${minute} ${tzAbbr}`;

  const venueYMD = extractVenueYMD(input.date);
  let viewerDateParens: string | null = null;
  if (venueYMD) {
    const viewerDateParts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: tz,
    }).formatToParts(instant);
    const vy = Number(
      viewerDateParts.find((p) => p.type === "year")?.value ?? 0,
    );
    const vm = Number(
      viewerDateParts.find((p) => p.type === "month")?.value ?? 0,
    );
    const vd = Number(
      viewerDateParts.find((p) => p.type === "day")?.value ?? 0,
    );
    if (vy !== venueYMD.y || vm !== venueYMD.m || vd !== venueYMD.d) {
      if (input.locale === "en") {
        viewerDateParens = `(${formatMonthName(vy, vm, vd, "short")} ${vd})`;
      } else {
        viewerDateParens = `(${vm}/${vd})`;
      }
    }
  }

  return { venueDateLabel, viewerTimeLabel, viewerDateParens };
}
