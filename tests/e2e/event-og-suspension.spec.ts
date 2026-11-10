import { test, expect } from "@playwright/test";
import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
config({ path: [".env.local", ".env"], quiet: true });
const enabled = process.env.EVENT_CARD_R2_E2E === "1";
const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3195";
const imageBase = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, "");
let fixture: { eventId: string; slug: string; folder: string; published: { mode: string; revision: string; urls: Record<string, string>; hashes: Record<string, string> }[] };
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function helper(action: string) {
  const run = spawnSync(process.execPath, ["tests/e2e/helpers/event-og-fixture.mjs", action], { cwd: process.cwd(), encoding: "utf8", timeout: 300000,
    env: { ...process.env, EVENT_CARD_E2E_SUITE: "suspension", NEXT_PUBLIC_BASE_URL: BASE, TEST_BASE_URL: BASE } });
  expect(run.status, run.stderr).toBe(0); return JSON.parse(run.stdout);
}
test.describe("owned image public suspension and readable neutral notices", () => {
  test.skip(!enabled, "opt-in dev DB/bucket/test namespace; nine synthetic PNGs, three explicitly revoked");
  test.beforeAll(() => {
    test.setTimeout(300000);
    if (!imageBase || !/^pub-[a-f0-9]{32}\.r2\.dev$/.test(new URL(imageBase).hostname)) throw new Error("This real revocation test is limited to uncached dev r2.dev");
    fixture = helper("prepare"); console.log("[event-og-suspension-e2e] evidence", fixture.folder);
  });
  test.afterAll(() => { if (enabled) helper("cleanup"); });
  test("applies neutral notices during partial failure, then revokes exactly the original three public images and preserves neighboring modes", async ({ request, browser }) => {
    test.setTimeout(240000);
    const target = fixture.published.find((p) => p.mode === "prediction")!;
    const operation = randomUUID(); const reasonFile = path.join(fixture.folder, "suspension-reason.txt");
    await writeFile(reasonFile, "Private synthetic QA-only suspension request");
    const suspend = (inventory: string, op = operation) => spawnSync(process.execPath, ["scripts/event-og.mjs", "suspend", "--event", fixture.eventId,
      "--mode", "prediction", "--revision", target.revision, "--expected-version", "0", "--operation", op, "--reason-file", reasonFile], {
      cwd: process.cwd(), encoding: "utf8", timeout: 180000, env: { ...process.env, EVENT_CARD_DELIVERY_BASES: inventory, NEXT_PUBLIC_BASE_URL: BASE },
    });
    const imageUrls: Record<string, string> = {};
    for (const locale of ["ja", "ko", "en"]) {
      const response = await request.get(target.urls[locale]); expect(response.status()).toBe(200);
      const html = await response.text(); expect(html).toContain("/event-share-navigation.js");
      imageUrls[locale] = html.match(/property="og:image" content="([^"]+)"/)![1];
      for (const url of [imageUrls[locale], `${imageUrls[locale]}?card-probe=1`]) {
        const png = await request.get(url); expect(png.status()).toBe(200); expect(hash(await png.body())).toBe(target.hashes[locale]);
      }
    }
    const partial = suspend(""); expect(partial.status, partial.stderr).toBe(1);
    const partialResult = JSON.parse(partial.stdout); expect(partialResult).toMatchObject({ status: "partial", safeNoticeApplied: true });
    await writeFile(path.join(fixture.folder, "suspension-partial.json"), partial.stdout);
    for (const locale of ["ja", "ko", "en"]) {
      const safe = await request.get(target.urls[locale]); expect(safe.status()).toBe(200);
      expect(await safe.text()).not.toContain(imageUrls[locale]);
      const stillAvailable = await request.get(imageUrls[locale]); expect(stillAvailable.status()).toBe(200);
      expect(hash(await stillAvailable.body())).toBe(target.hashes[locale]);
    }
    const stopped = suspend(JSON.stringify([imageBase]));
    await writeFile(path.join(fixture.folder, "suspension-complete.json"), stopped.stdout || stopped.stderr);
    expect(stopped.status, stopped.stderr).toBe(0);
    const completed = JSON.parse(stopped.stdout); expect(completed).toMatchObject({ status: "suspended", safeNoticeApplied: true });
    expect(completed.report.cache.status).toBe("not-needed"); expect(completed.report.public).toHaveLength(9);
    const replay = suspend(JSON.stringify([imageBase])); expect(replay.status, replay.stderr).toBe(0);
    expect(JSON.parse(replay.stdout)).toMatchObject({ operationId: operation, version: 1, status: "suspended" });
    const stale = suspend(JSON.stringify([imageBase]), randomUUID()); expect(stale.status).toBe(1);
    const evidence = [];
    const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
    try {
      const page = await context.newPage();
      for (const locale of ["ja", "ko", "en"]) {
        const url = target.urls[locale]; const normal = await request.get(url);
        const bot = await request.get(url, { headers: { "User-Agent": "Twitterbot/1.0" } });
        expect(normal.status()).toBe(200); expect(bot.status()).toBe(200);
        const html = await normal.text(); expect(await bot.text()).toBe(html); expect(normal.headers()["cache-control"]).toContain("no-store");
        expect(html).not.toContain(imageUrls[locale]); expect(html).not.toContain("OpenSetlist QA event Day.1");
        expect(html).not.toContain("Private synthetic QA-only suspension request");
        expect(html).not.toContain("/event-share-navigation.js"); expect(html).not.toContain('property="og:image"');
        expect(html).not.toContain('name="twitter:image"'); expect(html).toContain('name="twitter:card" content="summary"');
        expect(html).toContain(`rel="canonical" href="${url}"`); expect(html).toContain(`property="og:url" content="${url}"`);
        for (const imageUrl of [imageUrls[locale], `${imageUrls[locale]}?card-probe=1`]) {
          const response = await request.get(imageUrl); expect(response.status()).toBe(404);
          evidence.push({ locale, imageUrl, status: response.status(), sha256: hash(await response.body()), cacheStatus: response.headers()["cf-cache-status"] ?? "absent" });
        }
        const copy = JSON.parse(await readFile(`messages/${locale}.json`, "utf8")).EventSharePage;
        await page.goto(url); await expect(page).toHaveURL(url);
        await expect(page.getByTestId("event-share-suspension")).toContainText(copy.suspensionBody);
        await expect(page.getByTestId("event-share-title")).toHaveText(copy.suspensionHeading);
        const link = page.getByTestId("event-share-destination");
        await expect(link).toHaveAttribute("href", `/${locale}/events/${fixture.eventId}/${fixture.slug}`);
        await page.keyboard.press("Tab"); await expect(link).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: path.join(fixture.folder, `suspended-${locale}-mobile.png`), fullPage: true });
        await writeFile(path.join(fixture.folder, `suspended-${locale}.html`), html);
        await link.click(); await page.waitForURL(`${BASE}/${locale}/events/${fixture.eventId}/${fixture.slug}`);
      }
      for (const mode of ["live", "setlist"]) {
        const neighbor = fixture.published.find((p) => p.mode === mode)!;
        const html = await (await request.get(neighbor.urls.ja)).text();
        const imageUrl = html.match(/property="og:image" content="([^"]+)"/)![1];
        const png = await request.get(imageUrl); expect(png.status()).toBe(200); expect(hash(await png.body())).toBe(neighbor.hashes.ja);
        await page.goto(neighbor.urls.ja); await page.waitForURL(`${BASE}/ja/events/${fixture.eventId}/${fixture.slug}`);
      }
    } finally { await context.close(); }
    const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 360, height: 780 } });
    try {
      const page = await noJs.newPage();
      for (const locale of ["ja", "ko", "en"]) {
        await page.goto(target.urls[locale]); await expect(page.getByTestId("event-share-destination")).toBeVisible();
        await expect(page).toHaveURL(target.urls[locale]);
      }
    } finally { await noJs.close(); }
    await writeFile(path.join(fixture.folder, "suspension-http-evidence.json"), JSON.stringify({ scope: "dev r2.dev uncached origin only; custom-domain CDN purge NOT live verified", evidence }, null, 2));
  });
});
