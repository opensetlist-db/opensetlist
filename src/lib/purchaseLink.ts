type PurchaseLink = { href: string; isAffiliate: boolean };

export function resolvePurchaseLink(
  href: string | null | undefined,
  trackingId: string | undefined,
): PurchaseLink | null {
  if (!href) return null;
  const url = URL.parse(href);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return null;

  // Short links must be expanded and checked by the collector before saving.
  if (
    (url.hostname !== "amazon.co.jp" && url.hostname !== "www.amazon.co.jp") ||
    url.username || url.password || url.port
  ) {
    return { href, isAffiliate: false };
  }

  const tag = trackingId?.trim();
  if (!tag && !url.searchParams.has("tag")) return { href, isAffiliate: false };

  url.searchParams.delete("tag");
  if (tag) url.searchParams.set("tag", tag);
  return { href: url.href, isAffiliate: Boolean(tag) };
}
