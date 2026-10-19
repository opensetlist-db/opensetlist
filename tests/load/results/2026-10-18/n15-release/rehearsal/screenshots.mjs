// n15 rehearsal — mobile screenshots of the dev 109 board in ja/ko/en.
import fs from "node:fs";
import { chromium } from "file:///F:/work/ClaudeCode/opensetlist/node_modules/playwright/index.mjs";

const BASE = "https://opensetlist-gzwu0qdmq-opensetlist-projects.vercel.app";
const OUT = "C:/Users/cheon/AppData/Local/Temp/claude/F--work-ClaudeCode-opensetlist--claude-worktrees-sweet-perlman-669fab/ba358779-5838-48b9-baa9-7cc7dbad7ca5/scratchpad/rehearsal";
const LABELS = {
  ja: { copy: "自分の予想をコピー", full: "セットリスト作成モードへ", explore: /をのぞいてみる/ },
  ko: { copy: "내 픽 복사", full: "전체 세트리스트 모드로", explore: /둘러보기/ },
  en: { copy: "Copy my picks", full: "Go to full setlist mode", explore: /^Explore / },
};
const HASU = /蓮ノ空|하스노소라|hasunosora/i;

const report = [];
const browser = await chromium.launch();
for (const locale of ["ja", "ko", "en"]) {
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: locale === "ja" ? "ja-JP" : locale === "ko" ? "ko-KR" : "en-US",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const t0 = Date.now();
  await page.goto(`${BASE}/${locale}/events/109/lovelive-15th-fes-day1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const section = page.locator('section[aria-labelledby^="board-title-"]');
  await section.waitFor({ state: "visible", timeout: 30_000 });
  await section.locator('[data-testid="board-col-expect"]').first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(800);
  const loadMs = Date.now() - t0;

  const tabs = section.locator('[role="tablist"] [role="tab"]');
  const tabLabels = await tabs.allInnerTexts();
  const selectedBefore = await section.locator('[role="tab"][aria-selected="true"]').allInnerTexts();
  const defaultShot = `${OUT}/board-109-${locale}-375px.png`;
  await section.screenshot({ path: defaultShot });

  // Buttons / bridges in the default (first) chip view.
  const L = LABELS[locale];
  const copyBtn = section.getByRole("button", { name: L.copy, exact: true });
  const copyCount = await copyBtn.count();
  const copyDisabled = copyCount ? await copyBtn.first().isDisabled() : null;
  const fullBtn = section.getByRole("button", { name: L.full, exact: true });
  const fullCount = await fullBtn.count();
  const exploreLink = section.getByRole("link", { name: L.explore });
  const exploreCount = await exploreLink.count();
  const exploreText = exploreCount ? await exploreLink.first().innerText() : null;
  const exploreHref = exploreCount ? await exploreLink.first().getAttribute("href") : null;
  const earlyBadges = await section.locator('[data-testid="board-early"]').count();
  const topEntries = await section.locator('[data-testid="board-top-entry"]').allInnerTexts();

  // Click the 蓮ノ空 chip (found by text) and screenshot again.
  let hasuIdx = tabLabels.findIndex((t) => HASU.test(t));
  let hasuShot = null;
  let hasuTop = null;
  let hasuExplore = null;
  if (hasuIdx >= 0) {
    await tabs.nth(hasuIdx).click();
    await page.waitForTimeout(600);
    hasuShot = `${OUT}/board-109-${locale}-hasunosora-375px.png`;
    await section.screenshot({ path: hasuShot });
    hasuTop = await section.locator('[data-testid="board-top-entry"]').allInnerTexts();
    hasuExplore = exploreCount ? await section.getByRole("link", { name: L.explore }).first().innerText() : null;
  }
  const localPicks = await page.evaluate(() => Object.keys(localStorage).filter((k) => /board|pick|anon/i.test(k)).map((k) => [k, localStorage.getItem(k)?.slice(0, 80)]));
  report.push({ locale, loadMs, tabLabels, selectedBefore, hasuIdx, copyCount, copyDisabled, fullCount, exploreCount, exploreText, exploreHref, hasuExplore, earlyBadges, topEntries, hasuTop, localPicks, errors, defaultShot, hasuShot });
  console.log(JSON.stringify(report.at(-1), null, 1));
  await ctx.close();
}
await browser.close();
fs.writeFileSync(`${OUT}/screenshots-report.json`, JSON.stringify(report, null, 1));
