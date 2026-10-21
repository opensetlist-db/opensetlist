// Browser QA harness for operator-only admin pages.
//
// A page ticket writes a SCENARIO module (scripts/admin-qa/scenarios/*.mjs,
// contract below); this file does everything that is the same for every
// admin page: logging in, the dev-DB fixture lifecycle, the generic checks
// (page overflow, keyboard activation, accessible names, reduced motion,
// external-image referrer), screenshots, the results JSON and the WebP
// conversion. scripts/admin-qa.mjs is the CLI around it.
//
// Scenario module contract (default export):
//
//   {
//     name: "album-cover",            // file stem / screenshot prefix
//     ready: '[data-testid="…"]',     // selector t.open() waits for
//     container: '[data-testid="…"]', // scope of the a11y checks
//     modes: {                        // widths per phase; any may be []
//       full:  { states: [1440, 390], overflow: [320, 375], a11y: [1440, 390] },
//       quick: { states: [390],       overflow: [],         a11y: [390] },
//     },
//     fixture: {
//       tagPrefix: "cover",           // tag = `${tagPrefix}-qa-<ms>`
//       create: async ({ db, tag }) => fixture,      // INSERT new rows only
//       remove: async ({ db, tag, fixture }) => {},  // delete what create made
//       remaining: async ({ db, tag }) => number,    // must be 0 after remove
//     },
//     openDefault: async (t) => {},   // reset fixture + open the page in
//                                     // its default state (overflow/a11y)
//     states: [ { name: "default", run: async (t) => {} }, … ],
//     keyboard: async (t) => {},      // optional page-specific a11y step
//   }
//
// States run IN ORDER on one logged-in page per width (later states may
// rely on earlier ones). A state that throws is recorded as a FAIL with a
// screenshot, and the remaining states of that width are skipped.
//
// The `t` object every scenario function receives:
//   page, ctx, width, browserName, base, fixture, db, env, opts, outDir
//   check(name, ok, detail)       record PASS/FAIL
//   open(path)                    goto base+path, wait for `ready`
//   shot(state)                   full-page PNG + whole-page overflow check
//   capture(otherPage, label, w)  full-page PNG of another page (e.g. the
//                                 public page after a save), recorded with
//                                 the run's captures
//   refererTo(prefix)             start watching requests to an external
//                                 host; returns () => last Referer seen
//                                 ("unset" when no request went out)
//   checkImgNoReferrer(sel, label)   <img> has referrerPolicy no-referrer
//                                    and actually rendered
//   keyboardActivate(locator, label) focus directly + Enter (WebKit skips
//                                    buttons on Tab) and check the focus
//                                    ring (outline or box-shadow); assert
//                                    the effect afterwards
//   checkNamedControls(label)     every input/textarea/button/select in
//                                 `container` has an accessible name
//   checkNoAnimations(label)      reduced motion → nothing in `container`
//                                 animates OR transitions. Transitions
//                                 count too: globals.css turns both off
//                                 under prefers-reduced-motion, so one
//                                 that survives is a page override.
//
// Shared dev DB rules (wiki output/redesign/session-start.md): fixtures
// are NEW rows with a unique tag. A scenario may write its own fixture
// rows directly (a "concurrent" change, a starting value); existing
// records are at most read. The caller must hold the execution-board DB
// mutation slot — the CLI prints a reminder. The DB URL must be the DEV
// project (scripts/dev-db-guard.mjs) and only the session pooler
// (DATABASE_URL_UNPOOLED) is used; no session-level SET is ever sent.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import sharp from "sharp";
// @playwright/test is the declared dependency and re-exports the browser types.
import { chromium, webkit } from "@playwright/test";
import { pointsAtDevProject } from "../dev-db-guard.mjs";

export const BROWSERS = { chromium, webkit };

// WebP's hard limit is 16383 px per side; the wiki stores evidence as
// WebP, so taller pages are split into `.partN.webp` (same rule as
// scripts/redesign-capture.mjs).
const WEBP_MAX_PART_HEIGHT = 16000;
const WEBP_QUALITY = 90;
const SHARP_INPUT = { limitInputPixels: false };

