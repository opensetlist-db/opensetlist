import { entityPath, type EntityId } from "@/lib/seo/entityUrl";

/**
 * Build the canonical event URL for the given locale.
 *
 * `slug` is the event's DB `slug` column — never a slugified display
 * name. Slugifying the localized name at link time used to mint a
 * different URL per locale (and CJK slugs when a translation fell
 * back), all of which served 200 and showed up in Search Console as
 * duplicates. The event page now 308s every non-canonical slug, so a
 * display-name slug here would cost every click a redirect hop.
 */
export function eventHref(
  locale: string,
  // Accept all three forms so callers don't have to coerce: `number`
  // is the post-`serializeBigInt` shape, `bigint` is raw Prisma, and
  // `string` is the precision-safe form used when an autoincrement
  // ID exceeds 2^53. Template-literal interpolation produces the
  // exact digit string in all three cases.
  id: EntityId,
  slug: string,
): string {
  return entityPath("events", locale, id, slug);
}
