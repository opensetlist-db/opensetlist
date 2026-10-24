// Concert detail (/<locale>/events/<id>): the consistency-03-v3 display
// pieces and the personal-participation states around them.
//
// Display (layout matrix):
//   - identity title 32px at >= 700px, 24px below, line-height 1.4
//   - LIVE hero: 3px coral left rule + warm wash, shared LIVE badge with dot
//   - neutral "updating live" notice
//   - song-name links >= 24px tall (reactions / rows untouched)
//   - per-song performer toggle beside the credit chips (28x28, aria-
//     expanded / aria-controls, titled panel, keyboard), and individual
//     performer names always visible on chip-less rows
//   - the whole roster in one grid (no "more" step), no duplicate cards
//   - trending songs card (trending-v1): amber top rule, 20/18px heading,
//     3 columns from a 1024px viewport / 1 below, 24px to the setlist card
//     (no doubled margin), absent while upcoming; a synthetic polling
//     response (browser-only route rewrite) drives 3 songs with a long
//     title, translation, variant and four-digit counts through the live
//     path, so the update, wrapping and reaction order are checked without
//     writing a single reaction
//
// Participation (fixed dev records, personal state seeded ONLY in this
// browser's localStorage — no DB write, no wish/board POST):
//   live + records / live, no records / live, no actual / completed /
//   open (edit, save, restore) / lock transition at start time (page clock)
//   / board API failure / delayed live sync. Every visitor here is a guest
//   (no sign-in exists on public pages).
//
// The records are dev data whose status moves with time. Each section reads
// the hero's data-status first and SKIPs (with the observed status) when
// the record is no longer in the state the section needs, rather than
// passing for the wrong reason. A cancelled concert has no dev record: pass
// one with --fixture '{"cancelled": "<event id>"}' (db-fixture-add, holding
// the DB slot) or that section SKIPs.
import fs from "node:fs";
import path from "node:path";
import { checkoutRoot } from "../harness.mjs";

const LIVE = "111"; // ongoing, 23 actual items, festival (every row has chips)
const LIVE_EMPTY = "112"; // ongoing, no actual items yet
const DONE = "2"; // completed, single-artist (full_group rows carry no chip)
const OPEN = "109"; // upcoming, wish/predict window open, fan board on
const PRE = "107"; // upcoming, window not yet open

const MOBILE_BELOW = 700;
const CORAL = "rgb(229, 71, 59)";
const NOTICE_BG = "rgb(247, 249, 252)";
const INK = "rgb(23, 36, 69)";
const FOCUS = /^solid 3px rgb\(23, 79, 175\) 4px/;
const CONTRAST = ["liveNotice", "panelCount"];
// Measured once a performer panel is open (closed panels are hidden).
const CONTRAST_OPEN = ["creditBody"];

const root = checkoutRoot(path.resolve(import.meta.dirname, "../../.."));
const messages = Object.fromEntries(
  ["ja", "ko", "en"].map((l) => [l, JSON.parse(fs.readFileSync(path.join(root, "messages", `${l}.json`), "utf8"))]),
);
const msg = (loc, dotted) => dotted.split(".").reduce((o, k) => o?.[k], messages[loc]);

// Real song ids/titles from record 111 (v3 personal-state fixture): six
// predictions and three wishes, written in the app's own storage shapes.
const SEED_SONGS = [{"songId": 2557, "song": {"originalTitle": "未体験HORIZON", "originalLanguage": "ja", "variantLabel": null, "baseVersionId": null, "translations": [{"locale": "ko", "title": "미체험 HORIZON", "variantLabel": null}, {"locale": "en", "title": "Mitaiken HORIZON", "variantLabel": null}]}}, {"songId": 562, "song": {"originalTitle": "TOKIMEKI Runners", "originalLanguage": "ja", "variantLabel": null, "baseVersionId": null, "translations": []}}, {"songId": 563, "song": {"originalTitle": "夢への一歩", "originalLanguage": "ja", "variantLabel": null, "baseVersionId": null, "translations": [{"locale": "ko", "title": "꿈으로의 한 걸음", "variantLabel": null}, {"locale": "en", "title": "Yume e no Ippo", "variantLabel": null}]}}, {"songId": 571, "song": {"originalTitle": "ドキピポ☆エモーション", "originalLanguage": "ja", "variantLabel": null, "baseVersionId": null, "translations": [{"locale": "ko", "title": "도키피포☆이모션", "variantLabel": null}, {"locale": "en", "title": "Doki Pipo ☆ Emotion", "variantLabel": null}]}}, {"songId": 568, "song": {"originalTitle": "眠れる森に行きたいな", "originalLanguage": "ja", "variantLabel": null, "baseVersionId": null, "translations": [{"locale": "ko", "title": "잠자는 숲 속으로 가고 싶어", "variantLabel": null}, {"locale": "en", "title": "Nemureru Mori ni Ikitai na", "variantLabel": null}]}}, {"songId": 566, "song": {"originalTitle": "Starlight", "originalLanguage": "ja", "variantLabel": null, "baseVersionId": null, "translations": []}}];
const SEED_WISHES = SEED_SONGS.slice(0, 3).map((s, i) => ({ ...s, dbId: `qa-local-${i}` }));

