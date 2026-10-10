// Real-browser population for the browsers run: headless Chromium pages
// on the live event page, each with its own browser context (own
// supabase-js singleton, own websocket — one viewer per page).
//
// Measurement — what "the update reached the viewer" means here: the
// marker song's link (`a[href*="/songs/<id>/"]`, rendered by
// <SetlistRow> for every song on a row) appears in the page's DOM. An
// init script installs a MutationObserver before any app code runs; on
// every DOM mutation it re-scans the song links and reports additions /
// removals with the page's own `Date.now()` through an exposed binding.
// The page clock and the Node clock are the same OS clock, so these
// timestamps compare directly with the admin driver's save timestamps
// (the binding call itself is async, but it carries the page-side time).
//
// Diagnostics per page (cheap, from CDP events — no app changes):
//   - websocket frames: postgres_changes notifications (with the row id
//     and change type), the channel join reply, and the "Subscribed to
//     PostgreSQL" system message (pg_changes registration done);
//   - every `/api/setlist` response: time, `minRev` sent, status,
//     X-Snapshot-Source, and the `rev` in the body.
//
// Websocket control (drills) uses Playwright's `page.routeWebSocket`
// on the Realtime endpoint, only for the pages a drill needs:
//   - "proxy": the page talks to the real server through a pass-through
//     proxy in this process, which can (a) drop server→page
//     postgres_changes frames while `rec.dropPg` is set (silent loss:
//     the socket stays healthy, heartbeats and joins pass, only the
//     notification vanishes), and (b) close both legs at once
//     (network-blip / reconnect drill);
//   - "blocked": every connection attempt is closed immediately and
//     never reaches the server (websocket blocked by the network), so
//     realtime-js keeps failing and the page's R3 polling fallback must
//     carry it.
// Unrouted pages are left completely alone.
//
// Resource diet: images, media and fonts are aborted (the DOM is all we
// look at), as are Google Analytics and the Sentry tunnel (`/monitoring`)
// — a drill that pushes pages into the fallback would otherwise file
// "Realtime fallback to polling" events into the dev Sentry project.
import { chromium } from "playwright";

const INIT_SCRIPT = `(() => {
  const seen = new Set();
  const scan = () => {
    const t = Date.now();
    const cur = new Set();
    for (const a of document.querySelectorAll('a[href*="/songs/"]')) {
      const m = /\\/songs\\/(\\d+)(?:[/?#]|$)/.exec(a.getAttribute("href") || "");
      if (m) cur.add(m[1]);
    }
    const added = [];
    const removed = [];
    for (const id of cur) if (!seen.has(id)) { seen.add(id); added.push(id); }
    for (const id of Array.from(seen)) if (!cur.has(id)) { seen.delete(id); removed.push(id); }
    if ((added.length || removed.length) && typeof window.__oslReport === "function") {
      window.__oslReport({ t, added, removed });
    }
  };
  new MutationObserver(scan).observe(document, { childList: true, subtree: true, characterData: false });
  document.addEventListener("DOMContentLoaded", scan);
})();`;

const BLOCK_HOST = /(^|\.)(google-analytics\.com|googletagmanager\.com|doubleclick\.net|googlesyndication\.com|sentry\.io)$/;

function parseFrame(payload) {
  if (typeof payload !== "string") return null;
  if (!payload.includes("postgres_changes") && !payload.includes("phx_reply") && !payload.includes('"system"')) return null;
  let msg;
  try { msg = JSON.parse(payload); } catch { return null; }
  if (Array.isArray(msg)) {
    const [joinRef, ref, topic, event, body] = msg;
    return { joinRef, ref, topic, event, body };
  }
  return { joinRef: msg.join_ref, ref: msg.ref, topic: msg.topic, event: msg.event, body: msg.payload };
}

