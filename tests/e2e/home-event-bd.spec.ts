import "./helpers/env";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { Client } from "pg";
import { pointsAtDevProject } from "../../scripts/dev-db-guard.mjs";

test("home, event and purchase stay consistent after bonus changes", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  test.skip(!process.env.ADMIN_PASSWORD, "ADMIN_PASSWORD is required");
  test.skip(!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname), "Fixture test requires a local app");
  if (!pointsAtDevProject(process.env.DATABASE_URL ?? "") || !pointsAtDevProject(process.env.DATABASE_URL_UNPOOLED ?? "")) throw new Error("Both database URLs must point at dev");
  const db = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  const tag = `home-bd-e2e-${randomUUID()}`;
  let albumId: string | undefined;
  let eventId: string | undefined;
  let songId: string | undefined;
  let itemId: string | undefined;
  const listing = randomUUID(), otherListing = randomUUID(), base = randomUUID(), first = randomUUID(), second = randomUUID();
  try {
    await db.connect();
    albumId = (await db.query('INSERT INTO "Album" (slug, type, "originalTitle") VALUES ($1, \'live_album\', $1) RETURNING id', [tag])).rows[0].id;
    eventId = (await db.query('INSERT INTO "Event" (slug, type, status, "startTime", "originalName", "bdAlbumId") VALUES ($1, \'concert\', \'completed\', NOW() - interval \'10 minutes\', $1, $2) RETURNING id', [`${tag}-event`, albumId])).rows[0].id;
    songId = (await db.query('INSERT INTO "Song" (slug, "originalTitle") VALUES ($1, $1) RETURNING id', [`${tag}-song`])).rows[0].id;
    itemId = (await db.query('INSERT INTO "SetlistItem" ("eventId", position) VALUES ($1, 1) RETURNING id', [eventId])).rows[0].id;
    await db.query('INSERT INTO "SetlistItemSong" (id, "setlistItemId", "songId") VALUES ($1, $2, $3)', [randomUUID(), itemId, songId]);
    for (const [id, bonus, url] of [[listing, true, "https://example.com/bonus"], [otherListing, true, "https://example.com/other"], [base, false, "https://www.amazon.co.jp/dp/B000000002"]] as const) {
      await db.query('INSERT INTO "AlbumStoreListing" (id, "albumId", "originalStoreName", "storeKey", "optionKey", status, "productUrl", "includesPerformanceVideo", "isBonusOption", "updatedAt") VALUES ($1, $2, $3, $4, $1, \'active\', $5, true, $6, NOW())', [id, albumId, `${tag}-store`, tag, url, bonus]);
    }
    for (const [id, listingId] of [[first, listing], [second, otherListing]]) await db.query('INSERT INTO "AlbumStoreBonus" (id, "listingId", "originalBonusType", "updatedAt") VALUES ($1, $2, $1, NOW())', [id, listingId]);
    expect((await page.request.post("/api/admin/login", { data: { password: process.env.ADMIN_PASSWORD } })).ok()).toBeTruthy();
    const eventUrl = `/ko/events/${eventId}/${tag}-event`;
    const check = async (active: string[]) => {
      await page.goto("/ko");
      await expect(page.locator(`a[href="${eventUrl}"]`)).toBeVisible();
      const badge = page.getByTestId("home-bd-bonus").and(page.locator(`a[href*="/albums/${albumId}/"]`));
      if (active.length) {
        await expect(badge).toBeVisible();
        await badge.click();
        await expect(page).toHaveURL(`${baseURL}/ko/albums/${albumId}/${tag}?tab=bonus`);
      } else await expect(badge).toHaveCount(0);
      await page.goto(eventUrl);
      await expect(page.getByTestId("event-bd-summary")).toBeVisible();
      await expect(page.getByTestId("event-bd-summary")).toHaveAttribute("data-bonus-store-count", active.length ? "1" : "0");
      await expect(page.getByTestId("event-bd-purchase")).toBeVisible();
      await expect(page.getByTestId("event-bd-purchase")).toHaveText(active.length ? "구매처·특전 보기 →" : "구매처 보기 →");
      await page.getByTestId("event-bd-purchase").click();
      await expect(page).toHaveURL(`${baseURL}/ko/albums/${albumId}/${tag}?tab=bonus`);
      for (const id of [first, second]) {
        if (active.includes(id)) await expect(page.getByText(id, { exact: true })).toBeVisible();
        else await expect(page.getByText(id, { exact: true })).toHaveCount(0);
      }
      await expect(page.locator('a[href^="https://www.amazon.co.jp/dp/B000000002"]')).toBeVisible();
    };
    const change = async (id: string, action: "end" | "restore", label: string) => {
      const listingId = id === first ? listing : otherListing;
      const url = `/api/admin/album-bonuses/${id}/lifecycle`;
      const read = await page.request.get(`${url}?listingId=${listingId}`);
      expect(read.status()).toBe(200);
      const { state } = await read.json();
      const response = await page.request.post(url, { data: {
        listingId, operationId: randomUUID(), expectedRevision: state.revision,
        expectedListingRevision: state.listingRevision, action,
        evidenceUrl: `https://example.com/${label}`, summary: `${tag}-${label}`,
        observedAt: new Date().toISOString(), ...(action === "restore" && { startsAt: null, endsAt: null }),
      } });
      expect(response.status()).toBe(200);
      expect((await response.json()).cache).toBe("invalidated");
    };
    // Invalidate any home entry from a preceding run after inserting this fixture.
    await change(first, "end", "setup-end");
    await change(first, "restore", "setup-restore");
    await check([first, second]);
    await change(first, "end", "end-first");
    await check([second]);
    await change(second, "end", "end-second");
    await check([]);
    await change(first, "restore", "restore-first");
    const history = await (await page.request.get(`/api/admin/album-bonuses/${first}/lifecycle?listingId=${listing}`)).json();
    expect(history.history.map((entry: { summary: string }) => entry.summary)).toEqual(expect.arrayContaining([`${tag}-end-first`, `${tag}-restore-first`]));
    await check([first]);
  } finally {
    try {
      if (itemId) {
        await db.query('DELETE FROM "SetlistItemSong" WHERE "setlistItemId" = $1', [itemId]);
        await db.query('DELETE FROM "SetlistItem" WHERE id = $1 AND "eventId" = $2', [itemId, eventId]);
      }
      if (eventId) await db.query('DELETE FROM "Event" WHERE id = $1 AND slug = $2', [eventId, `${tag}-event`]);
      if (songId) await db.query('DELETE FROM "Song" WHERE id = $1 AND slug = $2', [songId, `${tag}-song`]);
      if (albumId) {
        await db.query('DELETE FROM "AlbumStoreBonusLifecycleOperation" WHERE "bonusId" IN ($1, $2)', [first, second]);
        await db.query('DELETE FROM "Album" WHERE id = $1 AND slug = $2', [albumId, tag]);
      }
    } finally {
      await db.end();
    }
  }
});