function seed(eventId, { predictions = SEED_SONGS, wishes = SEED_WISHES } = {}) {
  return async ({ ctx }) => {
    await ctx.addInitScript(
      ({ id, p, w }) => {
        // Once per document: a reload must read what the page saved, not
        // the seed again.
        if (sessionStorage.getItem("qa-seeded")) return;
        sessionStorage.setItem("qa-seeded", "1");
        if (p) localStorage.setItem(`predict-${id}`, JSON.stringify({ eventId: id, songs: p, savedAt: "2026-10-08T00:00:00.000Z", lockedAt: null }));
        if (w) localStorage.setItem(`wish-${id}`, JSON.stringify({ wishes: w }));
      },
      { id: eventId, p: predictions, w: wishes },
    );
  };
}

const heroStatus = (page) => page.locator('[data-testid="event-hero"]').getAttribute("data-status");

// In-page read of the display pieces. Everything returned is plain data.
function readDisplay() {
  const main = document.querySelector("main");
  const hero = main.querySelector('[data-testid="event-hero"]');
  const h1 = main.querySelector("h1");
  const hs = getComputedStyle(h1);
  const heroS = getComputedStyle(hero);
  const notice = main.querySelector('[data-testid="setlist-live-notice"]');
  const card = main.querySelector('section[id^="setlist-card-"]');
  const links = card ? [...card.querySelectorAll('li a[href*="/songs/"]')] : [];
  const rows = card ? [...card.querySelectorAll("ol > li, ul > li")].filter((li) => li.className.includes("songRow")) : [];
  const toggles = card ? [...card.querySelectorAll('button[aria-controls][aria-expanded]')] : [];
  const roster = main.querySelector("#event-performers");
  const cards = roster ? [...roster.querySelectorAll('li[class*="__member"]')] : [];
  return {
    status: hero?.dataset.status ?? null,
    title: { size: parseFloat(hs.fontSize), lh: parseFloat(hs.lineHeight) / parseFloat(hs.fontSize), ls: parseFloat(hs.letterSpacing) / parseFloat(hs.fontSize), wrap: hs.overflowWrap },
    heroRule: `${heroS.borderLeftStyle} ${heroS.borderLeftWidth} ${heroS.borderLeftColor}`,
    heroBg: heroS.backgroundImage,
    badgeDot: !!hero?.querySelector('span > span[aria-hidden="true"]'),
    notice: notice ? { bg: getComputedStyle(notice).backgroundColor, strong: getComputedStyle(notice.querySelector("strong")).color } : null,
    links: links.map((a) => ({ h: a.getBoundingClientRect().height, display: getComputedStyle(a).display })),
    rowCount: rows.length,
    toggles: toggles.map((b) => {
      const r = b.getBoundingClientRect();
      const panel = document.getElementById(b.getAttribute("aria-controls"));
      const line = b.parentElement.querySelector('[class*="__creditLine"]');
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        label: b.getAttribute("aria-label"),
        expanded: b.getAttribute("aria-expanded"),
        besideChips: !!line && line.nextElementSibling === b,
        panelHidden: panel ? panel.hidden : null,
        panelTitle: panel?.querySelector("strong")?.textContent ?? null,
        panelNames: panel?.querySelector("p")?.textContent.trim() ?? "",
      };
    }),
    inlinePerformers: card ? [...card.querySelectorAll('[data-testid="setlist-performers"]')].map((p) => ({
      text: p.textContent.trim(),
      visible: p.checkVisibility(),
      clipped: p.scrollWidth > p.clientWidth + 1,
      directParagraph: p.tagName === "P" && p.parentElement.className.includes("__songBody"),
    })) : [],
    roster: roster
      ? {
          more: roster.querySelectorAll("details").length,
          grids: roster.querySelectorAll('ul[class*="__rosterGrid"]').length,
          cards: cards.length,
          count: Number(roster.querySelector('[class*="__panelCount"]')?.textContent ?? NaN),
          names: cards.map((c) => c.querySelector("strong")?.textContent ?? ""),
          colours: cards.map((c) => c.style.getPropertyValue("--artist")),
        }
      : null,
  };
}

