export const LAUNCH_FLAGS = {
  showSignIn: false,
  showSearch: false,
  // Gates DB writes for SetlistItemConfirm during the 5/23 + 5/24
  // Kobe events (UI flow exercised, no DB contamination). Between
  // 5/25 and 5/30 Kanagawa Day-1, delete this entry and remove
  // every `if (LAUNCH_FLAGS.confirmDbEnabled) ...` branch in the
  // Confirm consumer code — the removal commit is the activation.
  confirmDbEnabled: false,
  // Gates the Supabase Realtime push subscription path for live
  // event pages. Default `false` so production keeps the proven
  // 5s polling path (`useSetlistPolling`) until Realtime is
  // verified end-to-end on dev. When `true`, `LiveEventLayout`
  // swaps in `useRealtimeEventChannel` (same return shape) — push
  // updates land in <1s instead of <5s.
  //
  // R1 scope: SetlistItem only. Reactions/impressions/wishlist
  // continue to poll inside the realtime hook (Path B refetch on
  // push) until R2 layers per-row diff-merge for those tables.
  //
  // Activation pattern mirrors `confirmDbEnabled`: once Realtime
  // has a clean record across multiple shows, delete this entry
  // and the `LAUNCH_FLAGS.realtimeEnabled` branches in the
  // realtime consumer code — the removal commit is the activation.
  // Operator kill switch: flip to `false` to force all viewers
  // back onto the polling path instantly.
  realtimeEnabled: false,
} as const;
