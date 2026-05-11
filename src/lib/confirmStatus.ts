/**
 * 1-minute auto-confirm threshold for `rumoured` setlist rows.
 *
 * Source: `wiki/crowdsourcing.md` "Phase 1C UI Concretes —
 * `ConfirmButton`" + `raw/20260503-user-setlist-confirm-system.md`.
 * After this many minutes past the row's `createdAt`, the row
 * promotes to `confirmed` regardless of viewer activity. Handles
 * late-arriving viewers cleanly: a viewer landing on the page 2
 * minutes after a song was entered sees the row already settled,
 * not stuck in a permanent rumoured limbo.
 *
 * Re-evaluation cadence: `getConfirmStatus` reads `now` at call
 * time, so each render sees the current bucket. The consumer
 * (`<ActualSetlist>`) runs an explicit 5s `setInterval` while any
 * rumoured row is present — that ticker forces re-render so a row
 * that crosses the 60s mark mid-session promotes within ≤ 5s of
 * the boundary regardless of the data source (polling, realtime
 * push, or R3 polling-fallback). The earlier "polling implicitly
 * provides the tick" assumption broke once the realtime cutover
 * disconnected re-renders from a fixed cadence.
 */
const AUTO_CONFIRM_MINUTES = 1;
const AUTO_CONFIRM_MS = AUTO_CONFIRM_MINUTES * 60_000;

/**
 * Cadence of the explicit re-render ticker that `<ActualSetlist>`
 * runs while any rumoured row is present, so rows crossing the
 * `AUTO_CONFIRM_MS` boundary mid-session promote within ≤ this
 * many ms of the boundary. Co-located with `AUTO_CONFIRM_MS` so a
 * future change to the threshold surfaces the cadence next door —
 * the two are intentionally paired (boundary + worst-case-latency).
 */
export const AUTO_CONFIRM_TICK_MS = 5_000;

/**
 * Resolve the "settled" confirmation status for a setlist row.
 *
 * Returns the binary confirmed/rumoured bucket only — the
 * `my-confirmed` *visual* state is the caller's responsibility to
 * compose (`status === "rumoured" && localConfirmedIds.has(id)`).
 * Keeping that decomposition out of this helper means the function
 * stays a pure data-derivation, testable without knowing anything
 * about the row visualization.
 *
 * Order of precedence:
 *   1. DB-level `status === "confirmed"` (admin-promoted; trumps everything)
 *   2. DB-level `status === "live"` (currently happening; treated as
 *      confirmed for visual purposes — the row is happening now and
 *      verified by the system)
 *   3. Past the 1-min auto-promote window → confirmed
 *   4. Otherwise → rumoured
 *
 * `localConfirmedIds` is intentionally NOT consulted here. A
 * locally-confirmed row stays semantically "rumoured" (the system
 * doesn't yet know about a threshold of confirms); the caller
 * combines this return with the local set to choose between the
 * `rumoured` and `my-confirmed` visual variants.
 */
export function getConfirmStatus(
  item: { id: number; status: string; createdAt: Date | string },
  now: Date = new Date(),
): "confirmed" | "rumoured" {
  if (item.status === "confirmed") return "confirmed";
  if (item.status === "live") return "confirmed";
  if (item.status !== "rumoured") {
    // Defensive: any other value (unknown enum widening, data
    // anomaly) falls back to "confirmed" — the safe default that
    // matches the pre-refactor render path's behavior for
    // non-rumoured rows.
    return "confirmed";
  }
  const createdAt =
    item.createdAt instanceof Date
      ? item.createdAt
      : new Date(item.createdAt);
  if (Number.isNaN(createdAt.getTime())) {
    // Malformed createdAt — defensively settle to "confirmed" so a
    // bad timestamp doesn't trap the row in rumoured limbo. Real
    // operator-typed rows always have a valid Prisma `@default(now())`
    // value; this branch covers data tampering / DevTools edits.
    return "confirmed";
  }
  const elapsed = now.getTime() - createdAt.getTime();
  return elapsed >= AUTO_CONFIRM_MS ? "confirmed" : "rumoured";
}
