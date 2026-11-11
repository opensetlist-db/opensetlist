import { projectPurchaseOptions, type PurchaseListing } from "@/lib/purchaseAvailability";

export function countActiveBonuses(listings: readonly PurchaseListing[], performanceOnly = false): number {
  return projectPurchaseOptions(listings, new Date(), { performanceOnly }).bonusCount;
}

export { resolveStoreKey } from "@/lib/storeKeys";
