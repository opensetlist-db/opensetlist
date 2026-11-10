import "./helpers/env";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { Client } from "pg";
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
  const db = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  const tag = `bonus-lifecycle-e2e-${randomUUID()}`;
  let albumId: string | undefined;
  let eventId: string | undefined;
  try {
    await db.connect();
    const album = await db.query('INSERT INTO "Album" (slug, type, "originalTitle") VALUES ($1, $2, $1) RETURNING id', [tag, "live_album"]);
    albumId = album.rows[0].id;
    const event = await db.query('INSERT INTO "Event" (slug, type, "startTime", "originalName", "bdAlbumId") VALUES ($1, \'concert\', $2, $1, $3) RETURNING id', [`${tag}-event`, "2099-01-01T00:00:00Z", albumId]);
    eventId = event.rows[0].id;
    const listing = { id: randomUUID() };
    const base = randomUUID();
    const other = randomUUID();
    const audio = randomUUID();
    for (const [id, name, url, isBonus, video] of [
      [listing.id, `${tag}-store`, "https://www.amazon.co.jp/dp/B000000001", true, true],
      [base, `${tag}-base`, "https://www.amazon.co.jp/dp/B000000002", false, true],
      [other, `${tag}-other-store`, "https://example.com/other", true, true],
      [audio, `${tag}-audio-store`, "https://example.com/audio", true, false],
    ] as const) {
      await db.query('INSERT INTO "AlbumStoreListing" (id, "albumId", "originalStoreName", status, "productUrl", "includesPerformanceVideo", "isBonusOption", "updatedAt") VALUES ($1, $2, $3, \'active\', $4, $5, $6, NOW())', [id, albumId, name, url, video, isBonus]);
    }
    const target = { id: randomUUID() };
    const sibling = { id: randomUUID() };
    for (const [id, listingId, name] of [
      [target.id, listing.id, `${tag}-target`], [sibling.id, listing.id, `${tag}-sibling`], [randomUUID(), other, `${tag}-other`], [randomUUID(), audio, `${tag}-audio`],
    ]) {
      await db.query('INSERT INTO "AlbumStoreBonus" (id, "listingId", "originalBonusType", "updatedAt") VALUES ($1, $2, $3, NOW())', [id, listingId, name]);
    }

    expect((await page.request.post("/api/admin/login", { data: { password: process.env.ADMIN_PASSWORD } })).ok()).toBeTruthy();
    const adminUrl = `/admin/albums/${albumId}/listings/${listing.id}/bonuses`;
    const publicUrl = `/ko/albums/${albumId}/${tag}?tab=bonus`;
    await page.goto(publicUrl);
    await expect(page.getByText(`${tag}-target`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${tag}-sibling`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${tag}-other`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${tag}-audio`, { exact: true })).toHaveCount(0);
    await expect(page.locator('a[href^="https://www.amazon.co.jp/dp/B000000002"]')).toBeVisible();
    await page.goto(adminUrl);
    await page.getByTestId(`bonus-lifecycle-open-${target.id}`).click();
    const publicPopup = page.waitForEvent("popup");
    await page.getByTestId("bonus-lifecycle-purchase-link").click();
    const popup = await publicPopup;
    await popup.waitForLoadState();
    await expect(popup.getByText(`${tag}-target`, { exact: true })).toBeVisible();
    await popup.close();
    await page.getByTestId("bonus-lifecycle-evidence").fill("https://example.com/end");
    await page.getByTestId("bonus-lifecycle-summary").fill(`${tag}-ended`);
    await page.getByTestId("bonus-lifecycle-observed-at").fill(new Date().toISOString());
    let originalRequest = "";
    await page.route(`**/api/admin/album-bonuses/${target.id}/lifecycle`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      originalRequest = route.request().postData() ?? "";
      await route.abort();
    }, { times: 1 });
    await page.getByTestId("bonus-lifecycle-submit").click();
    await expect(page.getByTestId("bonus-lifecycle-retry")).toBeVisible();
    const endResponse = page.waitForResponse((r) => r.url().endsWith(`/${target.id}/lifecycle`) && r.request().method() === "POST");
    await page.getByTestId("bonus-lifecycle-retry").click();
    expect((await endResponse).request().postData()).toBe(originalRequest);
    expect((await endResponse).status()).toBe(200);
    await page.goto(publicUrl);
    await expect(page.getByText(`${tag}-target`, { exact: true })).toHaveCount(0);
    await expect(page.getByText(`${tag}-sibling`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${tag}-other`, { exact: true })).toBeVisible();
    await expect(page.locator('a[href^="https://www.amazon.co.jp/dp/B000000002"]')).toBeVisible();

    await page.goto(adminUrl);
    await page.getByTestId(`bonus-lifecycle-open-${sibling.id}`).click();
    await page.getByTestId("bonus-lifecycle-evidence").fill("https://example.com/end-sibling");
    await page.getByTestId("bonus-lifecycle-summary").fill(`${tag}-sibling-ended`);
    await page.getByTestId("bonus-lifecycle-observed-at").fill(new Date().toISOString());
    await page.route(`**/api/admin/album-bonuses/${sibling.id}/lifecycle`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fetch();
      await route.abort();
    });
    await page.getByTestId("bonus-lifecycle-submit").click();
    await expect(page.getByTestId("bonus-lifecycle-status")).toContainText("응답이 유실되었지만 요청은 반영되었습니다");
    await expect(page.getByTestId("bonus-lifecycle-history")).toContainText(`${tag}-sibling-ended`);
    await page.unrouteAll();
    await page.goto(publicUrl);
    await expect(page.getByText(`${tag}-sibling`, { exact: true })).toHaveCount(0);
    await expect(page.locator('a[href^="https://www.amazon.co.jp/dp/B000000002"]')).toBeVisible();
    await expect(page.getByText(`${tag}-other`, { exact: true })).toBeVisible();

    await page.goto(adminUrl);
    await page.getByTestId(`bonus-lifecycle-open-${target.id}`).click();
    await page.getByTestId("bonus-lifecycle-evidence").fill("https://example.com/restore");
    await page.getByTestId("bonus-lifecycle-summary").fill(`${tag}-restored`);
    await page.getByTestId("bonus-lifecycle-observed-at").fill(new Date().toISOString());
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
    if (eventId) await db.query('DELETE FROM "Event" WHERE id = $1 AND slug = $2', [eventId, `${tag}-event`]);
    if (albumId) {
      await db.query('DELETE FROM "AlbumStoreBonusLifecycleOperation" WHERE "bonusId" IN (SELECT b.id FROM "AlbumStoreBonus" b JOIN "AlbumStoreListing" l ON l.id = b."listingId" WHERE l."albumId" = $1)', [albumId]);
      await db.query('DELETE FROM "Album" WHERE id = $1 AND slug = $2', [albumId, tag]);
    }
    await db.end();
  }
});
