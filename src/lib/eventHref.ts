import { slugify } from "@/lib/utils";

/**
 * Build the canonical event URL for the given locale.
 *
 * `slugSource` is typically the localized event name. It may be
 * all-punctuation (`!!!`, `***`); `slugify` strips those down to an
 * empty string and we'd otherwise emit `/events/{id}/`. Branch on the
 * post-slugify result so the trailing slash never appears.
 */
export function eventHref(
  locale: string,
  // Accept all three forms so callers don't have to coerce: `number`
  // is the post-`serializeBigInt` shape, `bigint` is raw Prisma, and
  // `string` is the precision-safe form used when an autoincrement
  // ID exceeds 2^53. Template-literal interpolation produces the
  // exact digit string in all three cases.
  id: number | bigint | string,
  slugSource: string | null,
): string {
  const slug = slugSource ? slugify(slugSource) : "";
  return slug
    ? `/${locale}/events/${id}/${slug}`
    : `/${locale}/events/${id}`;
}
