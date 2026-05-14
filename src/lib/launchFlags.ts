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
} as const;
