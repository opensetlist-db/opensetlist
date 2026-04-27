/**
 * Canonical filter values + display order for the events list page.
 * Lives in `src/lib` (not `src/components/events/FilterBar.tsx`) so
 * the server page can validate searchParams without importing from a
 * `"use client"` module — that would force the page through the
 * client-component graph and is a layering smell even though Next
 * tolerates it.
 *
 * The order here doubles as the FilterBar button order.
 */
export const FILTER_VALUES = [
  "all",
  "ongoing",
  "upcoming",
  "completed",
] as const;

export type EventListFilter = (typeof FILTER_VALUES)[number];
