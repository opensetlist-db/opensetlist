import { test, expect, type BrowserContext } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";

const enabled = process.env.EVENT_CARD_REGRESSION_E2E === "1";
const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3196";
const folder = path.resolve(".claude/tmp", `og05-regression-${Date.now()}`);
const locales = ["ja", "ko", "en"] as const;
type Song = { id: number; originalTitle: string; translations: { locale: string; title: string }[] };
async function noApiWrites(context: BrowserContext) {
  const writes: string[] = [];
  await context.route("**/api/**", async (route) => {
    if (!["GET", "HEAD"].includes(route.request().method())) {
      writes.push(route.request().url()); await route.fulfill({ status: 409, body: "QA browser blocked this write before the server" });
    } else await route.continue();
  });
  // Positive control proves a broken interceptor cannot silently allow writes.
  const probe = await context.newPage(); await probe.goto(BASE);
  expect(await probe.evaluate(async () => (await fetch("/api/__og05_write_canary__", { method: "POST" })).status)).toBe(409);
  expect(writes).toHaveLength(1); writes.length = 0; await probe.close(); return writes;
}

test.describe("existing personal PNG and fan-board sharing", () => {
  test.skip(!enabled, "opt-in real dev catalog GETs and isolated browser localStorage only; no server writes/SNS");
  test.beforeAll(async () => { await mkdir(folder, { recursive: true }); console.log("[og05-regression] evidence", folder); });
  test("downloads actual private prediction/result PNGs from the existing UI in all locales", async ({ browser, request }) => {
    test.setTimeout(240000); const records = [];
    for (const locale of locales) {
      const m = JSON.parse(await readFile(path.resolve("messages", `${locale}.json`), "utf8"));
      const response = await request.get(`${BASE}/api/setlist?eventId=2&locale=${locale}`); expect(response.status()).toBe(200);
      const data: { items: { type: string; songs: { song: Song }[] }[] } = await response.json();
      const songs = data.items.filter((i) => i.type === "song").flatMap((i) => i.songs.map((s) => ({ songId: Number(s.song.id), song: s.song }))).slice(0, 3).reverse();
      expect(songs).toHaveLength(3);
      for (const [id, phase] of [["109", "prediction"], ["2", "final"]] as const) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const writes = await noApiWrites(context);
        await context.addInitScript(({ id, songs }) => { localStorage.setItem(`predict-${id}`, JSON.stringify({ eventId: id, songs,
          savedAt: "2026-10-28T00:00:00.000Z", lockedAt: null })); }, { id, songs });
        const page = await context.newPage(); await page.goto(`${BASE}/${locale}/events/${id}`);
        await expect(page.getByTestId("event-hero")).toHaveAttribute("data-status", phase === "prediction" ? "upcoming" : "completed");
        const tab = page.getByTestId("setlist-tab-predicted"); await expect(tab).toHaveAccessibleName(m.Setlist.tabPredicted); await tab.click();
        const open = page.getByTestId("personal-share-open");
        await expect(open).toHaveAccessibleName(phase === "prediction" ? m.Predict.shareButtonPrediction : m.Predict.shareButton); await open.click();
        const dialog = page.getByTestId("personal-share-dialog"); await expect(dialog).toHaveRole("dialog"); await expect(dialog).toBeVisible();
        const card = dialog.getByTestId("personal-share-card").first(); const text = await card.innerText();
        for (const entry of songs) expect(text).toContain(entry.song.translations.find((t) => t.locale === locale)?.title ?? entry.song.originalTitle);
        expect(text).not.toContain(`predict-${id}`); expect(text).not.toContain("savedAt");
        const score = await card.getByTestId("personal-share-primary-score").innerText();
        if (phase === "prediction") expect(score.trim()).toBe("3");
        else expect(score.replace(/\s/g, "")).toBe(`3/${data.items.filter((i) => i.type === "song").length}`);
        const exportButton = dialog.getByTestId("personal-share-export"); await expect(exportButton).toHaveAccessibleName(m.ShareCard.downloadImage);
        const pending = page.waitForEvent("download"); await exportButton.click();
        const download = await pending; const file = path.join(folder, `${phase}-${locale}.png`); await download.saveAs(file);
        const bytes = await readFile(file); const size = await sharp(bytes).metadata();
        expect(size).toMatchObject({ format: "png", width: 1200 }); expect(bytes.length).toBeGreaterThan(10000);
        expect(writes).toEqual([]);
        records.push({ locale, phase, eventId: id, url: page.url(), file, sha256: createHash("sha256").update(bytes).digest("hex"),
          width: size.width, height: size.height, bytes: bytes.length, score, content: text });
        await context.close();
      }
    }
    await writeFile(path.join(folder, "personal-png.json"), JSON.stringify(records, null, 2));
  });
  test("copies a canonical fan-board group link and opens that same group without using an event-card wrapper", async ({ browser, request }) => {
    test.setTimeout(120000); const records = [];
    for (const locale of locales) {
      const m = JSON.parse(await readFile(path.resolve("messages", `${locale}.json`), "utf8"));
      const response = await request.get(`${BASE}/api/events/109/board?locale=${locale}`); expect(response.status()).toBe(200);
      const data: { groups: { groupId: string; slug: string; name: string; expects: { top: { songId: string; title: string; available: boolean }[] } }[] } = await response.json();
      const group = data.groups.find((g) => g.expects.top.some((s) => s.available)); expect(group).toBeTruthy();
      const song = group!.expects.top.find((s) => s.available)!;
      const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"], viewport: { width: 390, height: 844 } });
      const writes = await noApiWrites(context);
      await context.addInitScript(({ groupId, song }) => { localStorage.setItem("board-109", JSON.stringify({ picks: [{ id: "og05-local-only", groupId, songId: song.songId, title: song.title, available: true }] })); }, { groupId: group!.groupId, song });
      const page = await context.newPage(); await page.goto(`${BASE}/${locale}/events/109`);
      const tabs = page.getByTestId("board-group-tabs"); await expect(tabs).toHaveAccessibleName(m.Board.groupsAria);
      const groupTab = tabs.getByTestId(`board-group-${group!.groupId}`); await expect(groupTab).toHaveAccessibleName(group!.name); await groupTab.click();
      const copyButton = page.getByTestId("board-copy"); await expect(copyButton).toHaveAccessibleName(m.Board.copy); await copyButton.click();
      const copy = await page.evaluate(() => navigator.clipboard.readText()); const url = copy.match(/https?:\/\/\S+/)?.[0];
      expect(url).toBe(`${page.url().split("#")[0]}#board-${group!.slug}`); expect(copy).toContain(song.title);
      const target = await context.newPage(); await target.goto(url!);
      await expect(target.getByTestId(`board-group-${group!.groupId}`)).toHaveAttribute("aria-selected", "true");
      expect(writes).toEqual([]); await target.screenshot({ path: path.join(folder, `board-${locale}.png`) });
      records.push({ locale, url, copy, groupId: group!.groupId }); await context.close();
    }
    await writeFile(path.join(folder, "board-links.json"), JSON.stringify(records, null, 2));
  });
});
