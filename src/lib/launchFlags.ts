export const LAUNCH_FLAGS = {
  showSignIn: false,
  showSearch: false,
  // Gates DB writes for SetlistItemConfirm during the 5/23 + 5/24
  // Kobe events (UI flow exercised, no DB contamination). Between
  // 5/25 and 5/30 Kanagawa Day-1, delete this entry and remove
  // every `if (LAUNCH_FLAGS.confirmDbEnabled) ...` branch in the
  // Confirm consumer code — the removal commit is the activation.
  confirmDbEnabled: false,
  // Gates the user-facing `+ 곡 추가` button + the
  // POST /api/events/[eventId]/setlist-items endpoint that backs it
  // (the AddItemBottomSheet — Phase 1C user setlist contribution).
  //
  // 5/23 + 5/24 Kobe: false — button is hidden, endpoint returns 403
  //   with `{ ok: false, error: "feature_flag_disabled" }`. Lets the
  //   code ship to prod ahead of time without any user-visible
  //   surface, so we can validate it against real event data on dev
  //   + smoke it on Kobe-pinned preview deploys without the UX
  //   leaking on the live event page.
  //
  // 5/30 Kanagawa Day-1: flips to true. Between 5/25 and 5/30,
  //   delete this entry and remove every
  //   `if (LAUNCH_FLAGS.addItemEnabled) ...` / `if (!LAUNCH_FLAGS.addItemEnabled) ...`
  //   branch in the consumers (ActualSetlist button mount + the
  //   POST route's flag guard). The removal commit IS the activation —
  //   no env var change needed, no runtime config to worry about
  //   diverging across regions.
  //
  // Same shape as confirmDbEnabled (above) so the activation pattern
  // stays uniform — operator runs one branch+PR per flag flip.
  addItemEnabled: false,
  // Gates the per-row "이슈 제기" affordance + the
  // POST /api/setlist-items/[id]/contests endpoint that backs it
  // (the ContestReport follow-up to conflict-handling).
  //
  // Two scenarios this addresses:
  //   1. Contesting a CONFIRMED row (operator-set or N=3 promoted).
  //      The conflict path rejects with 400 `position_already_confirmed`
  //      because the partial unique negation index won't permit a
  //      contesting rumoured sibling — contestation goes to the
  //      operator queue instead of real-time vote resolution.
  //   2. Non-song corrections (missing performer, wrong variant,
  //      free-text feedback) that the conflict-sibling model can't
  //      express — they're proposed edits, not competing candidates.
  //
  // 5/23 + 5/24 Kobe: false — button hidden, endpoint returns 403.
  //   Lets the code ship behind the same flag-flip discipline as
  //   confirmDbEnabled / addItemEnabled.
  //
  // 5/30 Kanagawa Day-1: flips to true alongside the other 1C
  //   activations. Between 5/25 and 5/30, delete this entry and
  //   remove every `if (LAUNCH_FLAGS.contestReportEnabled) ...`
  //   branch — the removal commit IS the activation.
  contestReportEnabled: false,
} as const;
