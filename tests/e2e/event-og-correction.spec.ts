import { test, expect } from "@playwright/test";
import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
config({ path: [".env.local", ".env"], quiet: true });
const enabled = process.env.EVENT_CARD_R2_E2E === "1";
const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3194";
let fixture: { eventId: string; slug: string; folder: string; published: { mode: string; revision: string; urls: Record<string, string>; hashes: Record<string, string> }[];
  replacement: { publicationId: string; urls: Record<string, string> }; replacementHashes: Record<string, string>; operationId: string; reasonFile: string };
const metadata = (html: string) => html.match(/<(?:meta[^>]*(?:property="og:|name="twitter:)[^>]*|link rel="canonical"[^>]*)>/g);
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function helper(action: string) {
  const run = spawnSync(process.execPath, ["tests/e2e/helpers/event-og-correction-fixture.mjs", action], { cwd: process.cwd(), encoding: "utf8", timeout: 300_000,
    env: { ...process.env, NEXT_PUBLIC_BASE_URL: BASE, TEST_BASE_URL: BASE } });
  expect(run.status, run.stderr).toBe(0); return JSON.parse(run.stdout);
}
function correct(operationId = fixture.operationId, replacementId = fixture.replacement.publicationId) {
  return spawnSync(process.execPath, ["scripts/event-og.mjs", "correct", "--event", fixture.eventId, "--mode", "prediction", "--revision", fixture.published[0].revision,
    "--replacement", replacementId, "--expected-version", "0", "--operation", operationId, "--reason-file", fixture.reasonFile], {
    cwd: process.cwd(), encoding: "utf8", timeout: 60_000, env: { ...process.env, NEXT_PUBLIC_BASE_URL: BASE },
  });
}
test.describe("corrected event-card HTTP and readable notice", () => {
  test.skip(!enabled, "opt-in DEV DB/bucket/test namespace; twelve retained synthetic PNGs");
  test.beforeAll(() => { test.setTimeout(300_000); fixture = helper("prepare"); console.log("[event-og-correction-e2e] evidence", fixture.folder); });
  test.afterAll(() => { if (enabled) helper("cleanup"); });
  test("retains exact old metadata/PNG while showing three localized non-navigating correction notices and same-locale latest links", async ({ request, browser }) => {
    test.setTimeout(180_000);
    const old = fixture.published.find((p) => p.mode === "prediction")!;
    const before = new Map<string, string>();
    for (const locale of ["ja", "ko", "en"]) {
      const response = await request.get(old.urls[locale]); expect(response.status()).toBe(200);
      const html = await response.text(); before.set(locale, html);
      expect(html).toContain('/event-share-navigation.js');
    }
    const first = correct(); expect(first.status, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ status: "corrected", version: 1, replacementId: fixture.replacement.publicationId });
    const replay = correct(); expect(replay.status, replay.stderr).toBe(0); expect(JSON.parse(replay.stdout).status).toBe("reconciled");
    const invalid = correct(randomUUID(), randomUUID()); expect(invalid.status).toBe(1);
    const locales = JSON.parse(await readFile("messages/en.json", "utf8")); expect(locales.EventSharePage.correctionHeading).toBeTruthy();
    const evidence = [];
    const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
    try {
      const page = await context.newPage();
      for (const locale of ["ja", "ko", "en"]) {
        const url = old.urls[locale];
        const normal = await request.get(url); const bot = await request.get(url, { headers: { "User-Agent": "Twitterbot/1.0" } });
        expect(normal.status()).toBe(200); expect(bot.status()).toBe(200);
        const html = await normal.text(); expect(await bot.text()).toBe(html);
        expect(metadata(html)).toEqual(metadata(before.get(locale)!));
        expect(html).not.toContain('/event-share-navigation.js');
        const imageUrl = html.match(/property="og:image" content="([^"]+)"/)![1];
        const png = await request.get(imageUrl); expect(png.status()).toBe(200); expect(hash(await png.body())).toBe(old.hashes[locale]);
        expect(normal.headers()["cache-control"]).toContain("no-store");
        const copy = JSON.parse(await readFile(`messages/${locale}.json`, "utf8")).EventSharePage;
        await page.goto(url); await expect(page.getByTestId("event-share-correction")).toContainText(copy.correctionHeading);
        await expect(page).toHaveURL(url);
        const link = page.getByTestId("event-share-correction-link");
        await expect(link).toHaveAttribute("href", fixture.replacement.urls[locale]);
        await page.keyboard.press("Tab"); await expect(link).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: path.join(fixture.folder, `corrected-${locale}-mobile.png`), fullPage: true });
        await link.click(); await page.waitForURL(`${BASE}/${locale}/events/${fixture.eventId}/${fixture.slug}`);
        expect(await page.evaluate(() => scrollY)).toBe(0);
        await writeFile(path.join(fixture.folder, `corrected-${locale}.html`), html);
        evidence.push({ locale, url, replacementUrl: fixture.replacement.urls[locale], imageUrl, oldPngSha256: old.hashes[locale], metadataUnchanged: true });
      }
      // A later mode is independent, and still auto-opens the event normally.
      for (const mode of ["live", "setlist"]) {
        await page.goto(fixture.published.find((p) => p.mode === mode)!.urls.ja);
        await page.waitForURL(`${BASE}/ja/events/${fixture.eventId}/${fixture.slug}`);
      }
    } finally { await context.close(); }
    const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 360, height: 780 } });
    try {
      const page = await noJs.newPage();
      for (const locale of ["ja", "ko", "en"]) {
        await page.goto(old.urls[locale]); await expect(page.getByTestId("event-share-correction-link")).toBeVisible();
        await expect(page).toHaveURL(old.urls[locale]);
      }
    } finally { await noJs.close(); }
    await writeFile(path.join(fixture.folder, "correction-http-evidence.json"), JSON.stringify(evidence, null, 2));
  });
});
