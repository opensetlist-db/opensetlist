// n15 release A3c/A3d on the dev Preview: 375 px board readability,
// ongoing page issues no /board request, disabled event shows the wishlist.
import { chromium } from "file:///F:/work/ClaudeCode/opensetlist/node_modules/playwright/index.mjs";
import fs from "node:fs";
const BASE = process.argv[2];
const OUT = process.argv[3];
const log = (...a) => console.log(...a);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ja" });

async function visit(path, label) {
  const page = await ctx.newPage();
  const reqs = [];
  page.on("request", (r) => { const u = r.url(); if (u.includes("/api/")) reqs.push(u.replace(BASE, "")); });
  const t0 = Date.now();
  const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60000 });
  log(`\n[${label}] ${path} → ${res.status()} ${Date.now() - t0}ms url=${page.url().replace(BASE, "")}`);
  await page.waitForTimeout(2500);
  const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  log(`  page horizontal overflow: ${hasHScroll}`);
  log(`  /api requests: ${JSON.stringify([...new Set(reqs)])}`);
  return { page, reqs };
}

// A3c — board-enabled event 109 at 375 px
{
  const { page, reqs } = await visit("/ja/events/109/lovelive-15th-fes-day1", "A3c board 109");
  const sec = page.locator('section[aria-labelledby^="board-title-"]');
  await sec.first().waitFor({ state: "visible", timeout: 20000 });
  await page.locator('[data-testid="board-col-expect"], [data-testid="board-col-want"]').first().waitFor({ state: "visible", timeout: 20000 });
  const chips = sec.locator('[aria-label="グループを選択"]').first();
  const chipInfo = await chips.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, overflowX: getComputedStyle(el).overflowX, count: el.children.length }));
  log(`  chips: ${JSON.stringify(chipInfo)} → scrolls horizontally: ${chipInfo.scrollWidth > chipInfo.clientWidth && chipInfo.overflowX === "auto"}`);
  const want = await page.locator('[data-testid="board-col-want"]').first().boundingBox();
  const expect = await page.locator('[data-testid="board-col-expect"]').first().boundingBox();
  log(`  col want: ${JSON.stringify(want)}`);
  log(`  col expect: ${JSON.stringify(expect)}`);
  const stacked = want && expect && (expect.y >= want.y + want.height - 1 || want.y >= expect.y + expect.height - 1) && Math.abs(want.x - expect.x) < 2;
  log(`  columns stacked (one below the other, same x): ${stacked}`);
  const title = await sec.locator('h2, h3').first().innerText().catch(() => "");
  log(`  board title text: ${title}`);
  await sec.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await sec.first().screenshot({ path: `${OUT}/n15-release-A3c-board-375px-section.png` });
  await page.screenshot({ path: `${OUT}/n15-release-A3c-board-375px-viewport.png` });
  log(`  board requests: ${reqs.filter((u) => u.includes("/board")).join(", ")}`);
  await page.close();
}

// A3d-1 — ongoing event 111: no board request
{
  const { page, reqs } = await visit("/ja/events/111", "A3d ongoing 111");
  const boardReqs = reqs.filter((u) => u.includes("/board"));
  log(`  board requests on ongoing page: ${boardReqs.length} ${JSON.stringify(boardReqs)}`);
  const boardMounted = await page.locator('section[aria-labelledby^="board-title-"]').count();
  log(`  board section mounted: ${boardMounted}`);
  await page.screenshot({ path: `${OUT}/n15-release-A3d-ongoing-111-375px.png` });
  await page.close();
}

// A3d-2 — board-disabled upcoming event 110: today's wishlist, no board
{
  const { page, reqs } = await visit("/ja/events/110", "A3d disabled 110");
  const boardReqs = reqs.filter((u) => u.includes("/board"));
  log(`  board requests on disabled page: ${boardReqs.length}`);
  const boardMounted = await page.locator('section[aria-labelledby^="board-title-"]').count();
  log(`  board section mounted: ${boardMounted}`);
  const wishTexts = await page.getByText(/聴きたい曲|セトリ予想|ウィッシュ|wish/i).allInnerTexts().catch(() => []);
  log(`  wishlist-related texts: ${JSON.stringify(wishTexts.slice(0, 6))}`);
  const wishReq = reqs.filter((u) => u.includes("/wishes"));
  log(`  wish requests: ${JSON.stringify(wishReq)}`);
  await page.screenshot({ path: `${OUT}/n15-release-A3d-disabled-110-375px.png` });
  await page.close();
}
await browser.close();