// Trending card geometry. `null` when the card is not on the page.
function readTrending() {
  const card = document.querySelector('[data-testid="trending-songs"]');
  if (!card) return null;
  const cs = getComputedStyle(card);
  const h2 = card.querySelector("h2");
  const ol = card.querySelector("ol");
  const next = card.nextElementSibling;
  const items = ol ? [...ol.children] : [];
  return {
    top: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
    radius: cs.borderTopLeftRadius,
    bg: cs.backgroundImage,
    title: h2 ? parseFloat(getComputedStyle(h2).fontSize) : null,
    titleLevel: h2?.tagName ?? null,
    titleText: h2?.textContent ?? null,
    cols: ol ? getComputedStyle(ol).gridTemplateColumns.split(" ").filter(Boolean).length : 0,
    role: ol?.getAttribute("role") ?? null,
    items: items.length,
    texts: items.map((li) => li.innerText),
    labels: items.map((li) => [...li.querySelectorAll('[role="img"]')].map((x) => x.getAttribute("aria-label"))),
    focusable: card.querySelectorAll("a,button,input,[tabindex]").length,
    gapBelow: next ? Math.round(next.getBoundingClientRect().top - card.getBoundingClientRect().bottom) : null,
    overflowX: [...card.querySelectorAll("*")].some((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible"),
    right: Math.round(card.getBoundingClientRect().right),
  };
}

// Display checks shared by every matrix that shows the card.
function checkTrending(t, { width, name, check, loc }) {
  const amber = "rgb(216, 183, 125)";
  check(name("trending: card look"), t.top === `3px solid ${amber}` && t.radius === "16px" && /linear-gradient/.test(t.bg), `${t.top} r${t.radius}`);
  check(name(`trending: heading h2 ${width >= MOBILE_BELOW ? 20 : 18}px`), t.titleLevel === "H2" && t.title === (width >= MOBILE_BELOW ? 20 : 18), `${t.titleLevel} ${t.title}`);
  check(name(`trending: ${width >= 1024 ? 3 : 1} column(s)`), t.cols === (width >= 1024 ? 3 : 1) && t.role === "list", `${t.cols} cols, role ${t.role}`);
  check(name("trending: 1–3 items, display only"), t.items >= 1 && t.items <= 3 && t.focusable === 0, `${t.items} items, ${t.focusable} focusable`);
  check(name("trending: 24px to the next card"), t.gapBelow === 24, String(t.gapBelow));
  check(name("trending: within viewport, no clipped box"), !t.overflowX && t.right <= width, `right ${t.right}`);
  check(name("trending: localized title"), t.titleText === msg(loc, "Reaction.trending"), t.titleText);
}

const scenario = {
  name: "event-detail",
  async run(h) {
    const found = new Set();
    // Set once a LIVE cell actually ran its checks; the contrast
    // "found at some width" controls below only mean something then.
    let liveChecked = false;

    // ── LIVE record, full matrix ──────────────────────────────────────
    await h.layoutMatrix({
      path: (loc) => `/${loc}/events/${LIVE}`,
      prefix: "live",
      basics: true,
      capture: true,
      cell: async ({ page, loc, width, name, check }) => {
        const d = await page.evaluate(readDisplay);
        if (d.status !== "ongoing") {
          h.skip(name("LIVE checks"), `record ${LIVE} is ${d.status}`);
          return;
        }
        liveChecked = true;
        const want = width >= MOBILE_BELOW ? 32 : 24;
        check(name(`title ${want}px / 1.4 / -.03em`), d.title.size === want && Math.abs(d.title.lh - 1.4) < 0.01 && Math.abs(d.title.ls + 0.03) < 0.002 && d.title.wrap === "anywhere", JSON.stringify(d.title));
        check(name("LIVE hero rule + warm wash"), d.heroRule === `solid 3px ${CORAL}` && /linear-gradient/.test(d.heroBg), `${d.heroRule} | ${d.heroBg.slice(0, 80)}`);
        check(name("LIVE badge with dot"), d.badgeDot);
        check(name("neutral live notice"), d.notice?.bg === NOTICE_BG && d.notice?.strong === INK, JSON.stringify(d.notice));
        const short = d.links.filter((l) => l.h < 24);
        check(name("song links >= 24px"), d.links.length > 0 && short.length === 0, `${short.length}/${d.links.length} under 24px`);
        // Festival record: every song row has chips, so every performer
        // list sits behind the chevron and no 18-v3 <details> is left.
        check(name("toggles beside chips, 28x28"), d.toggles.length > 0 && d.toggles.every((t) => t.besideChips && t.w === 28 && t.h === 28), `${d.toggles.length} toggles; ${JSON.stringify(d.toggles.find((t) => !(t.besideChips && t.w === 28 && t.h === 28)) ?? "")}`);
        const title = msg(loc, "EventDetail.songPerformers");
        check(name("toggle names + panels"), d.toggles.every((t) => t.label === title && t.panelTitle === title && t.panelHidden === true && t.expanded === "false" && t.panelNames.length > 0), title);
        const r = d.roster;
        check(name("roster: one grid, no more step"), !!r && r.more === 0 && r.grids === 1, JSON.stringify(r && { more: r.more, grids: r.grids }));
        check(name("roster: every card, no duplicates"), !!r && r.cards === r.count && new Set(r.names).size === r.names.length && r.cards > 6, `${r?.cards} cards / count ${r?.count}`);
        check(name("roster: colours kept"), !!r && r.colours.every(Boolean), "");
        const clipped = await h.clipped(page, ['#event-performers li strong', '[class*="__creditBody"] p', "main h1", '[data-testid="trending-songs"] li div']);
        check(name("never clipped"), clipped.length === 0, JSON.stringify(clipped.slice(0, 3)));
        const tr = await page.evaluate(readTrending);
        if (tr) checkTrending(tr, { width, name, check, loc });
        else h.skip(name("trending checks"), `record ${LIVE} has no reactions now`);

        if (width === 390 || width === 1440) {
          for (const n of await h.contrast(page, CONTRAST, name("contrast"))) found.add(n);
        }

        // Keyboard: Enter opens, Space closes, focus ring on the chevron.
        const first = page.locator('section[id^="setlist-card-"] button[aria-controls][aria-expanded]').first();
        await h.focusRing(page, name("toggle focus ring"), 'section[id^="setlist-card-"] button[aria-controls][aria-expanded]', FOCUS);
        await first.focus();
        await page.keyboard.press("Enter");
        const panelId = await first.getAttribute("aria-controls");
        const open = await page.evaluate((id) => {
          const p = document.getElementById(id);
          return { hidden: p.hidden, h: p.getBoundingClientRect().height };
        }, panelId);
        check(name("Enter opens the panel"), (await first.getAttribute("aria-expanded")) === "true" && !open.hidden && open.h > 0, JSON.stringify(open));
        if (width === 390 || width === 1440) {
          for (const n of await h.contrast(page, CONTRAST_OPEN, name("contrast (open)"))) found.add(n);
        }
        if (width === 390) {
          // Let the chevron's 0.15s rotation finish so the capture shows
          // the open state, not a frame mid-turn.
          await page.waitForTimeout(300);
          await h.shot(page, `live-${loc}-${width}-credit-open`);
        }
        await page.keyboard.press("Space");
        check(name("Space closes it"), (await first.getAttribute("aria-expanded")) === "false" && (await page.evaluate((id) => document.getElementById(id).hidden, panelId)), "");
      },
    });

    // ── Completed single-artist record: chip-less rows ────────────────
    await h.layoutMatrix({
      path: (loc) => `/${loc}/events/${DONE}`,
      prefix: "completed",
      widths: h.quick ? [390, 1440] : [390, 699, 700, 1440],
      // No `basics` here: its 24px-target heuristic flags controls this
      // ticket leaves alone and that were already under 24px on the base
      // build — the hero series link (18-v3), the impressions' 번역/신고
      // buttons and the picker's sort buttons (picker = ticket 10). The
      // LIVE matrix above runs `basics` on a record without them; here the
      // one-h1 check is done by hand.
      capture: true,
      cell: async ({ page, loc, width, name, check }) => {
        check(name("one h1"), (await page.locator("main h1").count()) === 1, "");
        const d = await page.evaluate(readDisplay);
        if (d.status !== "completed") return h.skip(name("completed checks"), `record ${DONE} is ${d.status}`);
        const want = width >= MOBILE_BELOW ? 32 : 24;
        check(name(`title ${want}px`), d.title.size === want, String(d.title.size));
        check(name("no LIVE rule / notice"), !d.heroRule.includes(" 3px ") && d.notice === null, d.heroRule);
        check(name("chip-less performer names immediately visible"), d.inlinePerformers.length > 0 && d.inlinePerformers.every((p) => p.text && p.visible && !p.clipped), JSON.stringify(d.inlinePerformers));
        check(name("performers are direct row text"), d.inlinePerformers.length > 0 && d.inlinePerformers.every((p) => p.directParagraph), String(d.inlinePerformers.length));
        check(name("roster: one grid"), !!d.roster && d.roster.more === 0 && d.roster.cards === d.roster.count, JSON.stringify(d.roster && { cards: d.roster.cards, count: d.roster.count }));
        const tr = await page.evaluate(readTrending);
        if (tr) checkTrending(tr, { width, name, check, loc });
        else h.skip(name("trending checks"), `record ${DONE} has no reactions now`);
      },
    });

    // ── Open (upcoming) and pre-window records: title + no LIVE ───────
    for (const [id, label] of [[OPEN, "open"], [PRE, "pre-window"]]) {
      await h.layoutMatrix({
        path: (loc) => `/${loc}/events/${id}`,
        prefix: label,
        widths: [390, 1440],
        // No `basics`: same reason as the completed matrix.
        capture: true,
        cell: async ({ page, width, name, check }) => {
          check(name("one h1"), (await page.locator("main h1").count()) === 1, "");
          const d = await page.evaluate(readDisplay);
          if (d.status !== "upcoming") return h.skip(name(`${label} checks`), `record ${id} is ${d.status}`);
          check(name(`title ${width >= MOBILE_BELOW ? 32 : 24}px`), d.title.size === (width >= MOBILE_BELOW ? 32 : 24), String(d.title.size));
          check(name("no LIVE rule / notice"), !d.heroRule.includes(" 3px ") && d.notice === null && !d.badgeDot, d.heroRule);
          check(name("roster: one grid"), !d.roster || (d.roster.more === 0 && d.roster.cards === d.roster.count), JSON.stringify(d.roster && { cards: d.roster.cards, count: d.roster.count }));
          // Positive control: the LIVE / completed matrices above found the
          // card; before the show it must not render at all.
          check(name("trending: hidden while upcoming"), (await page.locator('[data-testid="trending-songs"]').count()) === 0, "");
        },
      });
    }

    {
      // A LIVE record that has drifted out of `ongoing` skipped every cell,
      // so nothing was measured: SKIP, not a contrast FAIL.
      if (liveChecked) {
        for (const n of [...CONTRAST, ...CONTRAST_OPEN]) h.check(`contrast ${n} found at some width`, found.has(n), found.has(n) ? "" : `no .*__${n}`);
      } else {
        h.skip("contrast found at some width", `record ${LIVE} not ongoing`);
      }
    }

    // ── Trending via the live polling path (synthetic, browser only) ──
    // The /api/setlist answer is rewritten in this browser: the first
    // three items get reaction counts (four digits on the first), and the
    // first song a long title, translation and variant. Nothing is
    // written to the DB; the numbers never leave the page. capturedAt is
    // set to now so the client's revision rule accepts it as the newest
    // copy of the same revision.
    const LONG = {
      ja: "未来へ続く夢の物語と終わらないステージの向こうへ届けたい歌",
      ko: "미래로 이어지는 꿈의 이야기와 끝나지 않는 무대 너머로 전하고 싶은 노래",
      en: "A story of dreams continuing into the future and beyond the endless stage we share",
    };
    const synthetic = (loc) => async ({ page }) => {
      await page.route("**/api/setlist**", async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        const songItems = (body.items ?? []).filter((it) => it.songs?.length);
        const counts = [
          { waiting: 1248, best: 128, surprise: 12, moved: 4 },
          { waiting: 22, best: 94, moved: 18 },
          { best: 37, moved: 26 },
        ];
        body.reactionCounts = {};
        songItems.slice(0, 3).forEach((it, i) => {
          body.reactionCounts[String(it.id)] = counts[i];
        });
        const song = songItems[0]?.songs[0]?.song;
        if (song) {
          song.originalTitle = LONG.ja;
          song.originalLanguage = "ja";
          song.variantLabel = "SAKURA Ver. / Special Live Arrangement";
          song.translations = loc === "ja" ? [] : [{ locale: loc, title: LONG[loc], variantLabel: "SAKURA Ver. / Special Live Arrangement" }];
        }
        body.capturedAt = new Date().toISOString();
        await route.fulfill({ response: res, json: body });
      });
    };
    const trendWidths = h.quick ? [390, 1440] : [320, 375, 390, 430, 768, 1023, 1024, 1440];
    for (const loc of h.LOCALES) {
      for (const width of trendWidths) {
        await h.section(`trending polling ${loc} ${width}`, async () => {
          const { page } = await h.open(`/${loc}/events/${LIVE}`, { width, beforeNavigate: synthetic(loc) });
          if ((await heroStatus(page)) !== "ongoing") return h.skip(`trending polling ${loc} ${width}`, `record ${LIVE} not ongoing`);
          const name = (x) => `trending polling ${loc} ${width}: ${x}`;
          // The SSR seed shows the real (small) state first; the polled,
          // rewritten answer must replace it without a reload.
          const updated = await page
            // Three items alone could already be the real SSR seed; the
            // long synthetic title proves the rewritten polled answer landed.
            .waitForFunction(
              (long) => {
                const card = document.querySelector('[data-testid="trending-songs"]');
                return !!card && card.querySelectorAll("ol > li").length === 3 && card.textContent.includes(long);
              },
              LONG.ja,
              { timeout: 90_000 },
            )
            .then(() => true)
            .catch(() => false);
          h.check(name("polled update reaches the card (3 songs)"), updated, "");
          if (!updated) return;
          const t = await page.evaluate(readTrending);
          checkTrending(t, { width, name, check: h.check, loc });
          const lab = (type, n) => `${msg(loc, `Reaction.${type}`)} ${n}`;
          h.check(name("ranked by total, canonical reaction order, zeros omitted"), JSON.stringify(t.labels[0]) === JSON.stringify([lab("waiting", 1248), lab("best", 128), lab("surprise", 12), lab("moved", 4)]) && JSON.stringify(t.labels[2]) === JSON.stringify([lab("best", 37), lab("moved", 26)]), JSON.stringify(t.labels));
          h.check(name("long title / translation / variant on their own lines"), t.texts[0].includes(LONG.ja) && (loc === "ja" || t.texts[0].includes(LONG[loc])) && t.texts[0].includes("(SAKURA Ver. / Special Live Arrangement)"), t.texts[0].slice(0, 80).replace(/\s+/g, " "));
          const clipped = await h.clipped(page, '[data-testid="trending-songs"] li div');
          h.check(name("long text wraps, never clipped"), clipped.length === 0, JSON.stringify(clipped.slice(0, 2)));
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          h.check(name("no page overflow"), overflow <= 0, String(overflow));
          if (width === 390 || width === 1440 || width === 320) {
            await page.locator('[data-testid="trending-songs"]').screenshot({ path: path.join(h.outDir, `${scenario.name}-${h.browserName}${h.quick ? "-quick" : ""}-trending-${loc}-${width}.png`) });
          }
        }, { ms: 150_000 });
      }
    }

    await h.section("trending: none without actual items", async () => {
      // 0 songs: the ongoing record with no actual items renders no card.
      const { page } = await h.open(`/ko/events/${LIVE_EMPTY}`, { width: 1440 });
      if ((await heroStatus(page)) !== "ongoing") return h.skip("trending none", `record ${LIVE_EMPTY} not ongoing`);
      h.check("trending: no card on a live record with no songs", (await page.locator('[data-testid="trending-songs"]').count()) === 0 && (await page.locator('section[id^="setlist-card-"]').count()) === 1, "");
    });

    // ── Participation ─────────────────────────────────────────────────
    const loc = "ko";
    const tTabPred = msg(loc, "Setlist.tabPredicted");
    const tShare = msg(loc, "Predict.shareButton");
    const tSharePred = msg(loc, "Predict.shareButtonPrediction");
    const tRemove = msg(loc, "Predict.removeAria");
    const tAdd = msg(loc, "Predict.add");
    const tSearch = msg(loc, "Predict.picker.searchPlaceholder");
    const tDelayed = msg(loc, "Setlist.updatesDelayed");
    const tLocked = msg(loc, "Predict.lockedHint");

    // Read-only predicted view helper: the tab (if any) is selected, then
    // the panel's controls are counted.
    const readPredicted = (page) =>
      page.evaluate(
        ({ tRemove, tAdd, tSearch, tShare, tSharePred }) => {
          const card = document.querySelector('section[id^="setlist-card-"]');
          const buttons = [...card.querySelectorAll("button")].map((b) => b.textContent.trim());
          return {
            removeButtons: card.querySelectorAll(`[aria-label="${tRemove}"]`).length,
            addButton: buttons.some((b) => b === tAdd),
            search: !!card.querySelector(`input[aria-label="${tSearch}"]`),
            share: buttons.find((b) => b === tShare || b === tSharePred) ?? null,
            text: card.innerText,
          };
        },
        { tRemove, tAdd, tSearch, tShare, tSharePred },
      );

    for (const width of [1440, 390]) {
      await h.section(`participation live + records ${width}`, async () => {
        const { page } = await h.open(`/${loc}/events/${LIVE}`, { width, beforeNavigate: seed(LIVE) });
        if ((await heroStatus(page)) !== "ongoing") return h.skip(`participation live ${width}`, `record ${LIVE} not ongoing`);
        const tabs = page.locator('section[id^="setlist-card-"] [role="tab"]');
        await tabs.first().waitFor();
        h.check(`live+records ${width}: actual/predicted tabs`, (await tabs.count()) === 2, String(await tabs.count()));
        await page.getByRole("tab", { name: tTabPred }).click();
        await page.locator('section[id^="setlist-card-"] [role="tabpanel"]').getByText("TOKIMEKI Runners").first().waitFor();
        const p = await readPredicted(page);
        h.check(`live+records ${width}: saved predictions shown`, SEED_SONGS.every((s) => p.text.includes(s.song.translations.find((t) => t.locale === loc)?.title ?? s.song.originalTitle) || p.text.includes(s.song.originalTitle)), "");
        h.check(`live+records ${width}: read-only (no add / remove / picker)`, p.removeButtons === 0 && !p.addButton && !p.search, JSON.stringify({ r: p.removeButtons, a: p.addButton, s: p.search }));
        h.check(`live+records ${width}: share = live`, p.share === tShare, String(p.share));
        // Keyboard path (focus + Enter): WebKit, like Safari, does not focus
        // a button on a mouse click, so a click-opened modal has no trigger
        // to hand focus back to there.
        await page.getByRole("button", { name: tShare }).focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        h.check(`live+records ${width}: share modal opens`, await dialog.isVisible(), "");
        await h.shot(page, `participation-live-records-${width}-share`);
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
        h.check(`live+records ${width}: Escape closes, focus back on share`, (await page.evaluate(() => document.activeElement?.textContent?.trim())) === tShare, "");
        // The locked wish panel lists the saved wishes and offers no search.
        const wishPanel = page.locator('main [class*="__lockedWishPanel"]');
        const wishText = (await wishPanel.count()) ? await wishPanel.innerText() : "";
        const wishInputs = await wishPanel.locator("input").count();
        h.check(`live+records ${width}: wishes stay, read-only`, SEED_WISHES.every((w) => wishText.includes(w.song.originalTitle) || w.song.translations.some((t) => wishText.includes(t.title))) && wishInputs === 0, `${wishText.length} chars, ${wishInputs} inputs`);
        await h.shot(page, `participation-live-records-${width}`);
      });
    }

    await h.section("participation live, no records", async () => {
      const { page } = await h.open(`/${loc}/events/${LIVE}`, { width: 1440 });
      if ((await heroStatus(page)) !== "ongoing") return h.skip("participation live, no records", `record ${LIVE} not ongoing`);
      // Positive control: the actual list rendered (rows with reactions).
      const rows = await page.locator('section[id^="setlist-card-"] li[class*="__songRow"]').count();
      const tabs = await page.locator('section[id^="setlist-card-"] [role="tab"]').count();
      const p = await readPredicted(page);
      h.check("live, no records: actual only, no tabs, no share", rows > 0 && tabs === 0 && p.share === null, JSON.stringify({ rows, tabs, share: p.share }));
    });

    await h.section("participation live, no actual + records", async () => {
      const { page } = await h.open(`/${loc}/events/${LIVE_EMPTY}`, { width: 1440, beforeNavigate: seed(LIVE_EMPTY) });
      if ((await heroStatus(page)) !== "ongoing") return h.skip("participation live, no actual", `record ${LIVE_EMPTY} not ongoing`);
      await page.locator('section[id^="setlist-card-"]').getByText("TOKIMEKI Runners").first().waitFor();
      const p = await readPredicted(page);
      h.check("live, no actual: predictions read-only", p.removeButtons === 0 && !p.addButton && !p.search, JSON.stringify(p).slice(0, 120));
      h.check("live, no actual: share = prediction", p.share === tSharePred, String(p.share));
      await h.shot(page, "participation-live-empty-records-1440");
    });

    await h.section("participation completed + records", async () => {
      const { page } = await h.open(`/${loc}/events/${DONE}`, { width: 390, beforeNavigate: seed(DONE) });
      if ((await heroStatus(page)) !== "completed") return h.skip("participation completed", `record ${DONE} not completed`);
      await page.getByRole("tab", { name: tTabPred }).click();
      await page.locator('section[id^="setlist-card-"] [role="tabpanel"]').getByText("TOKIMEKI Runners").first().waitFor();
      const p = await readPredicted(page);
      h.check("completed: predictions read-only", p.removeButtons === 0 && !p.addButton && !p.search, "");
      h.check("completed: share = final", p.share === tShare, String(p.share));
      await h.shot(page, "participation-completed-records-390");
    });

    await h.section("participation open: edit, save, restore", async () => {
      const { page } = await h.open(`/${loc}/events/${OPEN}`, { width: 1440 });
      if ((await heroStatus(page)) !== "upcoming") return h.skip("participation open", `record ${OPEN} not upcoming`);
      const card = page.locator('section[id^="setlist-card-"]');
      const search = card.locator(`input[aria-label="${tSearch}"]`);
      await search.waitFor();
      h.check("open: picker entry visible (desktop inline)", await search.isVisible(), "");
      const option = card.locator('[role="button"][aria-pressed]').first();
      await option.waitFor();
      const before = await card.locator(`[aria-label="${tRemove}"]`).count();
      await option.click();
      await card.locator(`[aria-label="${tRemove}"]`).nth(before).waitFor();
      const saved = await page.evaluate((id) => JSON.parse(localStorage.getItem(`predict-${id}`) ?? "null")?.songs?.length ?? 0, OPEN);
      h.check("open: pick saved to localStorage", saved === before + 1, `${before} → ${saved}`);
      await page.reload({ waitUntil: "load" });
      await card.locator(`[aria-label="${tRemove}"]`).first().waitFor();
      const restored = await card.locator(`[aria-label="${tRemove}"]`).count();
      h.check("open: restored after reload", restored === saved, `${restored}/${saved}`);
      await h.shot(page, "participation-open-saved-1440");
    });

    await h.section("participation lock transition", async () => {
      // Clock pinned 20 s before the start: the page renders editable, then
      // the start-time timer must lock it without a reload.
      const probe = await h.open(`/${loc}/events/${OPEN}`, { width: 1440 });
      if ((await heroStatus(probe.page)) !== "upcoming") return h.skip("lock transition", `record ${OPEN} not upcoming`);
      const startIso = await probe.page.evaluate(() => document.querySelector('[data-testid="event-hero"] time, [data-testid="event-hero"] [datetime]')?.getAttribute("datetime") ?? null);
      await probe.ctx.close();
      const start = Date.parse(startIso ?? "2026-11-14T07:30:00.000Z");
      const { page } = await h.open(`/${loc}/events/${OPEN}`, {
        width: 1440,
        beforeNavigate: async (a) => {
          await seed(OPEN, { wishes: null })(a);
          await a.page.clock.install({ time: new Date(start - 20_000) });
        },
      });
      const card = page.locator('section[id^="setlist-card-"]');
      await card.locator(`[aria-label="${tRemove}"]`).first().waitFor();
      const editable = await readPredicted(page);
      h.check("lock: editable before start", editable.removeButtons === SEED_SONGS.length && editable.search, JSON.stringify({ r: editable.removeButtons, s: editable.search }));
      await page.clock.fastForward(40_000);
      await card.getByText(tLocked).first().waitFor({ timeout: 15_000 }).catch(() => {});
      const locked = await readPredicted(page);
      h.check("lock: read-only after start, no picker", locked.removeButtons === 0 && !locked.search && !locked.addButton, JSON.stringify({ r: locked.removeButtons, s: locked.search }));
      h.check("lock: saved predictions kept", SEED_SONGS.every((s) => locked.text.includes(s.song.originalTitle) || s.song.translations.some((t) => locked.text.includes(t.title))), "");
      await h.shot(page, "participation-lock-after-1440");
    });

    await h.section("participation board failure", async () => {
      const { page } = await h.open(`/${loc}/events/${OPEN}`, {
        width: 1440,
        beforeNavigate: ({ page }) => page.route(`**/api/events/${OPEN}/board**`, (r) => r.fulfill({ status: 500, body: "{}" })),
      });
      if ((await heroStatus(page)) !== "upcoming") return h.skip("board failure", `record ${OPEN} not upcoming`);
      const board = page.locator(`#fan-board-${OPEN}`);
      await board.waitFor();
      await page.waitForTimeout(1500);
      const text = await board.innerText();
      const search = await page.locator(`section[id^="setlist-card-"] input[aria-label="${tSearch}"]`).count();
      h.check("board failure: board says so, predictions stay editable", text.length > 0 && search > 0, text.slice(0, 120).replace(/\s+/g, " "));
      await h.shot(page, "participation-board-failure-1440");
    });

    await h.section("participation delayed live sync", async () => {
      const { page } = await h.open(`/${loc}/events/${LIVE}`, {
        width: 1440,
        beforeNavigate: ({ page }) => page.route("**/api/setlist**", (r) => r.abort()),
      });
      if ((await heroStatus(page)) !== "ongoing") return h.skip("delayed", `record ${LIVE} not ongoing`);
      const rows = page.locator('section[id^="setlist-card-"] li[class*="__songRow"]');
      const before = await rows.count();
      const delayed = await page
        .getByText(tDelayed)
        .first()
        .waitFor({ timeout: 120_000 })
        .then(() => true)
        .catch(() => false);
      h.check("delayed: notice says updates are delayed", delayed, "");
      h.check("delayed: last setlist kept", (await rows.count()) === before && before > 0, `${before} rows`);
      await h.shot(page, "participation-delayed-1440");
    }, { ms: 200_000 });

  },

  // A cancelled concert exists only as a fixture row (db-fixture-add with
  // status "cancelled", under the DB slot); the plain run never needs one.
  fixture: {
    needs: ["cancelled"],
    run: async (h, fx) => {
      const loc = "ko";
      await h.section("participation cancelled", async () => {
        const id = String(fx.cancelled);
        const { page } = await h.open(`/${loc}/events/${id}`, { width: 390, beforeNavigate: seed(id) });
        const status = await heroStatus(page);
        if (status !== "cancelled") return h.skip("cancelled", `fixture ${id} is ${status}`);
        const notice = await page.locator('main [role="status"]').first().innerText();
        h.check("cancelled: notice first", notice.includes(msg(loc, "EventDetail.cancelledTitle")), notice.slice(0, 60));
        const card = page.locator('section[id^="setlist-card-"]');
        const remove = await card.locator(`[aria-label="${msg(loc, "Predict.removeAria")}"]`).count();
        const search = await card.locator(`input[aria-label="${msg(loc, "Predict.picker.searchPlaceholder")}"]`).count();
        h.check("cancelled: no picker, no edits", remove === 0 && search === 0, JSON.stringify({ remove, search }));
        // The saved list stays readable (positive control for the two
        // absences above: the predicted surface did render).
        const text = await card.innerText();
        h.check("cancelled: saved predictions kept", SEED_SONGS.every((x) => text.includes(x.song.originalTitle) || x.song.translations.some((t) => text.includes(t.title))), `${text.length} chars`);
        await h.shot(page, "participation-cancelled-390");
      });
    },
  },
};

export default scenario;
