import "./helpers/env";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import { Client } from "pg";
import { pointsAtDevProject } from "../../scripts/dev-db-guard.mjs";

test("home, event and purchase stay consistent after bonus changes", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  test.skip(!process.env.ADMIN_PASSWORD, "ADMIN_PASSWORD is required");
  test.skip(!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname), "Fixture test requires a local app");
  const sessionUrl = process.env.DATABASE_URL_UNPOOLED;
  if (!pointsAtDevProject(process.env.DATABASE_URL ?? "") || !sessionUrl || !pointsAtDevProject(sessionUrl) ||
      (new URL(sessionUrl).port || "5432") !== "5432") throw new Error("Both database URLs must point at dev, with DATABASE_URL_UNPOOLED on the session port");
  const db = new Client({ connectionString: sessionUrl });
  const tag = `home-bd-e2e-${randomUUID()}`;
  const listing = randomUUID(), otherListing = randomUUID(), base = randomUUID(), first = randomUUID(), second = randomUUID();
  const fixture = { tag, songLinkId: randomUUID(), listingIds: [listing, otherListing, base], bonusIds: [first, second] };
  const receiptDir = ".claude/tmp/home-bd-fixtures";
  mkdirSync(receiptDir, { recursive: true });
  const receipt = join(receiptDir, `${tag}.json`);
  writeFileSync(receipt, JSON.stringify(fixture), { flag: "wx", flush: true });
  console.log(`BD fixture recovery receipt: ${receipt}`);
  await db.connect();
  try {
    const albumId = (await db.query('INSERT INTO "Album" (slug, type, "originalTitle") VALUES ($1, \'live_album\', $1) RETURNING id', [tag])).rows[0].id;
    const eventId = (await db.query('INSERT INTO "Event" (slug, type, status, "startTime", "originalName", "bdAlbumId") VALUES ($1, \'concert\', \'completed\', NOW() - interval \'10 minutes\', $1, $2) RETURNING id', [`${tag}-event`, albumId])).rows[0].id;
    const songId = (await db.query('INSERT INTO "Song" (slug, "originalTitle") VALUES ($1, $1) RETURNING id', [`${tag}-song`])).rows[0].id;
    await db.query(
      `WITH item AS (INSERT INTO "SetlistItem" ("eventId", position) VALUES ($1, 1) RETURNING id)
       INSERT INTO "SetlistItemSong" (id, "setlistItemId", "songId") SELECT $2, id, $3 FROM item`,
      [eventId, fixture.songLinkId, songId],
    );
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
      await promisify(execFile)(process.execPath, ["scripts/db-home-bd-fixture-rm.mjs", receipt], { timeout: 45_000 });
    } finally {
      await db.end();
    }
  }
});
