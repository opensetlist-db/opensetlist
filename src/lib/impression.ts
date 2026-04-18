import { IMPRESSION_EDIT_COOLDOWN_MS } from "./config";

export function getEditCooldownRemaining(updatedAt: Date, now: Date): number {
  const elapsed = Math.max(0, now.getTime() - updatedAt.getTime());
  const remaining = IMPRESSION_EDIT_COOLDOWN_MS - elapsed;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / 1000);
}
