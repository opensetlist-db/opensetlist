// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { MemoryImageStorage } from "@/lib/imageUpload/memoryStorage";
import { MemoryCardOrigin } from "@/test/eventOgDelivery";
import { R2CardDelivery, type DeliveryTarget } from "@/lib/eventOg/delivery";

async function fixture() {
  const storage = new MemoryImageStorage("test"); const resource = new MemoryCardOrigin(storage);
  const directory = "test/event-cards/7/prediction/778f4eec-1d33-401f-8ee7-bbcc159a279b/";
  const bytes = new Uint8Array([1, 2, 3]); const sha256 = createHash("sha256").update(bytes).digest("hex");
  const images = ["ja", "ko", "en"].map((locale) => ({ locale, key: `${directory}${locale}.png`, url: `${resource.base}/${directory}${locale}.png`, sha256 }));
  for (const image of images) await storage.putImmutable({ key: image.key, bytes, sha256, contentType: "image/png" });
  const neighbor = "test/event-cards/7/live/6327fdfd-e378-47be-a7b1-8d43389d876b/ja.png";
  await storage.putImmutable({ key: neighbor, bytes, sha256, contentType: "image/png" });
  await resource.warm([...images.map((i) => i.url), `${resource.base}/${neighbor}`]);
  const target: DeliveryTarget = { publicationId: "778f4eec-1d33-401f-8ee7-bbcc159a279b", eventId: "7", mode: "prediction", namespace: "test", images };
  return { storage, resource, target, neighbor, directory };
}
describe("publication-scoped owned image delivery revocation", () => {
  it("deletes only exact published keys, purges their prefix including query/header variants, and verifies the original URLs", async () => {
    const f = await fixture(); expect(f.storage.objects.size).toBe(4); expect(f.resource.edge.size).toBe(12);
    const report = await f.resource.delivery().revoke(f.target);
    expect(report.origins.every((r) => r.status === "blocked")).toBe(true);
    expect(report.cache.status).toBe("purged"); expect(report.public).toHaveLength(9); expect(report.public.every((r) => r.blocked)).toBe(true);
    expect(f.resource.purgedPrefixes).toEqual([`images.test.invalid/${f.directory}`]);
    expect([...f.storage.objects.keys()]).toEqual([f.neighbor]);
    expect(f.resource.edge.size).toBe(3);
    expect((await f.resource.fetch(`${f.resource.base}/${f.neighbor}`)).status).toBe(200);
    expect((await f.resource.delivery().revoke(f.target)).public.every((r) => r.blocked)).toBe(true);
  });
  it("reports origin denial and cached bytes separately, then safely verifies a retry after a lost DELETE reply", async () => {
    const f = await fixture(); f.resource.deniedKeys.add(f.target.images[0].key); f.resource.purgeFails = true;
    const partial = await f.resource.delivery().revoke(f.target);
    expect(partial.origins.filter((r) => r.status === "failed")).toHaveLength(1);
    expect(partial.cache.status).toBe("failed"); expect(partial.public.some((r) => !r.blocked && r.status === 200)).toBe(true);
    expect(f.storage.objects.has(f.target.images[0].key)).toBe(true);
    f.resource.deniedKeys.clear(); f.resource.purgeFails = false; f.resource.responseLostAfterDelete = true;
    expect((await f.resource.delivery().revoke(f.target)).origins.some((r) => r.status === "failed")).toBe(true);
    const retry = await f.resource.delivery().revoke(f.target);
    expect(retry.origins.every((r) => r.status === "blocked")).toBe(true); expect(retry.public.every((r) => r.blocked)).toBe(true);
  });
  it("refuses foreign keys, a mismatched namespace or a forged URL before deleting any original object", async () => {
    const f = await fixture(); expect(f.storage.objects.size).toBe(4);
    for (const target of [{ ...f.target, namespace: "prod" }, { ...f.target, images: f.target.images.map((i, n) => n === 0 ? { ...i, key: f.neighbor } : i) },
      { ...f.target, images: f.target.images.map((i, n) => n === 0 ? { ...i, url: "https://untrusted.invalid/a.png" } : i) }]) {
      await expect(f.resource.delivery().revoke(target)).rejects.toThrow();
      expect(f.storage.objects.size).toBe(4);
    }
  });
  it("requires an explicit delivery-path inventory and reports missing cache permissions without claiming complete revocation", async () => {
    const f = await fixture(); const config = { accountId: "0".repeat(32), accessKeyId: "synthetic", secretAccessKey: "synthetic",
      bucket: "opensetlist-images-dev", publicBaseUrl: f.resource.base, keyPrefix: "test" };
    await expect(new R2CardDelivery(config, {}, f.resource.fetch).revoke(f.target)).rejects.toThrow("delivery_inventory_required");
    expect(f.storage.objects.size).toBe(4);
    const partial = await new R2CardDelivery(config, { EVENT_CARD_DELIVERY_BASES: JSON.stringify([f.resource.base]) }, f.resource.fetch).revoke(f.target);
    expect(partial.origins.every((r) => r.status === "blocked")).toBe(true);
    expect(partial.cache).toMatchObject({ status: "failed", code: "cache_permissions_required" });
    expect(partial.public.some((r) => r.status === 200)).toBe(true);
  });
});
