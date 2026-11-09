import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/admin-auth", () => ({ verifyAdminAPI: vi.fn(async () => null) }));
vi.mock("@/lib/dataCache", () => ({ revalidatePublicData: vi.fn() }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));

import { prisma } from "@/lib/prisma";
import { POST as createListing } from "@/app/api/admin/album-listings/route";
import { POST as createBonus } from "@/app/api/admin/album-bonuses/route";
import { AlbumPurchasePanel, type AlbumForPurchase } from "@/components/albums/detail/AlbumPurchasePanel";

const tag = `purchase-itest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let albumId: bigint;

function request(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const album = await prisma.album.create({ data: { slug: tag, type: "live_album", originalTitle: tag } });
  albumId = album.id;
});

afterAll(async () => {
  if (!albumId) return;
  const listings = await prisma.albumStoreListing.findMany({ where: { albumId }, select: { id: true } });
  const ids = listings.map(({ id }) => id);
  const bonuses = await prisma.albumStoreBonus.findMany({ where: { listingId: { in: ids } }, select: { id: true } });
  await prisma.albumStoreBonusTranslation.deleteMany({ where: { bonusId: { in: bonuses.map(({ id }) => id) } } });
  await prisma.albumStoreBonus.deleteMany({ where: { listingId: { in: ids } } });
  await prisma.albumStoreListingTranslation.deleteMany({ where: { listingId: { in: ids } } });
  await prisma.albumStoreListing.deleteMany({ where: { albumId } });
  await prisma.album.delete({ where: { id: albumId } });
});

describe("admin purchase options to public purchase tab", () => {
  it("saves separate choices at one URL, excludes CD-only, and shows only unexpired benefits", async () => {
    const productUrl = "https://example.com/product";
    for (const [guide, hasVideo] of [["Choice A", true], ["Choice B", true], ["CD only", false]] as const) {
      const response = await createListing(request("/api/admin/album-listings", {
        albumId: String(albumId), originalStoreName: "Fixture store", originalEditionLabel: "Limited",
        status: "active", productUrl, includesPerformanceVideo: hasVideo, isBonusOption: true,
        storeKey: "fixture", officialOrder: 1, selectionGuide: guide,
      }));
      expect(response.status).toBe(201);
      const listing = await response.json();
      const bonus = await createBonus(request("/api/admin/album-bonuses", {
        listingId: listing.id, originalBonusType: guide, startsAt: null,
        endsAt: guide === "Choice A" ? "2026-11-10T00:00:00+09:00" : null,
      }));
      expect(bonus.status).toBe(201);
    }
    const saved = await prisma.album.findUniqueOrThrow({ where: { id: albumId }, include: {
      listings: { include: { translations: true, bonuses: { include: { translations: true } } } },
    } });
    const album = JSON.parse(JSON.stringify(saved, (_key, value) => typeof value === "bigint" ? String(value) : value)) as AlbumForPurchase;
    const before = renderToStaticMarkup(await AlbumPurchasePanel({ album, locale: "ko", now: new Date("2026-11-09T14:59:59.999Z"), performanceOnly: true }));
    const at = renderToStaticMarkup(await AlbumPurchasePanel({ album, locale: "ko", now: new Date("2026-11-09T15:00:00Z"), performanceOnly: true }));
    expect(before).toContain("Choice A");
    expect(before).toContain("Choice B");
    expect(before).not.toContain("CD only");
    expect(at).not.toContain("Choice A");
    expect(at).toContain("Choice B");
    expect(at).toContain(productUrl);
  });
});
