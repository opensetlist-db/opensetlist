/**
 * Event lock-time utilities for wishlist/prediction deadlines.
 * All times stored and compared in UTC.
 */

export function getEventLockTime(event: {
  date: Date | null;
  startTime: Date | null;
}): Date {
  if (event.startTime) {
    return event.startTime;
  }

  // Default: event day 14:00 KST = 05:00 UTC
  if (event.date) {
    const date = new Date(event.date);
    return new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        5, 0, 0
      )
    );
  }

  // No date → always locked
  return new Date();
}

export function isEventLocked(event: {
  date: Date | null;
  startTime: Date | null;
}): boolean {
  return new Date() > getEventLockTime(event);
}
