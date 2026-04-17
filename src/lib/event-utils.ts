/**
 * Event lock-time utilities for wishlist/prediction deadlines.
 * All times stored and compared in UTC.
 */

export function getEventLockTime(event: { startTime: Date }): Date {
  return event.startTime;
}

export function isEventLocked(event: { startTime: Date }): boolean {
  return new Date() > getEventLockTime(event);
}
