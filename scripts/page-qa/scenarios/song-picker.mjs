// Picker presentation and personal save/restore. Board mutations are opt-in
// and require a separate shared-dev DB claim; the default run is read-only.
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { checkoutRoot } from "../harness.mjs";
import { pointsAtDevProject } from "../../dev-db-guard.mjs";

const root = checkoutRoot(path.resolve(import.meta.dirname, "../../.."));
const copy = Object.fromEntries(["ja", "ko", "en"].map((locale) => [locale,
  JSON.parse(fs.readFileSync(path.join(root, "messages", `${locale}.json`), "utf8")),
]));
const PICKER = '[data-testid="song-picker"]';
const ROW = '[data-testid="song-picker-row"]';
const CONFIRM = '[data-testid="song-picker-confirm"]';
const EVENT = "109";

async function inspect(h, page, locale, sheet) {
  const picker = sheet ? page.locator('[role="dialog"]').locator(PICKER) : page.locator(PICKER);
  await picker.waitFor();
  const input = picker.locator("input");
  h.check("search does not autofocus", await input.evaluate((el) => el !== document.activeElement));
  const initialRows = await picker.locator(ROW).count();
  h.check("real catalog loaded", initialRows > 3, initialRows);
  const sizes = await picker.evaluate((el) => ({
    bg: getComputedStyle(el).backgroundColor,
    input: getComputedStyle(el.querySelector('input')).fontSize,
    filters: [...el.querySelectorAll('button[style*="--picker-accent"]')].map((b) => ({
      height: b.getBoundingClientRect().height, color: getComputedStyle(b).color,
    })),
  }));
  h.check("white surface / 16px search / 36px filters", sizes.bg === "rgb(255, 255, 255)" && sizes.input === "16px" && sizes.filters.every((f) => f.height >= 36 && f.color === "rgb(23, 36, 69)"), JSON.stringify(sizes));
  await input.fill("c10-no-such-song-unique");
  h.check("empty search preserves clear", await picker.getByText(copy[locale].Predict.picker.noResults, { exact: true }).isVisible());
  await picker.getByRole("button", { name: copy[locale].Predict.picker.searchClearAria, exact: true }).click();
  h.check("clear restores real catalog", (await picker.locator(ROW).count()) === initialRows);
  const release = picker.getByRole("button", { name: copy[locale].Predict.picker.sortByRelease, exact: true });
  await release.click();
  h.check("release sorting selected", (await release.getAttribute("aria-pressed")) === "true");
  await picker.getByRole("button", { name: copy[locale].Predict.picker.sortByName, exact: true }).click();
  const chips = picker.locator('button[style*="--picker-accent"]');
  if (await chips.count() > 1) {
    await chips.nth(1).click();
    h.check("group filter selects", (await chips.nth(1).getAttribute("aria-pressed")) === "true");
    await chips.first().click();
    h.check("all filter restores catalog", (await picker.locator(ROW).count()) === initialRows);
  }
  h.check("picker text unclipped", (await h.clipped(page, [`${PICKER} button`, `${ROW} span`])).length === 0);
  if (sheet) {
    const confirm = page.locator(CONFIRM);
    await page.mouse.move(0, 0);
    const resting = await confirm.evaluate((b) => ({ bg: getComputedStyle(b).backgroundColor, image: getComputedStyle(b).backgroundImage, shadow: getComputedStyle(b).boxShadow, color: getComputedStyle(b).color }));
    h.check("confirm solid approved primary / white / no shadow", resting.bg === "rgb(22, 93, 204)" && resting.image === "none" && resting.shadow === "none" && resting.color === "rgb(255, 255, 255)", JSON.stringify(resting));
    await confirm.hover();
    h.check("confirm hover", await confirm.evaluate((b) => getComputedStyle(b).backgroundColor === "rgb(16, 74, 169)"));
    await confirm.evaluate((b) => b.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { once: true, capture: true }));
    await page.mouse.down();
    h.check("confirm pressed", await confirm.evaluate((b) => getComputedStyle(b).backgroundColor === "rgb(12, 61, 140)"));
    await page.mouse.up();
    await page.mouse.move(0, 0);
    await page.keyboard.press("Shift");
    await confirm.focus();
    // Windows WebKit switches to :focus-visible only after an actual
    // navigation key; programmatic focus after Shift alone stays in
    // pointer modality. The key does not activate the close action.
    await page.keyboard.press("ArrowRight");
    h.check("confirm focus ring", await confirm.evaluate((b) => {
      const s = getComputedStyle(b);
      return s.outlineWidth === "3px" && s.outlineColor === "rgb(23, 79, 175)" && s.outlineOffset === "4px";
    }));
    // Browser-only fault simulation: the live close action stays enabled
    // even with zero selections. Exercise the CSS state without changing
    // the product's enabled condition or pretending this saved a record.
    await confirm.evaluate((b) => { b.disabled = true; });
    h.check("disabled state simulation", await confirm.evaluate((b) => getComputedStyle(b).backgroundColor === "rgb(237, 240, 245)" && getComputedStyle(b).color === "rgb(103, 117, 139)"));
    await confirm.evaluate((b) => { b.disabled = false; });
  } else {
    h.check("desktop inline has no confirm", (await page.locator(CONFIRM).count()) === 0);
  }
}

