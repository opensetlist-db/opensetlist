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
  id: number | bigint,
  slugSource: string | null,
): string {
  const slug = slugSource ? slugify(slugSource) : "";
  return slug
    ? `/${locale}/events/${id}/${slug}`
    : `/${locale}/events/${id}`;
}
