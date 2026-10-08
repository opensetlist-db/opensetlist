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
 * This is the DEFAULT window. A per-event override lives on
 * `Event.engagementOpensAt` (see `isWishPredictOpen`): tour legs in
 * quick succession keep the default so one stop's window doesn't
 * overlap the previous show, while standalone shows and festivals set
 * an earlier opens-at (~D-30) because a 7-day window was too short for
 * word-of-mouth to reach anyone (Kobe, zero organic adoption).
 */
export const WISH_PREDICT_OPEN_DAYS = 7;

// Exported so callers that need rolling-day windows
// (e.g. `now + N * MS_PER_DAY` cutoffs in queries) reference the
// same constant as the gate / dDay math instead of re-spelling
// `24 * 60 * 60 * 1000` inline.
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Exported so unit tests pin the boundary against the same constant the
// gate uses, instead of re-deriving the formula locally and silently
// diverging if WISH_PREDICT_OPEN_DAYS or the day length ever changes.
export const OPEN_WINDOW_MS = WISH_PREDICT_OPEN_DAYS * MS_PER_DAY;

/**
 * Floor of full 24-hour periods until `target` (positive = future,
 * negative = past). Computed directly from absolute time differences
 * — no calendar or timezone math.
 *
 * Replaces the prior `daysUntilUTC` for user-visible D-N counts.
 * UTC-day floors gave a calendar-day distance that landed on the
 * correct integer ONLY for viewers whose local clock matched UTC;
 * KST/JST viewers (the primary audience) saw the chip lag by a day
 * for several hours every morning because the UTC-day boundary
 * (09:00 KST) doesn't match the KST-day boundary (00:00 KST).
 *
 * Absolute-time math sidesteps the whole TZ question: D-7 means
 * "between 7 and 8 full 24-hour periods remain until startTime,"
 * which is the same for every viewer everywhere.
 *
 * Examples (DAY_MS = 24h):
 *   diff = 7d 23h → D-7
 *   diff = 8d 0h  → D-8
 *   diff = 0      → D-0
 *   diff = -1d    → D-(-1)  (caller decides whether to render)
 */
export function daysUntil(target: Date, now: Date): number {
  return Math.floor((target.getTime() - now.getTime()) / MS_PER_DAY);
}

// Retained UTC-day helpers for the rare case where a caller genuinely
// needs to compare against a UTC-stored `@db.Date` value (e.g., aligning
// to `Event.date` exactly as stored). For user-visible "today" math,
// use `daysUntil` (above) instead — see the rationale in its docstring.
export function utcDayStart(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}
export function utcDayOffset(d: Date, days: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days),
  );
}
export function daysUntilUTC(target: Date, now: Date): number {
  const diff = utcDayStart(target).getTime() - utcDayStart(now).getTime();
  return Math.round(diff / MS_PER_DAY);
}

type DateInput = Date | string | null | undefined;

function toValidDate(v: DateInput): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Effective opening instant for an event's wish/predict window:
 * the per-event override when set (and parseable), else
 * `start − OPEN_WINDOW_MS`. Exported so UI copy ("open until
 * showtime", "opens on {date}") reads the same instant the gate does.
 */
export function wishPredictOpensAt(
  start: Date,
  engagementOpensAt?: DateInput,
): Date {
  return (
    toValidDate(engagementOpensAt) ??
    new Date(start.getTime() - OPEN_WINDOW_MS)
  );
}

// Shared by isWishPredictOpen + shouldShowWishBadge so the gate and
// the home-card badge can't drift on the opens-at boundary check.
// Strict-future check doubles as the "gate closes at startTime"
// upper bound (CR #282: a stale `status: "upcoming"` row with a
// past startTime caught by the auto-status-flip ticker lag still
// reads as closed here).
function isWithinWishOpenWindow(
  start: Date,
  engagementOpensAt: DateInput,
  now: Date,
): boolean {
  if (start.getTime() - now.getTime() <= 0) return false;
  return wishPredictOpensAt(start, engagementOpensAt).getTime() <= now.getTime();
}

/**
 * Visibility gate for wishlist + predicted-setlist surfaces.
 *
 * Returns true iff:
 *   - the event is `upcoming` (DB `scheduled` AND `now < startTime`,
 *     resolved by `getEventStatus`), AND
 *   - `opensAt <= now < startTime`, where
 *     `opensAt = engagementOpensAt ?? startTime − 168h`.
 *
 * `engagementOpensAt` null (every event unless the operator set one)
 * reproduces the legacy fixed D-7 rule exactly, including the
 * inclusive boundary at precisely 168h out. An override at or after
 * `startTime` would never open — the admin API rejects that input,
 * and the strict-future upper bound keeps it closed here regardless.
 * An unparseable override string falls back to the default rather
 * than closing the gate: a bad optional column shouldn't hide the
 * surfaces on show week.
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
 * opens-at boundary won't auto-unlock — refresh does.
 */
export function isWishPredictOpen(
  event: {
    startTime: Date | string | null;
    status: ResolvedEventStatus;
    engagementOpensAt?: DateInput;
  },
  now: Date = new Date(),
): boolean {
  if (event.status !== "upcoming") return false;
  const start = toValidDate(event.startTime);
  if (!start) return false;
  return isWithinWishOpenWindow(start, event.engagementOpensAt, now);
}

/**
 * Home-page Upcoming-card badge condition. Mirrors the gate exactly so
 * the badge can never appear on a card whose detail-page gate is
 * closed (and vice versa). Operator-confusing drift between the two
 * surfaces was the original bug that prompted this rewrite — which is
 * why the per-event `engagementOpensAt` override must be passed here
 * too, not just to `isWishPredictOpen`.
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
export function shouldShowWishBadge(
  start: Date,
  now: Date,
  engagementOpensAt: DateInput = null,
): boolean {
  return isWithinWishOpenWindow(start, engagementOpensAt, now);
}
