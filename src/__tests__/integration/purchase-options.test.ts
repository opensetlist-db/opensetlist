import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/admin-auth", () => ({ verifyAdminAPI: vi.fn(async () => null) }));
vi.mock("@/lib/dataCache", () => ({ revalidatePublicData: vi.fn() }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));

import { prisma } from "@/lib/prisma";
import { POST as createListing } from "@/app/api/admin/album-listings/route";
import { PATCH as updateBonus } from "@/app/api/admin/album-bonuses/[id]/route";
import { POST as createBonus } from "@/app/api/admin/album-bonuses/route";
import { POST as createJob } from "@/app/api/admin/album-bonuses/import/route";
import { PATCH as reviewJob } from "@/app/api/admin/album-bonuses/import/[jobId]/route";
import { POST as applyJob } from "@/app/api/admin/album-bonuses/import/[jobId]/apply/route";
import { AlbumPurchasePanel, type AlbumForPurchase } from "@/components/albums/detail/AlbumPurchasePanel";

const tag = `purchase-itest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let albumId: bigint;

function request(path: string, body: unknown, method = "POST") {
  return new NextRequest(`http://localhost${path}`, {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
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
  await prisma.albumBonusImportJob.deleteMany({ where: { albumId } });
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
        translations: [
          { locale: "ko", storeName: "검증 매장" },
          { locale: "en", storeName: "Fixture shop" },
        ],
      }));
      expect(response.status).toBe(201);
      const listing = await response.json();
      const bonus = await createBonus(request("/api/admin/album-bonuses", {
        listingId: listing.id, originalBonusType: guide, startsAt: null,
        endsAt: guide === "Choice A" ? "2026-11-10T00:00:00+09:00" : null,
        originalBonusDescription: "２枚セット",
        translations: [
          { locale: "ko", bonusType: guide + " Korean", bonusDescription: "2장 세트" },
          { locale: "en", bonusType: guide + " English", bonusDescription: "Set of two" },
        ],
      }));
      expect(bonus.status).toBe(201);
      if (guide === "Choice B") {
        const { id } = await bonus.json();
        await prisma.albumStoreBonusTranslation.createMany({ data: [
          { bonusId: id, locale: "ja", bonusType: "Existing title" },
        ] });
        const stale = await updateBonus(request("/api/admin/album-bonuses/" + id, {
          originalBonusDescription: "３枚セット", expectedRevision: 0,
        }, "PATCH"), { params: Promise.resolve({ id }) });
        expect(stale.status).toBe(400);
        expect(await prisma.albumStoreBonus.findUnique({ where: { id } })).toMatchObject({
          originalBonusDescription: "２枚セット", revision: 0,
        });
        const updated = await updateBonus(request("/api/admin/album-bonuses/" + id, {
          originalBonusType: guide, expectedRevision: 0, translations: [{ locale: "ko", bonusType: "Choice B localized" }],
        }, "PATCH"), { params: Promise.resolve({ id }) });
        expect(updated.status).toBe(200);
        expect((await updated.json()).translations).toEqual(expect.arrayContaining([
          expect.objectContaining({ locale: "ko", bonusType: "Choice B localized", bonusDescription: "2장 세트" }),
          expect.objectContaining({ locale: "ja", bonusType: "Existing title" }),
        ]));
      }
    }
    const saved = await prisma.album.findUniqueOrThrow({ where: { id: albumId }, include: {
      listings: { include: { translations: true, bonuses: { include: { translations: true } } } },
    } });
    const album = JSON.parse(JSON.stringify(saved, (_key, value) => typeof value === "bigint" ? String(value) : value)) as AlbumForPurchase;
    const before = renderToStaticMarkup(await AlbumPurchasePanel({ album, locale: "ko", now: new Date("2026-11-09T14:59:59.999Z"), performanceOnly: true }));
    const at = renderToStaticMarkup(await AlbumPurchasePanel({ album, locale: "ko", now: new Date("2026-11-09T15:00:00Z"), performanceOnly: true }));
    expect(before).toContain("Choice A");
    expect(before).toContain("Choice B");
    const unfiltered = renderToStaticMarkup(await AlbumPurchasePanel({ album, locale: "ko", now: new Date("2026-11-09T14:59:59.999Z") }));
    expect(unfiltered).toContain("CD only");
    expect(before).not.toContain("CD only");
    expect(at).not.toContain("Choice A");
    expect(at).toContain("Choice B");
    expect(at).toContain("검증 매장");
    expect(at).toContain("2장 세트");
    expect(at).not.toContain("２枚セット");
    expect(at).toContain(productUrl);
  });

  it("keeps an incomplete approved job pending and applies a corrected job to a fresh purchase render", async () => {
    const source = {
      originalStoreName: "試験店舗",
      originalEditionLabel: null,
      productUrl: "https://example.com/import",
      translations: [
        { locale: "ko", storeName: "임포트 상점" },
        { locale: "en", storeName: "Import Store" },
      ],
    };
    const bonus = {
      originalBonusType: "ポスター",
      originalBonusDescription: "A3判２枚セット",
      bonusImageUrl: null,
    };
    const submit = async (translations: { locale: string; bonusType: string; bonusDescription: string }[]) => {
      const created = await createJob(request("/api/admin/album-bonuses/import", {
        albumId: String(albumId),
        candidates: {
          listings: [{ ...source, bonuses: [{ ...bonus, translations }] }],
          globalEarlyBooking: null,
          warnings: [],
        },
      }));
      expect(created.status).toBe(201);
      const { job } = await created.json();
      const context = { params: Promise.resolve({ jobId: job.id as string }) };
      const reviewed = await reviewJob(request("/api/admin/album-bonuses/import", {
        decisions: {
          listings: { 0: { approved: true } },
          bonuses: { "0:0": { approved: true } },
          globalEarlyBooking: null,
        },
      }, "PATCH"), context);
      expect(reviewed.status).toBe(200);
      const result = await applyJob(request("/api/admin/album-bonuses/import/apply", {}), context);
      return { result, id: job.id as string };
    };

    const incomplete = await submit([]);
    expect(incomplete.result.status).toBe(400);
    expect(await prisma.albumBonusImportJob.findUnique({ where: { id: incomplete.id } })).toMatchObject({
      status: "pending", appliedAt: null,
    });
    expect(await prisma.albumStoreListing.count({ where: { albumId, originalStoreName: source.originalStoreName } })).toBe(0);

    const complete = await submit([
      { locale: "ko", bonusType: "포스터", bonusDescription: "A3 크기 2장 세트" },
      { locale: "en", bonusType: "Posters", bonusDescription: "Set of two A3 posters" },
    ]);
    expect(complete.result.status).toBe(200);
    const saved = await prisma.album.findUniqueOrThrow({ where: { id: albumId }, include: {
      listings: { include: { translations: true, bonuses: { include: { translations: true } } } },
    } });
    const album = JSON.parse(JSON.stringify(saved, (_key, value) => typeof value === "bigint" ? String(value) : value)) as AlbumForPurchase;
    const english = renderToStaticMarkup(await AlbumPurchasePanel({ album, locale: "en" }));
    expect(english).toContain("試験店舗");
    expect(english).toContain("Import Store");
    expect(english).toContain("Set of two A3 posters");
    expect(english).not.toContain("A3判２枚セット");
  });
});
