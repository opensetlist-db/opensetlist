/**
 * Cursor format for the event-impressions "see older" pagination.
 *
 * Lives in `src/lib/` so both the SSR fetch in
 * `src/app/[locale]/events/[id]/[[...slug]]/page.tsx` and the
 * `/api/impressions` GET route share one encoder — without this, the
 * SSR seed cursor and the API route's emitted cursors could drift on
 * format and the client would get a 400 ("Invalid cursor") on its
 * first "see older" click after a hot deploy.
 *
 * Format: `<ISO createdAt>_<uuid>`. The id half breaks ties when
 * concurrent inserts land in the same millisecond — `createdAt`
 * alone is not unique under sub-millisecond bursts, and a
 * tie-broken cursor would silently skip or duplicate rows at the
 * tied boundary on subsequent pages.
 *
 * The cursor is OPAQUE to the client. Server emits it, client echoes
 * it back via `?before=...`, server parses it. Only this module
 * understands the format; clients must not split, parse, or compare
 * cursor strings.
 */
export function encodeImpressionCursor(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}_${id}`;
}

/**
 * Inverse of `encodeImpressionCursor`. Returns null on any malformed
 * input — caller (the API route) translates null into a 400 response
 * so a tampered/stale cursor surfaces as a clear error rather than
 * silently returning zero rows.
 *
 * Validation gates:
 *   - Single `_` separator (UUIDs and ISO timestamps don't contain `_`).
 *   - ISO half parses to a valid Date.
 *   - UUID half matches the canonical 8-4-4-4-12 hex shape.
 */
export function decodeImpressionCursor(
  raw: string,
): { createdAt: Date; id: string } | null {
  const sep = raw.indexOf("_");
  if (sep <= 0 || sep === raw.length - 1) return null;
  const isoPart = raw.slice(0, sep);
  const idPart = raw.slice(sep + 1);
  const createdAt = new Date(isoPart);
  if (Number.isNaN(createdAt.getTime())) return null;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      idPart,
    )
  ) {
    return null;
  }
  return { createdAt, id: idPart };
}
