// Date conversion helpers for admin surfaces. Both sides of the
// `<input type="datetime-local">` boundary need to be in UTC so the
// rendered slice doesn't drift with the operator's laptop TZ (per
// CLAUDE.md UTC rule). Kept in a non-"use client" module so both
// server components (admin listings/tracks pages) and client modals
// can import without crossing the RSC boundary.

const pad = (n: number) => n.toString().padStart(2, "0");

/**
 * Render a stored UTC ISO timestamp as a `YYYY-MM-DD` slice for
 * read-only display in admin tables. Inspects via getUTC* getters so
 * a UTC date renders the same regardless of where the rendering
 * server happens to live. Returns "—" for null / unparseable input.
 */
export function formatUtcDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Render a stored UTC ISO timestamp as the `YYYY-MM-DDTHH:mm` shape
 * that `<input type="datetime-local">` expects. The input element
 * interprets its own value in local time, so we deliberately feed it
 * the UTC slice — what the operator sees is what's persisted.
 */
export function utcIsoToInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

/**
 * Inverse of `utcIsoToInputValue`. Re-attaches the `Z` so `new Date`
 * parses the result as UTC, not local. Returns `null` for empty
 * input so callers can pass it straight to a nullable column.
 */
export function inputValueToUtcIso(value: string): string | null {
  if (!value) return null;
  return `${value}:00.000Z`;
}

/**
 * Current UTC instant rendered as a `datetime-local` input value.
 * Used by the "지금 확인" 1-click button to set lastVerifiedAt = now
 * inside the form without rounding through the server.
 */
export function nowAsInputValue(): string {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}
