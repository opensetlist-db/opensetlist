// R3.5 — bounded time-based auto-recovery constants shared by the two
// Realtime hooks (`useRealtimeEventChannel`, `useRealtimeImpressions`).
//
// 30s delay: long enough that we're not flapping against a server
// that just rejected a subscription (give the underlying socket and
// the Supabase cluster breathing room), short enough that a user who
// experienced one drop gets realtime back inside a typical wish-song
// burst window during a live show.
//
// 3 attempts: covers the realistic transient-cause distribution (one
// network blip, one WiFi handoff, one server hiccup) without letting
// a pathologically flapping network pin us in an indefinite retry
// loop. After the budget exhausts both hooks stay on polling for the
// rest of the page lifetime — matching the original "no auto-recovery"
// semantics once the budget is gone.
//
// Both hooks share these constants because they govern the same UX
// trade-off (retry quickly enough to feel transparent, give up before
// they become a CPU/breadcrumb-noise drain), and because both share
// the underlying WebSocket and the dominant failure modes hit them
// together. A change to either constant should land in both call
// sites in lock-step; centralizing the source of truth here makes
// that automatic instead of a discipline-dependent two-edit ritual.
//
// Tests import these too — `RECOVERY_DELAY_MS` is what
// `vi.advanceTimersByTimeAsync(...)` advances by, so test expectations
// stay synced to whatever the production delay is.
export const RECOVERY_DELAY_MS = 30_000;
export const MAX_RECOVERY_ATTEMPTS = 3;

// SSR-safe "is the tab currently hidden" check. Used by both Realtime
// hooks for: (a) lazy-initializing the `paused` state on mount so a
// page that opens in an already-backgrounded tab doesn't open a
// channel just to immediately throttle it, (b) resetting `paused`
// on eventId change to match the actual current visibility (not a
// hardcoded `false`), and (c) early-returning at the top of the
// CHANNEL_ERROR/TIMED_OUT handler so a stale subscribe callback
// firing AFTER a visibility-driven channel teardown can't sneak a
// captureMessage out of a tab the user can't see — the
// "visibility-driven teardown is silent" contract must hold across
// every reachable path, not just the one the hide handler walks
// synchronously. SSR-safe via the `typeof document` check (this
// module is imported by `"use client"` hooks but the bundle is also
// parsed server-side during Next.js build).
//
// CodeRabbit feedback on PR #452 (release PR for v0.13.23) caught
// all three sites; centralizing the check here keeps them in
// lock-step.
export function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}
