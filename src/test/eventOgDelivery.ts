import { MemoryImageStorage } from "../lib/imageUpload/memoryStorage";
import { R2CardDelivery } from "../lib/eventOg/delivery";

/** HTTP resource double: real MemoryImageStorage bytes plus an independent
 * edge cache. The actual R2 revoker signs requests and consumes these replies;
 * tests observe retained/removed bytes rather than Prisma/helper call shapes. */
export class MemoryCardOrigin {
  readonly edge = new Map<string, { url: string; bytes: Uint8Array }>();
  readonly deniedKeys = new Set<string>();
  readonly purgedPrefixes: string[] = [];
  purgeFails = false;
  responseLostAfterDelete = false;
  readonly storage: MemoryImageStorage;
  readonly base: string;
  constructor(storage: MemoryImageStorage, base = "https://images.test.invalid") { this.storage = storage; this.base = base; }

  readonly fetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init); const url = new URL(request.url);
    if (url.hostname.endsWith(".r2.cloudflarestorage.com")) {
      const key = url.pathname.split("/").slice(2).join("/");
      const item = this.storage.objects.get(key);
      if (request.method === "DELETE") {
        if (this.deniedKeys.has(key)) return new Response(null, { status: 403 });
        this.storage.objects.delete(key);
        if (this.responseLostAfterDelete) { this.responseLostAfterDelete = false; throw new Error("lost DELETE reply"); }
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: item ? 200 : 404, headers: item ? { "x-amz-meta-sha256": item.sha256 } : {} });
    }
    if (url.hostname === "api.cloudflare.com") {
      if (this.purgeFails) return Response.json({ success: false }, { status: 403 });
      const payload = await request.json();
      for (const prefix of payload.prefixes as string[]) {
        this.purgedPrefixes.push(prefix);
        for (const [key, value] of this.edge) {
          const cached = new URL(value.url);
          if (`${cached.host}${cached.pathname}`.startsWith(prefix)) this.edge.delete(key);
        }
      }
      return Response.json({ success: true });
    }
    const key = url.pathname.slice(1); const cacheKey = `${request.url}|${request.headers.get("origin") ?? ""}`;
    const cached = this.edge.get(cacheKey);
    if (cached) return new Response(cached.bytes as BodyInit, { headers: { "Content-Type": "image/png", "CF-Cache-Status": "HIT" } });
    const item = this.storage.objects.get(key);
    if (!item) return new Response(null, { status: 404, headers: { "CF-Cache-Status": "MISS" } });
    this.edge.set(cacheKey, { url: request.url, bytes: item.bytes });
    return new Response(item.bytes as BodyInit, { headers: { "Content-Type": "image/png", "CF-Cache-Status": "MISS" } });
  };
  delivery() {
    return new R2CardDelivery({ accountId: "0".repeat(32), accessKeyId: "synthetic-key", secretAccessKey: "synthetic-secret",
      bucket: "opensetlist-images-dev", publicBaseUrl: this.base, keyPrefix: this.storage.keyPrefix }, {
      EVENT_CARD_DELIVERY_BASES: JSON.stringify([this.base]), CLOUDFLARE_CACHE_ZONE_ID: "1".repeat(32),
      CLOUDFLARE_CACHE_ZONE_HOST: "test.invalid", CLOUDFLARE_CACHE_PURGE_TOKEN: "synthetic-token",
    }, this.fetch);
  }
  async warm(urls: string[]) {
    for (const url of urls) {
      await this.fetch(url); await this.fetch(`${url}?card-probe=1`);
      await this.fetch(url, { headers: { Origin: new URL(this.base).origin } });
    }
  }
}