export async function launchPages({ count, base, eventPath, eventId, localeOf, routeMode, headless = true, concurrency = 5, log = console.log }) {
  const browser = await chromium.launch({
    headless,
    args: [
      // Every page must behave like a visible, foreground tab: the live
      // hook pauses its channel on `document.hidden`, and Chromium
      // throttles timers of background/occluded renderers.
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--disable-gpu",
    ],
  });
  const topic = `realtime:event:${eventId}`;
  const baseHost = new URL(base).hostname;
  const pages = [];

  const onFrame = (rec, payload) => {
    const f = parseFrame(payload);
    if (!f || f.topic !== topic) return f;
    const now = Date.now();
    if (f.event === "postgres_changes") {
      const d = f.body?.data;
      rec.notes.push([now, String(d?.type || "?")[0], String(d?.record?.id ?? d?.old_record?.id ?? "")]);
    } else if (f.event === "phx_reply" && f.ref != null && f.ref === f.joinRef && f.body?.status === "ok") {
      rec.joinAt.push(now);
    } else if (f.event === "system" && f.body?.extension === "postgres_changes" && f.body?.status === "ok") {
      rec.pgReadyAt.push(now);
    }
    return f;
  };

  async function openOne(idx) {
    const locale = localeOf[idx % localeOf.length];
    const mode = routeMode(idx); // "none" | "proxy" | "blocked"
    const rec = {
      idx, locale, mode,
      url: `${base}/${locale}${eventPath}`,
      openedAt: Date.now(), loadedAt: null, visibility: null,
      joinAt: [], pgReadyAt: [], wsOpens: 0, wsCloses: 0,
      seen: {}, gone: {}, notes: [], fetches: [], errors: [],
      dropPg: false, droppedFrames: 0, blockedAttempts: 0,
    };
    const context = await browser.newContext({ viewport: { width: 800, height: 900 }, locale: locale === "ko" ? "ko-KR" : locale === "en" ? "en-US" : "ja-JP" });
    await context.route("**/*", (route) => {
      const req = route.request();
      const type = req.resourceType();
      let u;
      try { u = new URL(req.url()); } catch { return route.continue(); }
      if (type === "image" || type === "media" || type === "font") return route.abort();
      if (BLOCK_HOST.test(u.hostname)) return route.abort();
      if (u.hostname === baseHost && (u.pathname.startsWith("/monitoring") || u.pathname.startsWith("/_vercel/"))) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    const routes = [];
    await page.exposeFunction("__oslReport", ({ t, added, removed }) => {
      for (const id of added) if (!(id in rec.seen)) rec.seen[id] = t;
      for (const id of removed) if (!(id in rec.gone)) rec.gone[id] = t;
    });
    await page.addInitScript(INIT_SCRIPT);
    page.on("pageerror", (e) => { if (rec.errors.length < 20) rec.errors.push(String(e.message).slice(0, 200)); });
    page.on("response", async (r) => {
      const u = r.url();
      if (!u.includes("/api/setlist?")) return;
      const t = Date.now();
      let minRev = null;
      try { minRev = new URL(u).searchParams.get("minRev"); } catch { /* keep null */ }
      const entry = [t, minRev === null ? null : Number(minRev), r.status(), r.headers()["x-snapshot-source"] || null, null];
      rec.fetches.push(entry);
      try {
        const txt = await r.text();
        const i = txt.lastIndexOf('"rev":');
        if (i >= 0) entry[4] = parseInt(txt.slice(i + 6), 10);
      } catch { /* body gone (navigation/close) */ }
    });

    if (mode === "none") {
      page.on("websocket", (ws) => {
        if (!ws.url().includes("/realtime/")) return;
        rec.wsOpens++;
        ws.on("framereceived", (f) => onFrame(rec, f.payload));
        ws.on("close", () => { rec.wsCloses++; });
      });
    } else {
      await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
        rec.wsOpens++;
        if (mode === "blocked") {
          rec.blockedAttempts++;
          Promise.resolve(ws.close()).catch(() => {});
          rec.wsCloses++;
          return;
        }
        const server = ws.connectToServer();
        const leg = { ws, server, closed: false };
        routes.push(leg);
        ws.onMessage((m) => { if (!leg.closed) try { server.send(m); } catch { /* leg closing */ } });
        server.onMessage((m) => {
          const f = onFrame(rec, m);
          if (rec.dropPg && f && f.topic === topic && f.event === "postgres_changes") {
            rec.droppedFrames++;
            return;
          }
          if (!leg.closed) try { ws.send(m); } catch { /* leg closing */ }
        });
        const closeBoth = () => {
          if (leg.closed) return;
          leg.closed = true;
          rec.wsCloses++;
          // close() returns a promise in Playwright; a rejected one (leg
          // already gone) must not become an unhandled rejection.
          const quiet = (fn) => { try { Promise.resolve(fn()).catch(() => {}); } catch { /* already closed */ } };
          quiet(() => ws.close());
          quiet(() => server.close());
        };
        ws.onClose(closeBoth);
        server.onClose(closeBoth);
        leg.closeBoth = closeBoth;
      });
    }

    try {
      await page.goto(rec.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      rec.loadedAt = Date.now();
      rec.visibility = await page.evaluate(() => document.visibilityState);
    } catch (e) {
      rec.errors.push(`goto: ${e.message.slice(0, 200)}`);
    }
    pages[idx] = { rec, page, context, routes };
  }

  // Open in small parallel waves: 30 simultaneous SSR renders + 30
  // hydrations would mostly measure this laptop's CPU.
  for (let i = 0; i < count; i += concurrency) {
    await Promise.all(Array.from({ length: Math.min(concurrency, count - i) }, (_, k) => openOne(i + k)));
    log(`  pages: ${Math.min(count, i + concurrency)}/${count} opened`);
  }

  return {
    pages,
    joined: () => pages.filter((p) => p && (p.rec.mode === "blocked" ? p.rec.loadedAt : p.rec.joinAt.length)).length,
    pgReady: () => pages.filter((p) => p && p.rec.pgReadyAt.length).length,
    setDropPg(indices, on) {
      for (const i of indices) if (pages[i]) pages[i].rec.dropPg = on;
    },
    // Close both legs of every proxied socket at once. Returns how many
    // live sockets were closed.
    dropSockets(indices) {
      let n = 0;
      for (const i of indices) {
        const p = pages[i];
        if (!p) continue;
        for (const leg of p.routes) if (!leg.closed && leg.closeBoth) { leg.closeBoth(); n++; }
      }
      return n;
    },
    async close() {
      await Promise.allSettled(pages.filter(Boolean).map((p) => p.context.close()));
      await browser.close().catch(() => {});
    },
  };
}