// pg returns int8 ids as strings, but a scenario fixture may hold a real
// BigInt, and JSON.stringify throws on one.
const jsonSafe = (_, v) => (typeof v === "bigint" ? String(v) : v);

/**
 * The checkout under test: the git work tree that holds the current
 * directory, not the one that holds this file. A copy of the QA scripts
 * extracted into another checkout (a redesign worktree's gitignored
 * .claude/tmp/, run with cwd = that worktree) then reads that checkout's
 * files, where a path relative to the script would land in .claude/.
 * Outside any git work tree it returns `fallback` (the caller's
 * script-relative root). The same function lives in page-qa/harness.mjs
 * (and inlined in redesign-capture.mjs): each harness stays extractable
 * without the other, so change all three together.
 */
export function checkoutRoot(fallback) {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (top) return path.resolve(top);
  } catch {
    // not in a work tree, or git missing
  }
  return fallback;
}

/** `.env.local` wins over `.env`, as in Next and scripts/db-ro.mjs. */
export function loadEnv(repoRoot) {
  const env = {};
  for (const f of [".env", ".env.local"]) {
    const p = path.join(repoRoot, f);
    if (fs.existsSync(p)) Object.assign(env, dotenv.parse(fs.readFileSync(p)));
  }
  return env;
}

export async function connectDevDb(env) {
  const url = env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED is not set (session pooler required for fixtures)");
  // Never print the URL: it carries the password.
  if (!pointsAtDevProject(url)) throw new Error("DATABASE_URL_UNPOOLED is not the DEV Supabase project — refusing");
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  return db;
}

/** Convert PNGs to WebP q90 in `dir`, splitting anything taller than 16,000 px. */
export async function toWebp(pngFiles, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  for (const png of pngFiles) {
    const stem = path.basename(png, ".png");
    const { width, height } = await sharp(png, SHARP_INPUT).metadata();
    const parts = Math.ceil(height / WEBP_MAX_PART_HEIGHT);
    for (let i = 0; i < parts; i++) {
      const top = i * WEBP_MAX_PART_HEIGHT;
      const file = path.join(dir, parts === 1 ? `${stem}.webp` : `${stem}.part${i + 1}.webp`);
      await sharp(png, SHARP_INPUT)
        .extract({ left: 0, top, width, height: Math.min(WEBP_MAX_PART_HEIGHT, height - top) })
        .webp({ quality: WEBP_QUALITY })
        .toFile(file);
      out.push(file);
    }
  }
  return out;
}

/**
 * Run one scenario end to end. Returns the results object (also written
 * to <outDir>/results-<scenario>-<browser>-<mode>.json).
 */
