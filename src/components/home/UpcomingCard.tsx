"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import EventStatusTicker from "@/components/EventStatusTicker";
import { trackEvent } from "@/lib/analytics";
import { colors, radius } from "@/styles/tokens";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// Tick fast enough that minute-precision rendering stays visually
// honest (worst-case staleness ~30s). The "X minutes left" branch
// is what benefits — at hour granularity even a 5min tick would do.
const TICK_MS = 30 * 1000;

interface Props {
  /**
   * Event id (digit string) for the GA4 `home_upcoming_click`
   * event. Threaded explicitly rather than parsed from `href` at
   * runtime — the page builds the view objects from typed Prisma
   * rows, so passing the id is cheaper and matches the project's
   * "stringify before GA4" discipline (BigInt would throw on
   * serialization).
   */
  eventId: string;
  href: string;
  startTimeIso: string | null;
  seriesName: string | null;
  eventName: string;
  venue: string | null;
  formattedDate: string;
  dDayLabel: string;
  /**
   * D-7 open-window indicator: caller computes via
   * `shouldShowWishBadge(start, now)`, which mirrors
   * `isWishPredictOpen`'s strict 168h-before-startTime comparison.
   * When true the card grows a `🌸 세트리스트 예상 가능` badge next to
   * the D-day chip and swaps the resting border to
   * `colors.wishlistBorder` to draw the eye toward events the user
   * can engage with right now. Falsy default keeps non-home
   * consumers (if any future page mounts this card) byte-equivalent.
   */
  showWishBadge?: boolean;
  /**
   * Mobile horizontal scroll vs. desktop sidebar list. Mobile cards
   * are flex-shrink-0 with a fixed width inside the scroll container;
   * desktop cards stretch to fill the 340px sidebar column.
   */
  variant?: "scroll" | "stack";
}

export function UpcomingCard({
  eventId,
  href,
  startTimeIso,
  seriesName,
  eventName,
  venue,
  formattedDate,
  dDayLabel,
  showWishBadge = false,
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
    const interval = setInterval(compute, TICK_MS);
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
      onClick={() => {
        // GA4 Phase 1B: A/B-style attribution for the D-7 wish-open
        // badge. `badge_visible` reuses the same boolean that drives
        // the badge render (computed once server-side via
        // `shouldShowWishBadge`) so the param can never disagree
        // with what the user actually saw.
        trackEvent("home_upcoming_click", {
          event_id: eventId,
          badge_visible: !!showWishBadge,
        });
      }}
      className={[
        "block transition-colors",
        variant === "scroll" ? "w-[200px] flex-shrink-0" : "w-full",
      ].join(" ")}
      style={{
        background: active ? colors.primaryHoverBg : colors.bgCard,
        // Within D-7, swap the resting stroke to the wishlist-blue
        // border (`#b5d4f4`) so the card visually pairs with the
        // EventWishSection's title bar — same hue used inside the
        // event detail surface, signaling "this is the engagement
        // window". Outside D-7 the card uses the standard `border`.
        border: `1.5px solid ${
          showWishBadge ? colors.wishlistBorder : colors.border
        }`,
        borderRadius: radius.cardSm,
        padding: "14px 16px",
      }}
    >
      {/* D-day chip + formatted-date caption stay on row 1, both
          `whitespace-nowrap` so neither breaks. The wish-open chip
          (within D-7) drops to its own row 2 so it doesn't compete
          with the date for horizontal room — at the 200 px scroll
          variant width, putting it next to the D-day chip via
          flex-wrap pushed the caption into too little space and the
          date overflowed visually even with `whitespace-nowrap` on
          the span (PR #299 added the nowrap but couldn't fix the
          flex squeeze with a stretchy wish-badge sibling). */}
      <div className="mb-2 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span
            className="whitespace-nowrap text-[11px] font-bold"
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
            className="whitespace-nowrap text-[11px]"
            style={{ color: colors.textMuted }}
          >
            {formattedDate}
          </span>
        </div>
        {showWishBadge && (
          <span
            className="whitespace-nowrap self-start text-[11px] font-semibold"
            style={{
              color: colors.wishlistText,
              background: colors.wishlistBg,
              border: `1px solid ${colors.wishlistBorder}`,
              borderRadius: radius.badge,
              padding: "2px 8px",
            }}
          >
            🌸 {t("wishOpen")}
          </span>
        )}
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
