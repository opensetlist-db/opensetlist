import { resolveStoreKey } from "@/lib/storeKeys";
import { isSafeExternalUrl } from "@/lib/utils";

type Instant = Date | string | null;

export type PurchaseBonus = {
  startsAt: Instant;
  endsAt: Instant;
  endedAt: Instant;
};

export type PurchaseListing = {
  status: string;
  productUrl: string | null;
  originalStoreName: string;
  includesPerformanceVideo: boolean | null;
  isBonusOption: boolean | null;
  storeKey: string | null;
  officialOrder: number | null;
  startsAt: Instant;
  endsAt: Instant;
  bonuses: readonly PurchaseBonus[];
};

// Cached home and event reads only need the inputs to the shared projection.
export const PURCHASE_AVAILABILITY_SELECT = {
  status: true,
  productUrl: true,
  originalStoreName: true,
  includesPerformanceVideo: true,
  isBonusOption: true,
  storeKey: true,
  officialOrder: true,
  startsAt: true,
  endsAt: true,
  bonuses: { select: { startsAt: true, endsAt: true, endedAt: true } },
} as const;

export function performanceOfficialUrl(
  listings: readonly { includesPerformanceVideo: boolean | null; sourceUrl: string | null }[],
) {
  return listings.find(
    (listing) => listing.includesPerformanceVideo !== false && isSafeExternalUrl(listing.sourceUrl),
  )?.sourceUrl;
}

function inWindow(start: Instant, end: Instant, now: number) {
  return (start === null || new Date(start).getTime() <= now)
    && (end === null || now < new Date(end).getTime());
}

function purchaseStoreKey(listing: Pick<PurchaseListing, "storeKey" | "originalStoreName">) {
  const known = resolveStoreKey(listing.originalStoreName);
  return listing.storeKey ?? (known === "other"
    ? listing.originalStoreName.normalize("NFKC").trim().toLowerCase()
    : known);
}

function isAmazonJapan(url: string) {
  const { hostname } = new URL(url);
  return hostname === "amazon.co.jp" || hostname === "www.amazon.co.jp";
}

export function projectPurchaseOptions<L extends PurchaseListing>(
  listings: readonly L[],
  now = new Date(),
  { performanceOnly = false } = {},
) {
  type Option = { listing: L & { productUrl: string }; bonuses: L["bonuses"][number][] };
  const stores = new Map<string, { key: string; options: Option[] }>();
  const basicOptions: Option["listing"][] = [];
  let bonusCount = 0;
  const time = now.getTime();
  const ordered = [...listings].sort((a, b) =>
    (a.officialOrder ?? Infinity) - (b.officialOrder ?? Infinity));
  for (const listing of ordered) {
    if (listing.status === "ended" ||
      (performanceOnly && listing.includesPerformanceVideo !== true) ||
      !isSafeExternalUrl(listing.productUrl) ||
      !inWindow(listing.startsAt, listing.endsAt, time)) continue;

    const withUrl = { ...listing, productUrl: listing.productUrl };
    const key = purchaseStoreKey(listing);
    // A former bonus option never becomes a basic option when its last bonus ends.
    if (!(listing.isBonusOption || listing.bonuses.length > 0)) {
      if (!performanceOnly || isAmazonJapan(listing.productUrl)) basicOptions.push(withUrl);
      continue;
    }

    const bonuses = listing.bonuses.filter((bonus: L["bonuses"][number]) =>
      bonus.endedAt === null && inWindow(bonus.startsAt, bonus.endsAt, time));
    if (bonuses.length === 0) continue;
    bonusCount += bonuses.length;
    const group = stores.get(key) ?? { key, options: [] };
    group.options.push({ listing: withUrl, bonuses });
    stores.set(key, group);
  }
  return { bonusStores: [...stores.values()], basicOptions, bonusCount };
}
