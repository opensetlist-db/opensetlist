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
 *   - the start is within `WISH_PREDICT_OPEN_DAYS` UTC-day-boundary
 *     days from `now`.
 *
 * The lock-at-startTime is enforced separately by `event.status`
 * flipping `scheduled → ongoing` (auto-status-flip ticker); this
 * helper governs the open-window-only side. Post-show (status !==
 * "upcoming"), this returns false — callers fall through to
 * existing post-show display rules.
 *
 * Snap-frozen at SSR by design: the gate is computed once with the
 * server's `now` and threaded as a boolean prop. A page kept open
 * across a midnight UTC D-7 boundary (rare; ~1-in-7 chance per
 * session, requires page open ≥1 day) won't auto-unlock — refresh
 * does. Worth the simplicity vs. a client-side ticker.
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
  // Defensive strict-future check. `getEventStatus` upstream resolves
  // DB `scheduled` → "upcoming" only when `now < startTime`, so in
  // practice the helper sees future starts. But the helper's own
  // contract is "the D-7 OPEN window is currently active" — which
  // requires the start to be in the future. Without this check, a
  // status auto-flip lag (event started ~minutes ago but DB still
  // says `scheduled`) on the same UTC day would return true: the
  // UTC day-distance is 0, gate passes, but the event is already
  // past. CR #282 caught this. Tested via "earlier today, same UTC
  // day" regression case in the unit suite.
  if (start.getTime() <= now.getTime()) return false;
  const days = daysUntilUTC(start, now);
  return days >= 0 && days <= WISH_PREDICT_OPEN_DAYS;
}

/**
 * Home-page Upcoming-card badge condition. Caller already computed
 * `daysUntil` via `daysUntilUTC` so we don't redo the date math.
 *
 * D-0 (same UTC day as start, but pre-startTime) IS included —
 * matches `isWishPredictOpen`. The earlier v0.10.0 implementation
 * required `daysUntil > 0` on the rationale that "D-0 is about to
 * flip to ongoing via the auto-status ticker", which was wrong:
 * the ticker flips at `now >= startTime`, not when
 * `daysUntilUTC` drops to 0. There's a window of up to ~24h on
 * the event's UTC day where `daysUntil === 0` but the event hasn't
 * started yet — and that's exactly when fans want the predict
 * window highlighted (D-0 same-day = high engagement). Bug
 * caught in v0.10.0 smoke: a 4h-before-start view dropped the
 * badge while a 12h-before-start view kept it, because the 12h
 * sample sat across the UTC midnight boundary and the 4h sample
 * didn't.
 *
 * Caller (home-page Upcoming query) already filters
 * `startTime: { gt: now }`, so past-start events can't reach this
 * helper — no strict-future check needed here.
 */
export function shouldShowWishBadge(daysUntil: number): boolean {
  return daysUntil >= 0 && daysUntil <= WISH_PREDICT_OPEN_DAYS;
}
