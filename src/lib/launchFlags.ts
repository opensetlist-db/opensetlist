export const LAUNCH_FLAGS = {
  showSignIn: false,
  showSearch: false,
  // Gates DB writes for SetlistItemConfirm during the 5/23 + 5/24
  // Kobe events (UI flow exercised, no DB contamination). Between
  // 5/25 and 5/30 Kanagawa Day-1, delete this entry and remove
  // every `if (LAUNCH_FLAGS.confirmDbEnabled) ...` branch in the
  // Confirm consumer code — the removal commit is the activation.
  confirmDbEnabled: false,
} as const;