export async function runScenario({ scenario, browserName, mode, base, outDir, env, opts = {}, log = console.log }) {
  const modeCfg = scenario.modes[mode];
  if (!modeCfg) throw new Error(`scenario ${scenario.name} has no mode "${mode}"`);
  const password = env.ADMIN_PASSWORD;
  if (!password) throw new Error("ADMIN_PASSWORD not found in .env/.env.local");
  fs.mkdirSync(outDir, { recursive: true });

  const results = [];
  const shots = [];
  const check = (name, ok, detail = "") => {
    results.push({ name, ok: !!ok, detail: String(detail ?? "") });
    log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  };
  const suffix = browserName === "webkit" ? "-webkit" : "";
  const pngPath = (label, width) => path.join(outDir, `${scenario.name}-${label}-${width}${suffix}.png`);

  const db = await connectDevDb(env);
  const tag = `${scenario.fixture.tagPrefix}-qa-${Date.now()}`;
  let fixture;
  let browser;
  try {
    fixture = await scenario.fixture.create({ db, tag, outDir, env, opts });
    log(`fixture ${tag} ${JSON.stringify(fixture, jsonSafe)}`);
    browser = await BROWSERS[browserName].launch();

    // One fresh context per page so cookies/cache never carry over.
    const newPage = async (width) => {
      const ctx = await browser.newContext({ viewport: { width, height: width >= 768 ? 1000 : 844 } });
      const page = await ctx.newPage();
      page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource/.test(m.text())) log(`  console.error: ${m.text().slice(0, 200)}`);
      });
      if (browserName === "webkit") {
        // The production build marks the admin cookie Secure, and WebKit
        // drops a Secure cookie set over http://localhost. Harness-only
        // workaround: log in through the API and hand the same cookie to
        // the context without the Secure flag.
        const r = await ctx.request.post(`${base}/api/admin/login`, { data: { password } });
        if (r.status() !== 200) throw new Error(`admin login ${r.status()}`);
        const sc = r.headersArray().find((h) => h.name.toLowerCase() === "set-cookie")?.value ?? "";
        const [nv] = sc.split(";");
        const i = nv.indexOf("=");
        if (i < 1) throw new Error("admin login answered 200 without a cookie");
        await ctx.addCookies([
          { name: nv.slice(0, i), value: nv.slice(i + 1), domain: "localhost", path: "/", httpOnly: true, secure: false },
        ]);
      } else {
        // Same-origin fetch from a cheap page (/admin/login is a 404; the
        // login form is not a route of its own), so the cookie lands in
        // the browser exactly as a real login would set it.
        await page.goto(`${base}/robots.txt`, { waitUntil: "load" });
        const status = await page.evaluate(async (pw) => {
          const r = await fetch("/api/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: pw }),
          });
          return r.status;
        }, password);
        if (status !== 200) throw new Error(`admin login ${status}`);
      }
      return { ctx, page };
    };

    const makeT = (ctx, page, width) => {
      const t = {
        page, ctx, width, browserName, base, fixture, db, env, opts, outDir, check,
        async open(p) {
          await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
          await page.locator(scenario.ready).first().waitFor();
        },
        async overflow(label) {
          const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          check(`${label}@${width} no horizontal overflow`, o <= 0, `scrollWidth-innerWidth=${o}`);
        },
        async shot(state) {
          await page.waitForTimeout(250);
          const file = pngPath(state, width);
          await page.screenshot({ path: file, fullPage: true });
          shots.push(file);
          await t.overflow(state);
        },
        async capture(otherPage, label, w) {
          const file = pngPath(label, w);
          await otherPage.screenshot({ path: file, fullPage: true });
          shots.push(file);
        },
        refererTo(prefix) {
          let referer = "unset";
          page.on("request", (r) => {
            if (r.url().startsWith(prefix)) referer = r.headers()["referer"] ?? "";
          });
          return () => referer;
        },
        async checkImgNoReferrer(selector, label) {
          await page.waitForFunction((s) => {
            const img = document.querySelector(s);
            return img && img.complete;
          }, selector);
          const info = await page.evaluate((s) => {
            const img = document.querySelector(s);
            return { rp: img.referrerPolicy, w: img.naturalWidth };
          }, selector);
          check(`${label}@${width} img referrerPolicy no-referrer`, info.rp === "no-referrer", info.rp);
          check(`${label}@${width} img renders`, info.w > 0, `naturalWidth=${info.w}`);
        },
        async keyboardActivate(locator, label) {
          // Direct focus instead of Tab: WebKit (Safari default) skips
          // buttons on Tab. A key press first makes :focus-visible match
          // as it would for a keyboard user.
          await page.keyboard.press("Shift");
          await locator.focus();
          const ring = await page.evaluate(() => {
            const s = getComputedStyle(document.activeElement);
            return { outline: s.outlineStyle, shadow: s.boxShadow };
          });
          check(
            `kbd ${label}@${width} focus indicator`,
            ring.outline !== "none" || ring.shadow !== "none",
            `outline=${ring.outline} box-shadow=${ring.shadow}`,
          );
          await page.keyboard.press("Enter");
        },
        async checkNamedControls(label = "controls") {
          const unnamed = await page.evaluate((c) => {
            const root = document.querySelector(c);
            if (!root) return ["<container missing>"];
            return [...root.querySelectorAll("input, textarea, button, select")]
              .filter((el) => el.type !== "hidden")
              .filter((el) => {
                const byId = (el.getAttribute("aria-labelledby") ?? "")
                  .split(/\s+/)
                  .map((id) => document.getElementById(id)?.innerText ?? "")
                  .join(" ");
                const name =
                  el.getAttribute("aria-label") || byId || el.labels?.[0]?.innerText ||
                  (el.tagName === "BUTTON" ? el.innerText : "") || el.getAttribute("title");
                return !name || !name.trim();
              })
              .map((el) => el.outerHTML.slice(0, 80));
          }, scenario.container);
          check(`${label}@${width} all controls named`, unnamed.length === 0, unnamed.join(" | "));
        },
        async checkNoAnimations(label = "motion") {
          await page.emulateMedia({ reducedMotion: "reduce" });
          const moving = await page.evaluate((c) => {
            const root = document.querySelector(c);
            if (!root) return -1;
            return [root, ...root.querySelectorAll("*")].filter((el) => {
              const s = getComputedStyle(el);
              const dur = (v) => v.split(",").some((x) => parseFloat(x) > 0);
              return s.animationName !== "none" || dur(s.transitionDuration);
            }).length;
          }, scenario.container);
          check(`${label}@${width} no animations under reduced motion`, moving === 0, `moving=${moving}`);
        },
      };
      return t;
    };

    for (const width of modeCfg.states ?? []) {
      const { ctx, page } = await newPage(width);
      const t = makeT(ctx, page, width);
      try {
        for (const s of scenario.states) {
          if (s.when && !s.when(t)) continue;
          try {
            await s.run(t);
          } catch (e) {
            check(`${s.name}@${width} ran`, false, String(e?.message ?? e).slice(0, 400));
            const file = pngPath(`${s.name}-error`, width);
            await page.screenshot({ path: file, fullPage: true }).catch(() => {});
            shots.push(file);
            break;
          }
        }
      } finally {
        await ctx.close();
      }
    }

    for (const width of modeCfg.overflow ?? []) {
      const { ctx, page } = await newPage(width);
      try {
        const t = makeT(ctx, page, width);
        await scenario.openDefault(t);
        await t.shot("default");
      } catch (e) {
        check(`overflow sweep@${width} ran`, false, String(e?.message ?? e).slice(0, 400));
      } finally {
        await ctx.close();
      }
    }

    for (const width of modeCfg.a11y ?? []) {
      const { ctx, page } = await newPage(width);
      try {
        const t = makeT(ctx, page, width);
        await scenario.openDefault(t);
        if (scenario.keyboard) await scenario.keyboard(t);
        await t.checkNamedControls();
        await t.checkNoAnimations();
      } catch (e) {
        check(`a11y@${width} ran`, false, String(e?.message ?? e).slice(0, 400));
      } finally {
        await ctx.close();
      }
    }
  } catch (e) {
    check("run completed", false, String(e?.stack ?? e).slice(0, 600));
  } finally {
    // Playwright's WebKit on Windows can hang in browser.close() (its
    // network process lingers); never let that block the fixture cleanup.
    if (browser) await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 10000))]);
    try {
      await scenario.fixture.remove({ db, tag, fixture, opts });
    } catch (e) {
      check("fixture remove ran", false, String(e?.message ?? e).slice(0, 300));
    }
    try {
      const left = await scenario.fixture.remaining({ db, tag, fixture });
      check("fixture deleted (0 rows left)", left === 0, `remaining=${left}`);
    } catch (e) {
      check("fixture deleted (0 rows left)", false, `count failed — check ${tag} by hand: ${String(e?.message ?? e).slice(0, 300)}`);
    }
    await db.end().catch(() => {});
  }

  let webp = [];
  if (opts.webp) webp = await toWebp(shots.filter((f) => fs.existsSync(f)), opts.webp);

  const summary = {
    scenario: scenario.name,
    browser: browserName,
    mode,
    base,
    tag,
    fixture,
    results,
    shots,
    webp,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
  fs.writeFileSync(
    path.join(outDir, `results-${scenario.name}-${browserName}-${mode}.json`),
    JSON.stringify(summary, jsonSafe, 2),
  );
  return summary;
}
