/**
 * localStorage keys of the per-event engagement hooks
 * (`useLocalConfirm`, `useLocalDisagree`). Shared with the unit tests,
 * which seed and read the same keys.
 *
 * A plain module: the hooks' "use client" files may export only
 * components and hooks (`local/use-client-exports`).
 */

export function confirmKey(eventId: string): string {
  return `confirm-${eventId}`;
}

export function disagreeKey(eventId: string): string {
  return `disagree-${eventId}`;
}
