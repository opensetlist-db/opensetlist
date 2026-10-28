import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";
import { readR2Config, type R2Config } from "../imageUpload/storage";
import { CARD_LOCALES, type CardMode } from "./content";
import { invalid, sharePath } from "./contracts";

export type DeliveryTarget = {
  publicationId: string; eventId: string; mode: CardMode; namespace: string;
  images: { locale: string; key: string; url: string; sha256: string }[];
};
export type DeliveryReport = {
  origins: { key: string; status: "blocked" | "failed"; code?: string }[];
  cache: { status: "not-needed" | "purged" | "failed"; prefixes: string[]; code?: string };
  public: { url: string; probe: string; blocked: boolean; status?: number; sha256?: string; cacheStatus?: string; code?: string }[];
};
/** A publication-scoped capability, deliberately separate from ImageStorage.
 * No caller can supply a bucket, arbitrary key, URL, wildcard or whole-zone
 * purge. The saved publication tuple determines all three exact origin keys. */
export interface CardDelivery { revoke(target: DeliveryTarget): Promise<DeliveryReport> }

class DeliveryFailure extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export const deliveryErrorCode = (error: unknown) => error instanceof DeliveryFailure ? error.code : "delivery_unavailable";
const blocked = (status: number) => status === 404 || status === 410;
const devDelivery = (url: URL) => /^pub-[a-f0-9]{32}\.r2\.dev$/.test(url.hostname);

export function publicationDirectory(target: Pick<DeliveryTarget, "eventId" | "mode" | "publicationId" | "namespace">) {
  sharePath(target.eventId, target.mode, target.publicationId, "ja");
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(target.namespace)) throw invalid("공개 중단 저장소 namespace가 올바르지 않습니다.");
  return `${target.namespace}/event-cards/${target.eventId}/${target.mode}/${target.publicationId}/`;
}
export function validateDeliveryTarget(target: DeliveryTarget) {
  const directory = publicationDirectory(target);
  if (target.images.length !== 3 || !CARD_LOCALES.every((l) => target.images.filter((i) => i.locale === l).length === 1)
    || target.images.some((i) => i.key !== `${directory}${i.locale}.png` || !/^[a-f0-9]{64}$/.test(i.sha256))) {
    throw invalid("공개 중단 대상은 저장된 발행본의 정확한 3언어 자산이어야 합니다.");
  }
  return directory;
}

function deliveryBases(config: R2Config, env: Record<string, string | undefined>) {
  let raw: unknown;
  try { raw = JSON.parse(env.EVENT_CARD_DELIVERY_BASES ?? "null"); }
  catch { throw new DeliveryFailure("delivery_inventory_invalid"); }
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 8 || raw.some((v) => typeof v !== "string")) {
    throw new DeliveryFailure("delivery_inventory_required");
  }
  const bases = raw.map((value: string) => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new DeliveryFailure("delivery_inventory_invalid");
    return url.href.replace(/\/+$/, "");
  });
  if (new Set(bases).size !== bases.length || !bases.includes(config.publicBaseUrl)) throw new DeliveryFailure("delivery_inventory_invalid");
  return bases;
}

