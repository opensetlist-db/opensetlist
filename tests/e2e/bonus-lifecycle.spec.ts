import "./helpers/env";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { pointsAtDevProject } from "../../scripts/dev-db-guard.mjs";

test("admin ends and restores one bonus on the public purchase tab", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  test.skip(!process.env.ADMIN_PASSWORD, "ADMIN_PASSWORD is required");
  if (!pointsAtDevProject(process.env.DATABASE_URL ?? "") || !pointsAtDevProject(process.env.DATABASE_URL_UNPOOLED ?? "")) {
    throw new Error("Both database URLs must point at the dev Supabase project");
  }
  if (!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) {
    throw new Error("This fixture-writing test requires a local app");
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const tag = `bonus-lifecycle-e2e-${randomUUID()}`;
  let albumId: bigint | undefined;
  try {
    const album = await prisma.album.create({ data: { slug: tag, type: "live_album", originalTitle: tag } });
    albumId = album.id;
    const listing = await prisma.albumStoreListing.create({ data: {
      albumId, originalStoreName: `${tag}-store`, status: "active", productUrl: "https://www.amazon.co.jp/dp/B000000001",
      includesPerformanceVideo: true, isBonusOption: true,
    } });
    await prisma.albumStoreListing.create({ data: {
      albumId, originalStoreName: `${tag}-base`, status: "active", productUrl: "https://www.amazon.co.jp/dp/B000000001",
      includesPerformanceVideo: true, isBonusOption: false,
    } });
    const other = await prisma.albumStoreListing.create({ data: {
      albumId, originalStoreName: `${tag}-other-store`, status: "active", productUrl: "https://example.com/other",
      includesPerformanceVideo: true, isBonusOption: true,
    } });
    const target = await prisma.albumStoreBonus.create({ data: { listingId: listing.id, originalBonusType: `${tag}-target` } });
    const sibling = await prisma.albumStoreBonus.create({ data: { listingId: listing.id, originalBonusType: `${tag}-sibling` } });
    await prisma.albumStoreBonus.create({ data: { listingId: other.id, originalBonusType: `${tag}-other` } });

    expect((await page.request.post("/api/admin/login", { data: { password: process.env.ADMIN_PASSWORD } })).ok()).toBeTruthy();
    const adminUrl = `/admin/albums/${albumId}/listings/${listing.id}/bonuses`;
    const publicUrl = `/ko/albums/${albumId}/${tag}?tab=bonus`;
    await page.goto(publicUrl);
    await expect(page.getByText(`${tag}-target`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${tag}-sibling`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${tag}-other`, { exact: true })).toBeVisible();
    await expect(page.locator('a[href^="https://www.amazon.co.jp/dp/B000000001"]').first()).toBeVisible();
    await page.goto(adminUrl);
    await page.getByTestId(`bonus-lifecycle-open-${target.id}`).click();
    const publicPopup = page.waitForEvent("popup");
    await page.getByRole("link", { name: "공개 구매 탭 새로 열기" }).click();
    const popup = await publicPopup;
    await popup.waitForLoadState();
    await expect(popup.getByText(`${tag}-target`, { exact: true })).toBeVisible();
    await popup.close();
    await page.getByLabel("근거 URL").fill("https://example.com/end");
    await page.getByLabel("관찰 요약").fill(`${tag}-ended`);
    await page.getByLabel("관찰 시각 (ISO 8601)").fill(new Date().toISOString());
    const endResponse = page.waitForResponse((r) => r.url().endsWith(`/${target.id}/lifecycle`) && r.request().method() === "POST");
    await page.getByTestId("bonus-lifecycle-submit").click();
    expect((await endResponse).status()).toBe(200);
    await page.goto(publicUrl);
    await expect(page.getByText(`${tag}-target`, { exact: true })).toHaveCount(0);
    await expect(page.getByText(`${tag}-sibling`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${tag}-other`, { exact: true })).toBeVisible();
    await expect(page.locator('a[href^="https://www.amazon.co.jp/dp/B000000001"]').first()).toBeVisible();

    await page.goto(adminUrl);
    await page.getByTestId(`bonus-lifecycle-open-${sibling.id}`).click();
    await page.getByLabel("근거 URL").fill("https://example.com/end-sibling");
    await page.getByLabel("관찰 요약").fill(`${tag}-sibling-ended`);
    await page.getByLabel("관찰 시각 (ISO 8601)").fill(new Date().toISOString());
    await page.route(`**/api/admin/album-bonuses/${sibling.id}/lifecycle`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fetch();
      await route.abort();
    });
    await page.getByTestId("bonus-lifecycle-submit").click();
    await expect(page.getByRole("status")).toContainText("응답이 유실되었지만 요청은 반영되었습니다");
    await expect(page.getByTestId("bonus-lifecycle-history")).toContainText(`${tag}-sibling-ended`);
    await page.unrouteAll();
    await page.goto(publicUrl);
    await expect(page.getByText(`${tag}-sibling`, { exact: true })).toHaveCount(0);
    await expect(page.locator('a[href^="https://www.amazon.co.jp/dp/B000000001"]')).toBeVisible();
    await expect(page.getByText(`${tag}-other`, { exact: true })).toBeVisible();

    await page.goto(adminUrl);
    await page.getByTestId(`bonus-lifecycle-open-${target.id}`).click();
    await page.getByLabel("근거 URL").fill("https://example.com/restore");
    await page.getByLabel("관찰 요약").fill(`${tag}-restored`);
    await page.getByLabel("관찰 시각 (ISO 8601)").fill(new Date().toISOString());
    const restoreResponse = page.waitForResponse((r) => r.url().endsWith(`/${target.id}/lifecycle`) && r.request().method() === "POST");
    await page.getByTestId("bonus-lifecycle-submit").click();
    expect((await restoreResponse).status()).toBe(200);
    await expect(page.getByTestId("bonus-lifecycle-history")).toContainText(`${tag}-ended`);
    await expect(page.getByTestId("bonus-lifecycle-history")).toContainText(`${tag}-restored`);
    await page.goto(publicUrl);
    await expect(page.getByText(`${tag}-target`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${tag}-sibling`, { exact: true })).toHaveCount(0);
    await expect(page.getByText(`${tag}-other`, { exact: true })).toBeVisible();
  } finally {
    if (albumId) {
      const listings = await prisma.albumStoreListing.findMany({ where: { albumId }, select: { id: true } });
      const ids = listings.map((l) => l.id);
      const bonuses = await prisma.albumStoreBonus.findMany({ where: { listingId: { in: ids } }, select: { id: true } });
      await prisma.albumStoreBonusLifecycleOperation.deleteMany({ where: { bonusId: { in: bonuses.map((b) => b.id) } } });
      await prisma.albumStoreBonus.deleteMany({ where: { listingId: { in: ids } } });
      await prisma.albumStoreListing.deleteMany({ where: { albumId } });
      await prisma.album.delete({ where: { id: albumId } });
    }
    await prisma.$disconnect();
  }
});
