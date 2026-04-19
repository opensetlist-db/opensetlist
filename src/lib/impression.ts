import { IMPRESSION_EDIT_COOLDOWN_MS } from "./config";

export function getEditCooldownRemaining(updatedAt: Date, now: Date): number {
  const elapsed = Math.max(0, now.getTime() - updatedAt.getTime());
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