export class R2CardDelivery implements CardDelivery {
  private readonly client: AwsClient;
  private readonly endpoint: string;
  private readonly config: R2Config;
  private readonly env: Record<string, string | undefined>;
  private readonly fetchImpl: typeof fetch;
  constructor(config: R2Config, env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch) {
    this.config = config; this.env = env; this.fetchImpl = fetchImpl;
    this.client = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: "s3", region: "auto", retries: 0 });
    this.endpoint = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`;
  }
  async revoke(target: DeliveryTarget): Promise<DeliveryReport> {
    const directory = validateDeliveryTarget(target);
    if (target.namespace !== this.config.keyPrefix || target.images.some((i) => i.url !== `${this.config.publicBaseUrl}/${i.key}`)) {
      throw new DeliveryFailure("delivery_scope_mismatch");
    }
    const bases = deliveryBases(this.config, this.env);
    const report: DeliveryReport = { origins: [], cache: { status: "failed", prefixes: [], code: "not_attempted" }, public: [] };
    for (const image of target.images) {
      try {
        const url = `${this.endpoint}/${image.key}`;
        const before = await this.origin(url, "HEAD");
        if (!blocked(before.status)) {
          if (!before.ok) throw new DeliveryFailure(`origin_head_${before.status}`);
          if (before.headers.get("x-amz-meta-sha256") !== image.sha256) throw new DeliveryFailure("origin_hash_mismatch");
          const removed = await this.origin(url, "DELETE");
          if (!removed.ok) throw new DeliveryFailure(`origin_delete_${removed.status}`);
        }
        if (!blocked((await this.origin(url, "HEAD")).status)) throw new DeliveryFailure("origin_still_available");
        report.origins.push({ key: image.key, status: "blocked" });
      } catch (error) { report.origins.push({ key: image.key, status: "failed", code: deliveryErrorCode(error) }); }
    }
    const custom = bases.map((b) => new URL(b)).filter((b) => !devDelivery(b));
    // Prefixes are EXACT publication directories. Unlike files:[url], this
    // removes cached query/header variants too. Never purge bucket/zone-wide.
    const prefixes = custom.map((b) => `${b.host}${b.pathname.replace(/\/$/, "")}/${directory}`);
    if (!prefixes.length) report.cache = { status: "not-needed", prefixes: [] };
    else {
      try {
        const zone = this.env.CLOUDFLARE_CACHE_ZONE_ID?.trim(); const token = this.env.CLOUDFLARE_CACHE_PURGE_TOKEN?.trim();
        const zoneHost = this.env.CLOUDFLARE_CACHE_ZONE_HOST?.trim();
        if (!zone || !/^[a-f0-9]{32}$/.test(zone) || !token || !zoneHost
          || custom.some((u) => u.hostname !== zoneHost && !u.hostname.endsWith(`.${zoneHost}`))) throw new DeliveryFailure("cache_permissions_required");
        const response = await this.fetchImpl(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ prefixes }), redirect: "error", signal: AbortSignal.timeout(15000),
        });
        const body: unknown = await response.json();
        if (!response.ok || !body || typeof body !== "object" || !("success" in body) || body.success !== true) throw new DeliveryFailure("cache_purge_failed");
        report.cache = { status: "purged", prefixes };
      } catch (error) { report.cache = { status: "failed", prefixes, code: deliveryErrorCode(error) }; }
    }
    for (const base of bases) for (const image of target.images) {
      const url = `${base}/${image.key}`;
      for (const probe of ["normal", "query", "origin"]) {
        const probeUrl = probe === "query" ? `${url}?card-probe=1` : url;
        try {
          // Same URLs, normal cache semantics. A cache-buster/no-cache request
          // would hide a still-serving edge copy and is not revocation proof.
          const response = await this.fetchImpl(probeUrl, { redirect: "error", signal: AbortSignal.timeout(15000), headers: {
            "User-Agent": probe === "query" ? "Twitterbot/1.0" : "Mozilla/5.0",
            ...(probe === "origin" ? { Origin: new URL(base).origin } : {}),
          } });
          const bytes = new Uint8Array(await response.arrayBuffer());
          report.public.push({ url: probeUrl, probe, blocked: blocked(response.status), status: response.status,
            sha256: createHash("sha256").update(bytes).digest("hex"), cacheStatus: response.headers.get("cf-cache-status") ?? "absent" });
        } catch (error) { report.public.push({ url: probeUrl, probe, blocked: false, code: deliveryErrorCode(error) }); }
      }
    }
    return report;
  }
  private async origin(url: string, method: "HEAD" | "DELETE") {
    const request = await this.client.sign(url, { method, signal: AbortSignal.timeout(15000) });
    const response = await this.fetchImpl(request); await response.arrayBuffer(); return response;
  }
}

export function getCardDelivery(env: Record<string, string | undefined> = process.env): CardDelivery {
  const config = readR2Config(env);
  if (!config) throw new DeliveryFailure("storage_not_configured");
  return new R2CardDelivery(config, env);
}
