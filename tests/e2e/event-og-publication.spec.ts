import { test, expect } from "@playwright/test";
import { config } from "dotenv";
import { writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import path from "node:path";
import type { CardMode } from "../../src/lib/eventOg/content";

// Explicit opt-in writes exactly nine synthetic PNGs to the DEV bucket's
// test/ namespace. DB fixtures are purged/cleaned; immutable R2 objects stay
// retained, with keys/URLs printed and saved for deliberate later cleanup.
config({ path: [".env.local", ".env"], quiet: true });
const enabled = process.env.EVENT_CARD_R2_E2E === "1";
const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3192";
const hash = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
let eventId: string;
let slug: string;
let folder: string;
let published: { mode: CardMode; revision: string; urls: Record<string, string>; hashes: Record<string, string>; approvalFile: string; manifestFile: string }[] = [];

function fixture(action: string, ...args: string[]) {
  const run = spawnSync(process.execPath, ["tests/e2e/helpers/event-og-fixture.mjs", action, ...args], {
    cwd: process.cwd(), encoding: "utf8", timeout: 180_000, env: process.env,
  });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout);
}

test.describe("event-card publication HTTP and navigation", () => {
  test.skip(!enabled, "opt-in: EVENT_CARD_R2_E2E=1, DEV DB/bucket and R2_KEY_PREFIX=test required; writes nine retained objects");
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const prepared = fixture("prepare");
    ({ eventId, slug, folder, published } = prepared);
    console.log("[event-og-e2e] evidence", folder);
  });
  test.afterAll(() => { if (enabled) fixture("cleanup"); });

  test("all nine URLs return complete frozen OG to normal/Twitterbot HTTP, with publicly served exact PNGs", async ({ request }) => {
    test.setTimeout(120_000);
    const evidence = [];
    for (const item of published) for (const locale of ["ja", "ko", "en"]) {
      const url = item.urls[locale];
      const normal = await request.get(url, { maxRedirects: 0 });
      const bot = await request.get(url, { maxRedirects: 0, headers: { "User-Agent": "Twitterbot/1.0" } });
      expect(normal.status()).toBe(200); expect(bot.status()).toBe(200);
      expect(normal.headers()["cache-control"]).toContain("no-store");
      const html = await normal.text(); expect(await bot.text()).toBe(html);
      const head = html.slice(0, html.indexOf("</head>"));
      expect(head).toContain('name="twitter:card" content="summary_large_image"');
      expect(head).toContain(`rel="canonical" href="${url}"`);
      expect(head).toContain(`property="og:url" content="${url}"`);
      expect(head).toContain('name="robots" content="noindex, follow"');
      expect(head).toContain('property="og:image:width" content="1200"'); expect(head).toContain('property="og:image:height" content="630"');
      const imageUrl = head.match(/property="og:image" content="([^"]+)"/)?.[1]; expect(imageUrl).toBeTruthy();
      const image = await request.get(imageUrl!); expect(image.status()).toBe(200); expect(image.headers()["content-type"]).toContain("image/png");
      const bytes = await image.body();
      expect(hash(bytes)).toBe(item.hashes[locale]);
      expect(bytes.readUInt32BE(16)).toBe(1200); expect(bytes.readUInt32BE(20)).toBe(630);
      evidence.push({ url, normalStatus: normal.status(), twitterbotStatus: bot.status(), imageUrl, sha256: hash(bytes), htmlSha256: hash(html), cacheControl: normal.headers()["cache-control"] });
      await writeFile(path.join(folder, `${item.mode}-${locale}.html`), html);
    }
    await writeFile(path.join(folder, "http-evidence.json"), JSON.stringify(evidence, null, 2));
    const input = published[0];
    const cli = spawnSync(process.execPath, ["scripts/event-og.mjs", "publish", "--event", eventId, "--mode", input.mode,
      "--revision", input.revision, "--manifest", input.manifestFile, "--approval", input.approvalFile], {
      cwd: process.cwd(), encoding: "utf8", timeout: 30_000, env: { ...process.env, NEXT_PUBLIC_BASE_URL: BASE },
    });
    expect(cli.status, cli.stderr).toBe(0);
    expect(JSON.parse(cli.stdout)).toMatchObject({ status: "reconciled", publicationId: input.revision, urls: input.urls });
  });

  test("every mode/locale auto-opens the canonical event top; JS-free mobile fallback remains keyboard accessible", async ({ page, browser }) => {
    test.setTimeout(120_000);
    for (const item of published) for (const locale of ["ja", "ko", "en"]) {
      await page.goto(item.urls[locale]);
      await page.waitForURL(`${BASE}/${locale}/events/${eventId}/${slug}`);
      expect(await page.evaluate(() => scrollY)).toBe(0);
    }
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 360, height: 780 } });
    try {
      const fallback = await context.newPage();
      for (const item of published) for (const locale of ["ja", "ko", "en"]) {
        await fallback.goto(item.urls[locale]);
        await expect(fallback.locator("html")).toHaveAttribute("lang", locale);
        await expect(fallback.getByTestId("event-share-title")).toHaveText("OpenSetlist QA event Day.1");
        const link = fallback.getByTestId("event-share-destination");
        await expect(link).toBeVisible(); await expect(link).toHaveAttribute("href", `/${locale}/events/${eventId}/${slug}`);
        await fallback.keyboard.press("Tab"); await expect(link).toBeFocused();
        expect(await fallback.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      await fallback.screenshot({ path: path.join(folder, "mobile-js-free.png"), fullPage: true });
    } finally { await context.close(); }
  });

  test("unpublished/mismatched/deleted tuples are unavailable and navigation failure leaves a visible fallback", async ({ request, browser }) => {
    test.setTimeout(120_000);
    const item = published[0]; const url = item.urls.ja;
    expect((await request.get(url)).status()).toBe(200);
    for (const invalid of [url.replace(`/${item.mode}/`, "/wrong/"), url.replace(item.revision, randomUUID()), url.replace(`/events/${eventId}/`, "/events/9223372036854775807/")]) {
      const res = await request.get(invalid); expect(res.status()).toBe(404); expect(res.headers()["cache-control"]).toContain("no-store");
    }
    fixture("deleted", eventId);
    try { expect((await request.get(url)).status()).toBe(404); }
    finally { fixture("restored", eventId); }
    expect((await request.get(url)).status()).toBe(200);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.route(`**/ja/events/${eventId}/${slug}`, (route) => route.abort("aborted"));
      // The destination is deliberately aborted. Waiting for load would wait
      // on that aborted navigation; the wrapper's committed HTML is our target.
      await page.goto(url, { waitUntil: "commit", timeout: 15_000 });
      await expect(page.getByTestId("event-share-destination")).toBeVisible();
      await expect(page.getByTestId("event-share-title")).toHaveText("OpenSetlist QA event Day.1");
    } finally { await context.close(); }
  });

  test("a real unavailable DB returns non-cacheable503 and the same URL recovers after restoring connectivity", async ({ request }) => {
    test.setTimeout(120_000);
    const port = 3193;
    const listening = () => new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => { socket.destroy(); resolve(false); });
    });
    expect(await listening(), "do not interfere with an existing port holder").toBe(false);
    const pathName = new URL(published[0].urls.ja).pathname;
    const url = `http://127.0.0.1:${port}${pathName}`;
    const start = async (broken: boolean) => {
      const unavailable = "postgresql://invalid:invalid@127.0.0.1:1/unavailable";
      const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
        cwd: process.cwd(), windowsHide: true, stdio: "ignore",
        env: { ...process.env, SENTRY_DSN: "", NEXT_PUBLIC_SENTRY_DSN: "",
          ...(broken ? { DATABASE_URL: unavailable, DATABASE_URL_UNPOOLED: unavailable } : {}) },
      });
      const deadline = Date.now() + 30_000;
      while (!(await listening())) {
        if (child.exitCode !== null || Date.now() > deadline) { child.kill(); throw new Error("Own QA server failed to start"); }
        await new Promise((r) => setTimeout(r, 100));
      }
      return child;
    };
    const stop = async (child: ReturnType<typeof spawn>) => {
      if (child.exitCode === null) {
        child.kill();
        await new Promise<void>((resolve) => child.once("exit", () => resolve()));
      }
    };
    // Positive control: the same publication exists on the normal server.
    expect((await request.get(published[0].urls.ja)).status()).toBe(200);
    const bad = await start(true);
    try {
      const failure = await request.get(url);
      expect(failure.status()).toBe(503); expect(failure.headers()["cache-control"]).toContain("no-store");
      expect(failure.headers()["retry-after"]).toBe("5");
    } finally { await stop(bad); }
    const good = await start(false);
    try {
      const restored = await request.get(url);
      expect(restored.status()).toBe(200); expect(await restored.text()).toContain('property="og:image"');
    } finally { await stop(good); }
  });
});
