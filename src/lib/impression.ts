import { IMPRESSION_EDIT_COOLDOWN_MS } from "./config";

// `sinceDate` is the reference timestamp the cooldown is measured from.
// In the append-only impression model, callers pass the head row's
// `createdAt` (the chain's most recent edit), so naming the parameter
// `updatedAt` misled readers into looking for an `updatedAt` column.
export function getEditCooldownRemaining(sinceDate: Date, now: Date): number {
  const elapsed = Math.max(0, now.getTime() - sinceDate.getTime());
  const remaining = IMPRESSION_EDIT_COOLDOWN_MS - elapsed;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / 1000);
}

// Thrown from inside transactional handlers so the route boundary can
// translate domain failures into the right HTTP response without leaking
// the throw/catch shape into the happy path.
export class ImpressionNotFoundError extends Error {
  constructor() {
    super("Impression not found");
    this.name = "ImpressionNotFoundError";
  }
}

export class ImpressionCooldownError extends Error {
  readonly remainingSeconds: number;
  constructor(remainingSeconds: number) {
    super("Impression edit cooldown active");
    this.name = "ImpressionCooldownError";
    this.remainingSeconds = remainingSeconds;
  }
}

export class ImpressionStaleEditError extends Error {
  constructor() {
    super("Impression edit superseded by a concurrent edit");
    this.name = "ImpressionStaleEditError";
  }
}
