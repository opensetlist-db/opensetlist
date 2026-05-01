"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import EventStatusTicker from "@/components/EventStatusTicker";
import { colors, radius } from "@/styles/tokens";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

interface Props {
  href: string;
  startTimeIso: string | null;
  seriesName: string | null;
  eventName: string;
  venue: string | null;
  formattedDate: string;
  dDayLabel: string;
  /**
   * Mobile horizontal scroll vs. desktop sidebar list. Mobile cards
   * are flex-shrink-0 with a fixed width inside the scroll container;
   * desktop cards stretch to fill the 340px sidebar column.
   */
  variant?: "scroll" | "stack";
}

export function UpcomingCard({
  href,
  startTimeIso,
  seriesName,
  eventName,
  venue,
  formattedDate,
  dDayLabel,
  variant = "stack",
}: Props) {
  // Hover/focus via React state (not a Tailwind arbitrary
  // `hover:bg-[#...]`) so the bg color reads from `colors.primaryHoverBg`
  // and a token change propagates here automatically. Focus handlers
  // mirror hover so keyboard-only navigation gets the same card
  // highlight that mouse users see.
  const [active, setActive] = useState(false);

  // When the event is less than a day away, swap the server's `D-N`
  // label for a live "X hours/minutes left" countdown. The server
  // bucketed by UTC day boundary, so D-0 covers anything from a
  // few minutes to ~23h59m — too coarse to be useful at this range.
  // Initial state stays `null` so SSR + first client render emit the
  // server-supplied `dDayLabel` (no hydration mismatch); the effect
  // refines it after mount and ticks every 30s for minute precision.
  const t = useTranslations("Home");
  const [liveLabel, setLiveLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!startTimeIso) return;
    const startMs = new Date(startTimeIso).getTime();
    if (Number.isNaN(startMs)) return;

    const compute = () => {
      const diffMs = startMs - Date.now();
      if (diffMs <= 0 || diffMs >= DAY_MS) {
        setLiveLabel(null);
        return;
      }
      if (diffMs >= HOUR_MS) {
        setLiveLabel(
          t("hoursLeft", { hours: Math.floor(diffMs / HOUR_MS) })
        );
      } else {
        // Floor would render "0 minutes left" in the final 60s; clamp
        // to 1 so the badge keeps counting down until the ticker flips
        // the card into ongoing state at startMs.
        setLiveLabel(
          t("minutesLeft", {
            minutes: Math.max(1, Math.floor(diffMs / MINUTE_MS)),
          })
        );
      }
    };

    compute();
    const interval = setInterval(compute, 30 * 1000);
    return () => clearInterval(interval);
  }, [startTimeIso, t]);

  const displayedLabel = liveLabel ?? dDayLabel;
  return (
    <Link
      href={href}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      className={[
        "block transition-colors",
        variant === "scroll" ? "w-[200px] flex-shrink-0" : "w-full",
      ].join(" ")}
      style={{
        background: active ? colors.primaryHoverBg : colors.bgCard,
        border: `1.5px solid ${colors.border}`,
        borderRadius: radius.cardSm,
        padding: "14px 16px",
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <span
          className="text-[11px] font-bold"
          style={{
            color: colors.upcoming,
            background: colors.upcomingBg,
            border: `1px solid ${colors.upcomingBorder}`,
            borderRadius: radius.badge,
            padding: "2px 8px",
          }}
        >
          {displayedLabel}
        </span>
        <span
          className="text-[11px]"
          style={{ color: colors.textMuted }}
        >
          {formattedDate}
        </span>
      </div>
      {seriesName && (
        <div
          className="mb-1 text-[11px] font-semibold"
          style={{ color: colors.primary }}
        >
          {seriesName}
        </div>
      )}
      <div
        className="text-[13px] font-bold"
        style={{ color: colors.textPrimary, lineHeight: 1.4 }}
      >
        {eventName}
      </div>
      {venue && (
        <div
          className="mt-1.5 text-[11px]"
          style={{ color: colors.textMuted }}
        >
          📍 {venue}
        </div>
      )}
      <EventStatusTicker startTime={startTimeIso} />
    </Link>
  );
}