const scenario = {
  name: "song-picker",
  async run(h) {
    for (const locale of h.LOCALES) {
      const widths = h.quick || locale !== "ko" ? [390, 1440] : [320, 375, 390, 430, 768, 1024, 1099, 1100, 1440];
      for (const width of widths) {
        await h.section(`${locale} ${width}: personal`, async () => {
          const { page, errors } = await h.open(`/${locale}/events/${EVENT}`, { width });
          await page.getByRole("button", { name: copy[locale].Board.toFullSetlist, exact: true }).click();
          const sheet = width < 1024;
          const trigger = page.getByRole("button", { name: copy[locale].Predict.add, exact: true });
          if (sheet) await trigger.click();
          await inspect(h, page, locale, sheet);
          const rows = page.locator(`${PICKER} ${ROW}`);
          // Personal predictions preserve their uncapped config; board's
          // separate three-song limit must not leak into this consumer.
          for (let i = 0; i < 4; i++) await rows.nth(i).click();
          h.check("personal four selections persist", await page.evaluate((id) => JSON.parse(localStorage.getItem(`predict-${id}`)).songs.length === 4, EVENT));
          if (sheet) {
            await page.locator(CONFIRM).click();
            await page.locator('[role="dialog"]').waitFor({ state: "hidden" });
            h.check("personal confirm restores trigger focus", await trigger.evaluate((el) => el === document.activeElement));
          }
          await page.reload({ waitUntil: "load" });
          await page.getByRole("button", { name: copy[locale].Board.toFullSetlist, exact: true }).click();
          if (sheet) await trigger.click();
          await page.locator(`${ROW}[aria-pressed="true"]`).first().waitFor();
          h.check("personal four restored after reload", await page.locator(`${ROW}[aria-pressed="true"]`).count() === 4);
          await h.shot(page, `${locale}-${width}-personal-restored`);
          h.check("personal runtime errors", errors.length === 0, errors.join("; "));
        });
        for (const kind of ["wishes", "picks"]) {
          await h.section(`${locale} ${width}: board ${kind}`, async () => {
            const { page } = await h.open(`/${locale}/events/${EVENT}`, { width });
            const mine = page.locator(`[data-testid="board-my-${kind}"]`);
            const trigger = mine.locator(":scope > button");
            await trigger.click();
            await inspect(h, page, locale, true);
            await h.shot(page, `${locale}-${width}-board-${kind}`);
            // Long translated labels and an unbroken song name are
            // simulated only in this browser; original capture above.
            await page.locator(CONFIRM).evaluate((b) => { b.textContent = "選択完了 · 선택 완료 · Finish selecting songs with a very long label (123 selected)"; });
            const label = await page.locator(CONFIRM).evaluate((b) => b.scrollWidth <= b.clientWidth);
            h.check("long confirm label wraps", label);
            await page.locator(CONFIRM).click();
            await page.locator('[role="dialog"]').waitFor({ state: "hidden" });
            h.check("board confirm restores trigger focus", await trigger.evaluate((el) => el === document.activeElement));
            await trigger.click();
            await page.locator('[role="dialog"]').locator(PICKER).waitFor();
            await page.keyboard.press("Escape");
            await page.locator('[role="dialog"]').waitFor({ state: "hidden" });
            h.check("Escape restores trigger focus", await trigger.evaluate((el) => el === document.activeElement));
          });
        }
      }
    }
  },
  fixture: {
    needs: ["eventId", "runPrefix"],
    about: "OPT-IN writes: isolated guest board wishes/picks on dev Event109, UI save/restore/cap, own-id cleanup plus server reconciliation. Claim DB slot first.",
    async run(h, fx) {
      dotenv.config({ path: path.join(root, ".env.local"), quiet: true });
      dotenv.config({ path: path.join(root, ".env"), quiet: true });
      if (![process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED].every(pointsAtDevProject)) {
        throw new Error("board write QA requires the dev database environment");
      }
      if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(h.base) || String(fx.eventId) !== EVENT || !/^c10qa-[0-9]+$/.test(fx.runPrefix)) {
        throw new Error("board write QA requires localhost, Event109 and unique c10qa timestamp prefix");
      }
      for (const locale of h.LOCALES) for (const width of [390, 1440]) for (const kind of ["wishes", "picks"]) {
        await h.section(`${locale} ${width} ${kind}: actual server save/restore`, async () => {
          const anon = `${fx.runPrefix}-${locale}-${width}-${kind}`;
          const endpoint = `/api/events/${EVENT}/${kind === "picks" ? "board/picks" : "wishes"}`;
          const ownIds = new Set();
          const { page, ctx } = await h.open(`/${locale}/events/${EVENT}`, { width,
            beforeNavigate: async ({ ctx: context }) => context.addInitScript((id) => localStorage.setItem("opensetlist_anon_id", id), anon),
          });
          const mine = page.locator(`[data-testid="board-my-${kind}"]`);
          const trigger = mine.locator(":scope > button");
          const rows = page.locator('[role="dialog"]').locator(ROW);
          const change = async (row, method) => {
            const response = page.waitForResponse((r) => r.request().method() === method && new URL(r.url()).pathname.startsWith(endpoint));
            await row.click();
            const r = await response;
            const body = await r.json();
            if (!r.ok()) throw new Error(`board ${method} returned ${r.status()}: ${body.error}`);
            if (method === "POST") ownIds.add(body.id);
            else ownIds.delete(body.id);
            await page.waitForFunction(({ type, event, count }) => {
              const key = type === "picks" ? `board-${event}` : `wish-${event}`;
              const value = JSON.parse(localStorage.getItem(key) ?? "{}");
              return (value[type]?.length ?? 0) === count;
            }, { type: kind, event: EVENT, count: ownIds.size });
          };
          try {
            await trigger.waitFor();
            h.check("isolated guest starts empty", await mine.locator('[data-testid="board-my-pick"]').count() === 0);
            await trigger.click();
            await rows.first().waitFor();
            for (let i = 0; i < 3; i++) await change(rows.nth(i), "POST");
            await rows.nth(3).click();
            const other = page.locator(`[data-testid="board-my-${kind === "picks" ? "wishes" : "picks"}"]`);
            h.check("other column and add control are rendered", await other.isVisible() && await other.locator(":scope > button").isVisible());
            const capResponse = await ctx.request.get(`${h.base}/api/events/${EVENT}/board/mine`, { headers: { "OpenSetlist-Anon-Token": anon } });
            const capMine = await capResponse.json();
            h.check("board independent cap is three", capResponse.ok() && capMine[kind]?.length === 3 && ownIds.size === 3 && await other.locator('[data-testid="board-my-pick"]').count() === 0,
              "server accepted three; other column remains empty; fourth handled by parent cap");
            h.check("board selected count is three", await page.locator('[role="dialog"]').locator(`${ROW}[aria-pressed="true"]`).count() === 3);
            await change(rows.nth(0), "DELETE");
            await change(rows.nth(3), "POST");
            h.check("deselect frees a slot", ownIds.size === 3);
            await page.locator(CONFIRM).click();
            await page.locator('[role="dialog"]').waitFor({ state: "hidden" });
            h.check("at-cap close returns focus to named choices", await mine.evaluate((el) => el === document.activeElement));
            const tabs = page.getByRole("tablist", { name: copy[locale].Board.groupsAria }).getByRole("tab");
            await tabs.nth(1).click();
            h.check("other group has independent capacity", await mine.locator('[data-testid="board-my-pick"]').count() === 0 && await trigger.isEnabled());
            await tabs.first().click();
            h.check("original group keeps three picks", await mine.locator('[data-testid="board-my-pick"]').count() === 3);
            await page.evaluate((key) => localStorage.removeItem(key), `${kind === "picks" ? "board" : "wish"}-${EVENT}`);
            await page.reload({ waitUntil: "load" });
            await mine.locator('[data-testid="board-my-pick"]').nth(2).waitFor();
            h.check("actual API restores three without local cache", await mine.locator('[data-testid="board-my-pick"]').count() === 3);
            await h.shot(page, `${locale}-${width}-${kind}-server-restored`);
            while (await mine.locator('[data-testid="board-my-pick"]').count()) {
              await change(mine.locator('[data-testid="board-my-pick"] button').first(), "DELETE");
            }
            h.check("UI cleanup empties own choices", ownIds.size === 0 && await trigger.isEnabled());
          } finally {
            // Recover even when a POST committed but its response was lost,
            // or an unexpected fourth selection was accepted. /mine is
            // credential-scoped to THIS newly minted fixture identity.
            const mineResponse = await ctx.request.get(`${h.base}/api/events/${EVENT}/board/mine`, { headers: { "OpenSetlist-Anon-Token": anon } });
            if (!mineResponse.ok()) throw new Error(`cleanup reconciliation failed: ${mineResponse.status()}`);
            const serverMine = await mineResponse.json();
            for (const entry of serverMine[kind] ?? []) ownIds.add(entry.id);
            for (const id of ownIds) {
              const response = await ctx.request.delete(`${h.base}${endpoint}/${id}`, { data: { anonId: anon } });
              h.check("fallback cleanup own row", response.ok() || response.status() === 404, response.status());
            }
            const response = await ctx.request.get(`${h.base}/api/events/${EVENT}/board/mine`, { headers: { "OpenSetlist-Anon-Token": anon } });
            const restored = await response.json();
            h.check("server cleanup verified", response.ok() && restored.picks?.length === 0 && restored.wishes?.length === 0);
          }
        });
      }
    },
  },
};

export default scenario;
