import { test, expect } from "@playwright/test";
import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
config({ path: [".env.local", ".env"], quiet: true });

const enabled = process.env.EVENT_CARD_R2_E2E === "1";
const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3196";
const locales = ["ja", "ko", "en"] as const;
type Publication = { mode: string; revision: string; urls: Record<string, string>; hashes: Record<string, string>; manifestFile: string };
let fixture: { eventId: string; slug: string; folder: string; published: Publication[] };
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const meta = (html: string, key: string) => [...html.matchAll(/<(?:meta (?:property|name)="([^"]+)" content|link rel="([^"]+)" href)="([^"]+)"/g)]
  .find((match) => (match[1] || match[2]) === key)?.[3];
function helper(action: string) {
  const run = spawnSync(process.execPath, ["tests/e2e/helpers/event-og-fixture.mjs", action, ...(fixture ? [fixture.eventId] : [])], {
    cwd: process.cwd(), encoding: "utf8", timeout: 360000,
    env: { ...process.env, EVENT_CARD_E2E_SUITE: "rollout", TEST_BASE_URL: BASE, NEXT_PUBLIC_BASE_URL: BASE },
  });
  expect(run.status, run.stderr).toBe(0); return JSON.parse(run.stdout);
}

test.describe("deployed event-card lifecycle integration", () => {
  test.skip(!enabled, "dev DB/test bucket explicit opt-in;12 NEW PNGs,6 exact keys revoked,6 retained");
  test.beforeAll(() => { test.setTimeout(420000); fixture = helper("prepare"); console.log("[og05] evidence", fixture.folder); });
  test.afterAll(() => { if (enabled) helper("cleanup"); });
  test("preserves frozen identities across correction and suspension, recovers deleted fixtures and keeps neighboring modes available", async ({ request, browser }) => {
    test.setTimeout(420000);
    // Only idempotent GET connection resets are retried once. HTTP failures,
    // metadata mismatches and lifecycle writes are never retried by the test.
    const get: typeof request.get = (url, options) => request.get(url, { ...options, maxRetries: 1 });
    const [original, live, setlist, replacement] = fixture.published;
    expect(fixture.published).toHaveLength(4);
    const reasonFile = path.join(fixture.folder, "reason.txt"); await writeFile(reasonFile, "Private synthetic integration QA reason");
    const observations: unknown[] = []; const images = new Map<string, string>();
    const command = (action: string, publication: Publication, version: number, replacementId?: string) => {
      const operation = randomUUID();
      const run = spawnSync(process.execPath, ["scripts/event-og.mjs", action, "--event", fixture.eventId,
        "--mode", publication.mode, "--revision", publication.revision, "--expected-version", String(version),
        "--operation", operation, "--reason-file", reasonFile, ...(replacementId ? ["--replacement", replacementId] : [])], {
        cwd: process.cwd(), encoding: "utf8", timeout: 180000, env: { ...process.env, NEXT_PUBLIC_BASE_URL: BASE,
          EVENT_CARD_DELIVERY_BASES: JSON.stringify([process.env.R2_PUBLIC_BASE_URL]) },
      });
      expect(run.status, run.stderr || run.stdout).toBe(0);
      const result = JSON.parse(run.stdout); observations.push({ action, result }); return result;
    };
    const htmlAt = async (pub: Publication, locale: string) => {
      const normal = await get(pub.urls[locale], { headers: { "User-Agent": "Mozilla/5.0" } });
      const bot = await get(pub.urls[locale], { headers: { "User-Agent": "Twitterbot/1.0" } });
      expect(normal.status()).toBe(200); expect(bot.status()).toBe(200);
      expect(normal.headers()["cache-control"]).toContain("no-store");
      expect(normal.headers()["x-robots-tag"]).toBe("noindex, follow");
      const html = await normal.text(); expect(await bot.text()).toBe(html);
      expect(meta(html, "canonical")).toBe(pub.urls[locale]); expect(meta(html, "og:url")).toBe(pub.urls[locale]);
      expect(html).not.toContain("Private synthetic"); return html;
    };
    for (const pub of fixture.published) for (const locale of locales) {
      const html = await htmlAt(pub, locale); expect(html).toContain("event-share-navigation.js");
      const imageUrl = meta(html, "og:image")!; expect(imageUrl).toBeTruthy(); images.set(`${pub.revision}/${locale}`, imageUrl);
      expect(meta(html, "twitter:card")).toBe("summary_large_image");
      const png = await get(imageUrl); expect(png.status()).toBe(200); const bytes = await png.body();
      expect(hash(bytes)).toBe(pub.hashes[locale]); expect(await sharp(bytes).metadata()).toMatchObject({ format: "png", width: 1200, height: 630 });
      observations.push({ state: "normal", mode: pub.mode, revision: pub.revision, locale, url: pub.urls[locale], imageUrl, sha256: hash(bytes) });
    }
    const oldBytes = Object.values(original.hashes); expect(oldBytes).not.toEqual(Object.values(replacement.hashes));
    const canonical = (locale: string) => `${BASE}/${locale}/events/${fixture.eventId}/${fixture.slug}`;
    const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
    const page = await context.newPage();
    for (const pub of [original, live, setlist]) for (const locale of locales) {
      await page.goto(pub.urls[locale]); await expect(page).toHaveURL(canonical(locale));
      expect(await page.evaluate(() => window.scrollY)).toBeLessThan(10);
    }
    await context.close();
    for (const locale of locales) {
      const fallback = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 360, height: 780 } });
      const p = await fallback.newPage(); await p.goto(original.urls[locale]);
      const link = p.getByTestId("event-share-destination"); await link.focus(); await expect(link).toBeFocused();
      await p.screenshot({ path: path.join(fixture.folder, `normal-${locale}-nojs.png`) });
      await link.press("Enter"); await expect(p).toHaveURL(canonical(locale)); await fallback.close();
    }
    command("correct", original, 0, replacement.revision);
    const notice = await browser.newContext({ viewport: { width: 360, height: 780 } }); const noticePage = await notice.newPage();
    for (const locale of locales) {
      const html = await htmlAt(original, locale); expect(html).toContain("data-testid=\"event-share-correction\"");
      expect(html).not.toContain("event-share-navigation.js"); expect(meta(html, "og:image")).toBe(images.get(`${original.revision}/${locale}`));
      const png = await get(images.get(`${original.revision}/${locale}`)!); expect(hash(await png.body())).toBe(original.hashes[locale]);
      await noticePage.goto(original.urls[locale]); await expect(noticePage).toHaveURL(original.urls[locale]);
      await noticePage.getByTestId("event-share-correction-link").focus();
      await noticePage.screenshot({ path: path.join(fixture.folder, `corrected-${locale}.png`) });
      await noticePage.getByTestId("event-share-correction-link").press("Enter"); await expect(noticePage).toHaveURL(canonical(locale));
    }
    for (const [pub, version] of [[original, 1], [replacement, 0]] as const) {
      const stopped = command("suspend", pub, version); expect(stopped.status).toBe("suspended");
      for (const locale of locales) {
        const html = await htmlAt(pub, locale); expect(meta(html, "og:image")).toBeUndefined();
        expect(meta(html, "twitter:card")).toBe("summary"); expect(html).not.toContain("Development QA");
        expect(html).not.toContain("event-share-navigation.js");
        const removed = await get(images.get(`${pub.revision}/${locale}`)!); expect(removed.status()).toBe(404);
        await noticePage.goto(pub.urls[locale]); await expect(noticePage).toHaveURL(pub.urls[locale]);
        await expect(noticePage.getByTestId("event-share-suspension")).toBeVisible();
        const link = noticePage.getByTestId("event-share-destination"); await link.focus(); await expect(link).toBeFocused();
        expect(await noticePage.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        await noticePage.screenshot({ path: path.join(fixture.folder, `suspended-${pub === original ? "old" : "replacement"}-${locale}.png`) });
        observations.push({ state: "suspended", revision: pub.revision, locale, imageUrl: images.get(`${pub.revision}/${locale}`), imageStatus: removed.status() });
      }
    }
    await notice.close();
    helper("deleted");
    for (const pub of fixture.published) for (const locale of locales) expect((await get(pub.urls[locale])).status()).toBe(404);
    helper("restored");
    for (const locale of locales) {
      expect(meta(await htmlAt(original, locale), "og:image")).toBeUndefined();
      for (const pub of [live, setlist]) {
        const html = await htmlAt(pub, locale); expect(html).toContain("event-share-navigation.js");
        const response = await get(meta(html, "og:image")!); expect(response.status()).toBe(200);
        expect(hash(await response.body())).toBe(pub.hashes[locale]);
      }
      for (const tuple of [`${fixture.eventId}/unknown/${live.revision}`, `${fixture.eventId}/prediction/${randomUUID()}`, `${BigInt(fixture.eventId) + BigInt(1)}/live/${live.revision}`]) {
        const missing = await get(`${BASE}/${locale}/share/events/${tuple}`);
        expect(missing.status()).toBe(404); expect(missing.headers()["cache-control"]).toContain("no-store");
      }
    }
    await writeFile(path.join(fixture.folder, "lifecycle-http.json"), JSON.stringify({ origin: BASE, scope: "actual dev deployment/R2; no live custom-domain CDN or X proof", observations }, null, 2));
  });
});
