import type { ResolvedEventStatus } from "@/lib/eventStatus";

/**
 * D-7 open window for wishlist + predicted-setlist surfaces.
 *
 * Source: `raw/20260503-1b-1c-timeline.md` §"희망곡/예상곡 표시 조건
 * (시스템)". The 7-day window aligns with the operator's SNS cadence
 * (D-7 announcement → D-3 reminder → D-1 closing-soon → D+0 lock →
 * D+1 result share); fans get a focused engagement window rather
 * than weeks of empty-list-staring (reduces "I'll do it later"
 * deferral psychology).
 *
 * Per-event override is a Phase 2+ concern — single global constant
 * for now.
 */
export const WISH_PREDICT_OPEN_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Exported so unit tests pin the boundary against the same constant the
// gate uses, instead of re-deriving the formula locally and silently
// diverging if WISH_PREDICT_OPEN_DAYS or the day length ever changes.
export const OPEN_WINDOW_MS = WISH_PREDICT_OPEN_DAYS * MS_PER_DAY;

/**
 * UTC-midnight floor of the given instant. Anchoring on UTC (not
 * local-time `setHours(0,0,0,0)`) keeps day-bucket boundaries stable
 * across regions — a Vercel edge running in `Asia/Seoul` would
 * otherwise classify the same stored UTC instant differently from a
 * developer laptop in `America/New_York`. CLAUDE.md "Date & Time"
 * section makes this rule project-wide.
 */
export function utcDayStart(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/**
 * UTC day at `now + days`. Same UTC-anchoring rationale as
 * `utcDayStart` — needed so the home page's 30-day Upcoming window
 * has stable edges regardless of the server's running time-of-day.
 */
export function utcDayOffset(d: Date, days: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days),
  );
}

/**
 * Whole UTC days from `now`'s UTC-day-start to `target`'s UTC-day-
 * start (positive = future, negative = past, 0 = same UTC day).
 * Rounds against millisecond drift so DST or leap-second weirdness
 * can't smear an integer day into a 0.999... result.
 */
export function daysUntilUTC(target: Date, now: Date): number {
  const diff = utcDayStart(target).getTime() - utcDayStart(now).getTime();
  return Math.round(diff / MS_PER_DAY);
}

/**
 * D-7 visibility gate for wishlist + predicted-setlist surfaces.
 *
 * Returns true iff:
 *   - the event is `upcoming` (DB `scheduled` AND `now < startTime`,
 *     resolved by `getEventStatus`), AND
 *   - the start is within `WISH_PREDICT_OPEN_DAYS × 24h`
 *     (exactly 168 hours) from `now`.
 *
 * Comparison is in absolute milliseconds, NOT UTC-day-boundary days.
 * The earlier UTC-day-distance implementation opened the gate at UTC
 * midnight of the calendar day 7 before the event's UTC day — up to
 * ~24 hours BEFORE the exact 168h mark, surprising operators who
 * read "D-7" as "exactly 7×24h before startTime". A 7d 2h 43min
 * remaining state now correctly reports the gate as closed.
 *
 * The lock-at-startTime is enforced separately by `event.status`
 * flipping `scheduled → ongoing` (auto-status-flip ticker); this
 * helper governs the open-window-only side. Post-show (status !==
 * "upcoming"), this returns false — callers fall through to
 * existing post-show display rules.
 *
 * Snap-frozen at SSR by design: computed once with the server's
 * `now` and threaded as a boolean prop. A page kept open across the
 * 168h-mark boundary won't auto-unlock — refresh does.
 */
export function isWishPredictOpen(
  event: { startTime: Date | string | null; status: ResolvedEventStatus },
  now: Date = new Date(),
): boolean {
  if (event.status !== "upcoming") return false;
  if (!event.startTime) return false;
  const start =
    event.startTime instanceof Date
      ? event.startTime
      : new Date(event.startTime);
  if (Number.isNaN(start.getTime())) return false;
  // Strict-future check doubles as the "gate closes at startTime"
  // upper bound. CR #282 also caught a stale `status: "upcoming"` +
  // past-startTime edge when the auto-status ticker lags behind real
  // time — explicit guard keeps that path closed.
  const msUntilStart = start.getTime() - now.getTime();
  if (msUntilStart <= 0) return false;
  return msUntilStart <= OPEN_WINDOW_MS;
}

/**
 * Home-page Upcoming-card badge condition. Mirrors the gate exactly so
 * the badge can never appear on a card whose detail-page gate is
 * closed (and vice versa). Operator-confusing drift between the two
 * surfaces was the original bug that prompted this rewrite.
 *
 * Takes `start` + `now` (not pre-computed `daysUntil`) because the
 * gate is millisecond-precise — calendar-day distance would
 * re-introduce the same up-to-24h early-open behavior the gate just
 * stopped doing.
 *
 * Caller (home-page Upcoming query) already filters
 * `startTime: { gt: now }`, so past-start events can't reach this
 * helper — the strict-future check is belt-and-suspenders.
 */
export function shouldShowWishBadge(start: Date, now: Date): boolean {
  const msUntilStart = start.getTime() - now.getTime();
  if (msUntilStart <= 0) return false;
  return msUntilStart <= OPEN_WINDOW_MS;
}
