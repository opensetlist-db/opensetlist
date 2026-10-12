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
// Besides the first-seen / first-gone time per song (`seen` / `gone`),
// every report is kept in order in `dom` ([t, added[], removed[]]): the
// page exposes no "applied rev", so the run derives the version the DOM
// shows from which marker songs are on it, and checks that it never goes
// backwards (a stale snapshot applied after a newer one would remove a
// newer marker or bring back a replaced one).
//
// Diagnostics per page (cheap, from CDP events — no app changes):
//   - websocket frames: the writer's `rev` broadcast (the R2 page's
//     notification) with its rev, the channel join reply, and — for an
//     R1 page build, which is what a preview runs until R2 deploys or
//     after a rollback — postgres_changes notifications (row id + change
//     type) and the "Subscribed to PostgreSQL" registration message;
//   - every `/api/setlist` response: time, `minRev` sent, status,
//     X-Snapshot-Source (incl. `warm` = served from the save's writer-
//     warmed entry), the `rev` in the body, the `x-snapshot-verify`
//     header, whether the request carried `hint=1`, and the request's
//     start time.
//
// Broadcast frames come in two encodings: realtime-js 2.x speaks the
// 2.0.0 protocol, where the server may push a user broadcast as a BINARY
// frame (kind byte 4, then topic / event / metadata lengths, the JSON
// encoding flag, and the bytes — `lib/serializer.js` `_decodeUserBroadcast`),
// or as the JSON array `[join_ref, ref, topic, "broadcast", {event,
// payload}]`. `parseFrame` decodes both, so a page's notifications are
// seen (and droppable) whatever the server chooses.
//
// Websocket control (drills) uses Playwright's `page.routeWebSocket`
// on the Realtime endpoint, only for the pages a drill needs:
//   - "proxy": the page talks to the real server through a pass-through
//     proxy in this process, which can (a) drop server→page
//     notification frames — the `rev` broadcast and, for an R1 build,
//     postgres_changes — while `rec.dropNotify` is set (silent loss:
//     the socket stays healthy, heartbeats and joins pass, only the
//     notification vanishes), and (b) close both legs at once
//     (network-blip / reconnect drill);
//   - "blocked": every connection attempt is closed immediately and
//     never reaches the server (websocket blocked by the network), so
//     realtime-js keeps failing and the page's R3 polling fallback must
//     carry it.
// Unrouted pages are left completely alone. The page's own drill hook
// (`window.__osl.dropNextNotification`, honoured on non-production
// builds: the hook drops the next VALID notification before it reaches
// the hint batch) needs no proxy: `armHookDrop` sets it in the page,
// `hookDropPending` says whether the page has consumed it yet.
//
// Resource diet: images, media and fonts are aborted (the DOM is all we
// look at), as are Google Analytics and the Sentry tunnel (`/monitoring`)
// — a drill that pushes pages into the fallback would otherwise file
// "Realtime fallback to polling" events into the dev Sentry project.
import { chromium } from "playwright";
import { dplIdOf, pinEvidence } from "./transition.mjs";

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

// n14 step 5 (`run.mjs --phase=admission` only): the ordered setlist
// rows as rendered. <SetlistRow> is the only component that renders an
// <li> with the `grid-cols-[28px_1fr]` grid (src/components/SetlistRow.tsx;
// <ActualSetlist> renders the main rows, then the encore rows, each in
// its own <ol>), and inside a row every song is ONE link
// `/<locale>/songs/<id>[/<slug>]` in SetlistItemSong order (a medley =
// several links; a blank "song TBC" or non-song row = no link; the unit
// badges link to /artists/, not /songs/). So a row's signature is its
// ordered song-id list joined with "+", "" for a row without a song, and
// the page's signature is the list of row signatures in DOM order. React
// keys are not in the DOM; nothing is added to the app for this. Checked
// against the live page of event 111 (23/23 rows incl. the medley and
// the encore row, ja and ko) when the scan was written; if the markup
// changes, the report's "ordered rows matched n/m" column drops instead
// of a false "complete". Reported only when the signature changes.
const ROWS_SCRIPT = `(() => {
  let last = null;
  const scan = () => {
    const rows = [];
    for (const li of document.querySelectorAll('li[class*="grid-cols-[28px_1fr]"]')) {
      const ids = [];
      for (const a of li.querySelectorAll('a[href*="/songs/"]')) {
        const m = /\\/songs\\/(\\d+)(?:[/?#]|$)/.exec(a.getAttribute("href") || "");
        if (m) ids.push(m[1]);
      }
      rows.push(ids.join("+"));
    }
    const key = rows.join("|");
    if (key === last) return;
    last = key;
    if (typeof window.__oslRows === "function") window.__oslRows({ t: Date.now(), rows });
  };
  new MutationObserver(scan).observe(document, { childList: true, subtree: true, characterData: false });
  document.addEventListener("DOMContentLoaded", scan);
})();`;

// n14 step 8 (`wake-check.mjs`, option `rowText`): a fingerprint of the
// visible setlist rows' TEXT, reported on every change. The song-id
// signature above (ROWS_SCRIPT) only moves when a row's songs change; a
// check save on production may instead touch a row's status, unit or
// performers, and the wake check must still see "the save became
// visible". So: the text of every <SetlistRow> <li> (same selector as
// ROWS_SCRIPT), EXCLUDING text inside <button> elements — the reaction
// buttons live inside the rows and their counts move whenever any
// viewer reacts, which on production would read as a phantom update.
// A cheap 32-bit FNV-1a hash of the joined text plus the row count is
// enough to say "changed / not changed"; the text itself is not kept.
const ROW_TEXT_SCRIPT = `(() => {
  let last = null;
  const textOf = (li) => {
    let out = "";
    const w = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.parentElement && n.parentElement.closest("button")) continue;
      out += n.nodeValue;
    }
    return out.replace(/\\s+/g, " ").trim();
  };
  const scan = () => {
    const lis = document.querySelectorAll('li[class*="grid-cols-[28px_1fr]"]');
    let h = 0x811c9dc5;
    const all = Array.from(lis, textOf).join("\\u0001");
    for (let i = 0; i < all.length; i++) { h ^= all.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    const key = lis.length + ":" + h.toString(16);
    if (key === last) return;
    last = key;
    if (typeof window.__oslRowText === "function") window.__oslRowText({ t: Date.now(), n: lis.length, h: key });
  };
  new MutationObserver(scan).observe(document, { childList: true, subtree: true, characterData: true });
  document.addEventListener("DOMContentLoaded", scan);
})();`;

// The SSR seed in the page HTML: the RSC payload carries LiveEventLayout's
// `initialRev` prop — a number when the page was rendered from the live
// snapshot, null when the live seed was unavailable (the page's degraded
// path, `[eventPage] live seed unavailable`) or the event is not ongoing.
// Inside the flight script the quotes are escaped (`\"initialRev\":123`).
export function seedOf(html) {
  if (typeof html !== "string") return { kind: "unknown", rev: null };
  const m = /\\?"initialRev\\?":(null|\d+)/.exec(html);
  if (!m) return { kind: "unknown", rev: null };
  return m[1] === "null" ? { kind: "absent", rev: null } : { kind: "live", rev: Number(m[1]) };
}

const BLOCK_HOST = /(^|\.)(google-analytics\.com|googletagmanager\.com|doubleclick\.net|googlesyndication\.com|sentry\.io)$/;

// Binary user broadcast (protocol 2.0.0), see the header. Returns null
// for any other binary frame.
const USER_BROADCAST_KIND = 4;
const JSON_ENCODING = 1;
function parseBinaryFrame(buf) {
  if (buf.length < 5 || buf[0] !== USER_BROADCAST_KIND) return null;
  const topicSize = buf[1];
  const eventSize = buf[2];
  const metaSize = buf[3];
  const encoding = buf[4];
  let off = 5;
  const topic = buf.subarray(off, off + topicSize).toString("utf8");
  off += topicSize;
  const event = buf.subarray(off, off + eventSize).toString("utf8");
  off += eventSize + metaSize;
  let payload = null;
  if (encoding === JSON_ENCODING) {
    try { payload = JSON.parse(buf.subarray(off).toString("utf8")); } catch { payload = null; }
  }
  return { joinRef: null, ref: null, topic, event: "broadcast", body: { type: "broadcast", event, payload } };
}

function parseFrame(payload) {
  if (payload && typeof payload !== "string") {
    // Playwright hands binary frames over as a Buffer.
    try { return parseBinaryFrame(Buffer.isBuffer(payload) ? payload : Buffer.from(payload)); } catch { return null; }
  }
  if (typeof payload !== "string") return null;
  if (!payload.includes("postgres_changes") && !payload.includes("phx_reply") && !payload.includes('"system"') && !payload.includes('"broadcast"')) return null;
  let msg;
  try { msg = JSON.parse(payload); } catch { return null; }
  if (Array.isArray(msg)) {
    const [joinRef, ref, topic, event, body] = msg;
    return { joinRef, ref, topic, event, body };
  }
  return { joinRef: msg.join_ref, ref: msg.ref, topic: msg.topic, event: msg.event, body: msg.payload };
}

// A server→page frame that carries a live notification: the `rev`
// broadcast (R2) or a postgres_changes event (R1 build).
const isNotification = (f) =>
  f.event === "postgres_changes" || (f.event === "broadcast" && f.body?.event === "rev");

// `admission` (n14 step 5, run.mjs --phase=admission): additionally
// record per page the ordered setlist rows (ROWS_SCRIPT, `rowsLog`), the
// navigation timing (navigation start = the browser's timeOrigin, TTFB,
// DOMContentLoaded), the document's HTTP status, the SSR seed (`seed`,
// see seedOf), the launch wave, the first /api/setlist request and the
// first Realtime websocket (hydration readiness: the live hook only opens
// either once React has mounted it). Off: the record is unchanged.
//
// `transition` (n14 step 6, run.mjs --phase=transition): additionally
// record per page the document's `data-dpl-id` (the build the tab runs —
// Skew Protection stamps the serving deployment on <html>) and the
// document's x-vercel-id; per /api/setlist response the extended row
// (x-vercel-id, cache headers, age, pin evidence from the request as
// sent incl. its Cookie header, body-complete time, request URL); every
// framework asset response (`/_next/…`: status, `dpl` query pin) so "no
// chunk 404 after the switch" is only claimed for assets old tabs
// actually fetched after it; failed setlist requests; main-frame
// navigations (an unexpected reload is a continuity failure); page
// errors with their time; and the postgres_changes receipts with the
// row's `isDeleted` (a soft-delete is an UPDATE). `cohort` labels every
// page of this call; `extend()` opens more pages (arrivals) in the same
// browser. Off: the record is unchanged.
//
// `spam7` (n14 step 7, run.mjs --phase=spam7): additionally record per
// page every main-frame DOCUMENT load (`docLoads` [t, status]: the first
// is the page's own load, any later one an unexpected reload), every
// failed /api/setlist request (`reqFailed` [t, path+query, failure] —
// transport failures never produce a response row) and page errors with
// their time (`pageErrs` [t, message]). Independently of the option, a
// `rev` broadcast whose payload carries the step-7 sender's `runId`
// gets the correlation columns [runId, k] appended to its `bcasts` row,
// recorded at the frame (before the page's own handler sees it); no
// other run sends a `runId`, so their rows are unchanged.
//
// n14 step 8 (`wake-check.mjs`):
//   `rowText` — record `rowTextLog` [t, row count, fingerprint] from
//     ROW_TEXT_SCRIPT on every change of the rows' visible text;
//   `readOnly` — the page may only READ: every request whose method is
//     not GET / HEAD / OPTIONS is aborted before it leaves the browser
//     and recorded in `blockedWrites` [t, method, host+path (≤ 120)]. A
//     wake check on production must not file an impression, reaction or
//     wish (or a Sentry event) on the operator's behalf, even if an app
//     change one day makes the page POST on load. Websockets are not
//     HTTP requests and are untouched (the Realtime subscription is the
//     thing being checked).
// Both off: the record and the routing are unchanged.
export async function launchPages({ count, base, eventPath, eventId, localeOf, routeMode, headless = true, concurrency = 5, log = console.log, admission = false, transition = false, cohort = null, spam7 = false, rowText = false, readOnly = false }) {
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
      const note = [now, String(d?.type || "?")[0], String(d?.record?.id ?? d?.old_record?.id ?? "")];
      // transition: + the row's isDeleted (true / false / null when the
      // payload carries no record) and the table — a soft-delete is an
      // UPDATE with isDeleted true, never a DELETE frame.
      if (transition) note.push(typeof d?.record?.isDeleted === "boolean" ? d.record.isDeleted : null, d?.table ?? null);
      rec.notes.push(note);
    } else if (f.event === "broadcast" && f.body?.event === "rev") {
      const p = f.body?.payload;
      const rev = p?.rev;
      const row = [now, typeof rev === "number" ? rev : null, rec.dropNotify ? "x" : "n"];
      if (p && typeof p.runId === "string") row.push(p.runId, Number.isSafeInteger(p.k) ? p.k : null);
      rec.bcasts.push(row);
    } else if (f.event === "phx_reply" && f.ref != null && f.ref === f.joinRef && f.body?.status === "ok") {
      rec.joinAt.push(now);
    } else if (f.event === "system" && f.body?.extension === "postgres_changes" && f.body?.status === "ok") {
      rec.pgReadyAt.push(now);
    }
    return f;
  };

  async function openOne(idx, { cohortLabel = cohort, wave = Math.floor(idx / concurrency) } = {}) {
    const locale = localeOf[idx % localeOf.length];
    const mode = routeMode(idx); // "none" | "proxy" | "blocked"
    const rec = {
      idx, locale, mode,
      url: `${base}/${locale}${eventPath}`,
      openedAt: Date.now(), loadedAt: null, visibility: null,
      joinAt: [], pgReadyAt: [], wsOpens: 0, wsCloses: 0,
      // notes: R1 postgres_changes [t, type, row id]; bcasts: `rev`
      // broadcasts [t, rev, "n" | "x" (dropped by the proxy drill)].
      seen: {}, gone: {}, dom: [], notes: [], bcasts: [], fetches: [], errors: [],
      dropNotify: false, droppedFrames: 0, blockedAttempts: 0,
    };
    if (transition) {
      Object.assign(rec, {
        cohort: cohortLabel, docDplId: null, docVercelId: null,
        // [t, status, dpl query (null = unpinned), path (≤ 80 chars)]
        assets: [],
        // [t, url path+query (≤ 120), failure text]
        reqFailed: [],
        // [t, url, status, x-vercel-id, data-dpl-id] main-frame DOCUMENT
        // loads (the first is the load; later ones are reloads)
        navs: [],
        // [t, message]
        pageErrs: [],
      });
    }
    if (spam7 && !transition) Object.assign(rec, { docLoads: [], reqFailed: [], pageErrs: [] });
    if (rowText) rec.rowTextLog = [];
    if (readOnly) rec.blockedWrites = [];
    if (admission) {
      Object.assign(rec, {
        wave, launchedAt: Date.now(),
        rowsLog: [], navStart: null, ttfbMs: null, dclMs: null, docStatus: null, docBytes: null,
        seed: { kind: "unknown", rev: null }, firstApiReqAt: null, wsOpenAt: null,
      });
    }
    const context = await browser.newContext({ viewport: { width: 800, height: 900 }, locale: locale === "ko" ? "ko-KR" : locale === "en" ? "en-US" : "ja-JP" });
    await context.route("**/*", (route) => {
      const req = route.request();
      const type = req.resourceType();
      let u;
      if (readOnly && !["GET", "HEAD", "OPTIONS"].includes(req.method())) {
        let where = req.url();
        try { const x = new URL(where); where = x.host + x.pathname; } catch { /* keep raw */ }
        if (rec.blockedWrites.length < 100) rec.blockedWrites.push([Date.now(), req.method(), where.slice(0, 120)]);
        return route.abort();
      }
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
      rec.dom.push([t, added, removed]);
    });
    await page.addInitScript(INIT_SCRIPT);
    if (rowText) {
      await page.exposeFunction("__oslRowText", ({ t, n, h }) => { rec.rowTextLog.push([t, n, h]); });
      await page.addInitScript(ROW_TEXT_SCRIPT);
    }
    if (admission) {
      await page.exposeFunction("__oslRows", ({ t, rows }) => { rec.rowsLog.push([t, rows]); });
      await page.addInitScript(ROWS_SCRIPT);
      page.on("request", (q) => {
        if (rec.firstApiReqAt == null && q.url().includes("/api/setlist?")) rec.firstApiReqAt = Date.now();
      });
      page.on("response", async (r) => {
        if (!r.request().isNavigationRequest() || r.frame() !== page.mainFrame()) return;
        rec.docStatus = r.status();
        try {
          const html = await r.text();
          rec.docBytes = Buffer.byteLength(html);
          rec.seed = seedOf(html);
        } catch { /* body gone */ }
      });
    }
    page.on("pageerror", (e) => {
      if (rec.errors.length < 20) rec.errors.push(String(e.message).slice(0, 200));
      if ((transition || spam7) && rec.pageErrs.length < 50) rec.pageErrs.push([Date.now(), String(e.message).slice(0, 200)]);
    });
    if (spam7 && !transition) {
      page.on("requestfailed", (q) => {
        const u = q.url();
        if (!u.includes("/api/setlist?")) return;
        if (rec.reqFailed.length < 200) rec.reqFailed.push([Date.now(), u.replace(/^https?:\/\/[^/]+/, "").slice(0, 120), String(q.failure()?.errorText ?? "").slice(0, 80)]);
      });
      page.on("response", (r) => {
        if (r.request().isNavigationRequest() && r.frame() === page.mainFrame() && rec.docLoads.length < 50) rec.docLoads.push([Date.now(), r.status()]);
      });
    }
    if (transition) {
      page.on("requestfailed", (q) => {
        const u = q.url();
        if (!u.includes("/api/") && !u.includes("/_next/")) return;
        if (rec.reqFailed.length < 200) rec.reqFailed.push([Date.now(), u.replace(/^https?:\/\/[^/]+/, "").slice(0, 120), String(q.failure()?.errorText ?? "").slice(0, 80)]);
      });
      page.on("response", async (r) => {
        const u = r.url();
        let url;
        try { url = new URL(u); } catch { return; }
        if (url.hostname !== baseHost) return;
        if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) {
          // A DOCUMENT load (the first one is the page's own load; any
          // later one is a reload). Same-document navigations (the app's
          // history.replaceState) fetch no document and are not counted —
          // `framenavigated` would count them.
          // [t, url, status, x-vercel-id, data-dpl-id]; the page's build
          // (docDplId / docVercelId) is its FIRST document's.
          const nav = [Date.now(), u.slice(0, 160), r.status(), r.headers()["x-vercel-id"] ?? null, null];
          rec.navs.push(nav);
          if (rec.docVercelId == null) rec.docVercelId = nav[3];
          try { nav[4] = dplIdOf(await r.text()); } catch { /* body gone */ }
          if (rec.docDplId == null) rec.docDplId = nav[4];
          return;
        }
        if (url.pathname.startsWith("/_next/") && rec.assets.length < 2000) {
          rec.assets.push([Date.now(), r.status(), url.searchParams.get("dpl"), url.pathname.slice(0, 80)]);
        }
      });
    }
    page.on("response", async (r) => {
      const u = r.url();
      if (!u.includes("/api/setlist?")) return;
      const t = Date.now();
      let minRev = null;
      let hint = false;
      try {
        const sp = new URL(u).searchParams;
        minRev = sp.get("minRev");
        hint = sp.get("hint") === "1";
      } catch { /* keep defaults */ }
      // [t, minRev, status, x-snapshot-source, body rev, x-snapshot-verify
      //  (raw; null = absent), hint=1 sent, request start, body capturedAt]
      // capturedAt (epoch ms, the snapshot transaction's PostgreSQL now())
      // is appended after every pre-existing column (step 4); null when the
      // body is unreadable or predates the field. Page application stays
      // DOM-based: this records what arrived, not what React applied.
      // `t` is when the response arrived; request start (epoch ms, from
      // the browser's resource timing; null if unavailable) is the
      // "request arrival − commit" side of warm-join.mjs: whether a
      // hinted fetch could have found the save's warm entry depends on
      // when it LEFT, not on how long a miss then took to build.
      const h = r.headers();
      let reqStart = null;
      try {
        const st = r.request().timing().startTime;
        if (Number.isFinite(st) && st > 0) reqStart = Math.round(st);
      } catch { /* timing not available */ }
      const entry = [t, minRev === null ? null : Number(minRev), r.status(), h["x-snapshot-source"] || null, null, h["x-snapshot-verify"] ?? null, hint, reqStart, null];
      // transition: 9 x-vercel-id, 10 x-vercel-cache, 11 cache-control,
      // 12 age, 13 pin evidence (from the request AS SENT, incl. the
      // Cookie header — allHeaders() below), 14 body complete, 15 path +
      // query of the request.
      if (transition) entry.push(h["x-vercel-id"] ?? null, h["x-vercel-cache"] ?? null, h["cache-control"] ?? null, h.age ?? null, null, null, u.replace(/^https?:\/\/[^/]+/, "").slice(0, 160));
      rec.fetches.push(entry);
      if (transition) {
        try { entry[13] = pinEvidence(u, await r.request().allHeaders()); } catch { entry[13] = pinEvidence(u, r.request().headers()); }
      }
      try {
        const txt = await r.text();
        if (transition) entry[14] = Date.now();
        const i = txt.lastIndexOf('"rev":');
        if (i >= 0) entry[4] = parseInt(txt.slice(i + 6), 10);
        // String scan, not JSON.parse: 30 pages × ~80 KB bodies per save
        // on the main thread. `capturedAt` is a top-level field written
        // after `items`, so the LAST occurrence is the body's own.
        const j = txt.lastIndexOf('"capturedAt":"');
        if (j >= 0) {
          const v = Date.parse(txt.slice(j + 14, txt.indexOf('"', j + 14)));
          if (Number.isFinite(v)) entry[8] = v;
        }
      } catch { /* body gone (navigation/close) */ }
    });

    if (mode === "none") {
      page.on("websocket", (ws) => {
        if (!ws.url().includes("/realtime/")) return;
        if (admission && rec.wsOpenAt == null) rec.wsOpenAt = Date.now();
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
          if (rec.dropNotify && f && f.topic === topic && isNotification(f)) {
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
      const resp = await page.goto(rec.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      rec.loadedAt = Date.now();
      rec.visibility = await page.evaluate(() => document.visibilityState);
      if (admission) {
        if (resp && rec.docStatus == null) rec.docStatus = resp.status();
        // Navigation Timing (page clock = this host's clock): navigation
        // start = timeOrigin + startTime (0), TTFB = responseStart,
        // DOMContentLoaded = its event end (start if the end is not yet
        // stamped).
        const nt = await page.evaluate(() => {
          const n = performance.getEntriesByType("navigation")[0];
          return { origin: performance.timeOrigin, start: n?.startTime ?? 0, resp: n?.responseStart ?? null, dcl: n?.domContentLoadedEventEnd || n?.domContentLoadedEventStart || null };
        }).catch(() => null);
        if (nt) {
          rec.navStart = Math.round(nt.origin + nt.start);
          rec.ttfbMs = nt.resp == null ? null : Math.round(nt.resp - nt.start);
          rec.dclMs = nt.dcl == null ? null : Math.round(nt.dcl - nt.start);
        }
      }
    } catch (e) {
      rec.errors.push(`goto: ${e.message.slice(0, 200)}`);
    }
    pages[idx] = { rec, page, context, routes };
  }
  // (arrivals: see `extend` below; openOne fills pages[idx] in place)

  // Open in small parallel waves: 30 simultaneous SSR renders + 30
  // hydrations would mostly measure this laptop's CPU.
  for (let i = 0; i < count; i += concurrency) {
    await Promise.all(Array.from({ length: Math.min(concurrency, count - i) }, (_, k) => openOne(i + k)));
    log(`  pages: ${Math.min(count, i + concurrency)}/${count} opened`);
  }

  return {
    pages,
    // n14 step 6 arrivals: `count` more pages in this browser, indices
    // continuing after the existing ones, in waves of `concurrency`
    // (wave numbers restart at 0 for the arrival), labelled `cohort`.
    // Resolves when every page of the arrival has navigated (or failed).
    async extend({ count: more, cohort: label }) {
      const from = pages.length;
      // Reserve the slots first so a concurrent extend cannot reuse them.
      for (let i = 0; i < more; i++) pages.push(undefined);
      const firstIdx = from;
      for (let i = 0; i < more; i += concurrency) {
        await Promise.all(Array.from({ length: Math.min(concurrency, more - i) }, (_, k) => openOne(from + i + k, { cohortLabel: label, wave: Math.floor((i + k) / concurrency) })));
        log(`  pages (${label}): ${Math.min(more, i + concurrency)}/${more} opened`);
      }
      return { firstIdx, count: more };
    },
    // Run `fn(arg)` inside page i (the page's own origin, cookies and
    // localStorage); null when the page is gone.
    async evaluate(i, fn, arg) {
      if (!pages[i]) return null;
      return pages[i].page.evaluate(fn, arg);
    },
    joined: () => pages.filter((p) => p && (p.rec.mode === "blocked" ? p.rec.loadedAt : p.rec.joinAt.length)).length,
    // R1 page builds only (an R2 page registers no postgres_changes).
    pgReady: () => pages.filter((p) => p && p.rec.pgReadyAt.length).length,
    // Proxy drop of every notification frame (proxied pages only).
    setDropNotify(indices, on) {
      for (const i of indices) if (pages[i]) pages[i].rec.dropNotify = on;
    },
    // The page's own drill hook: drop the NEXT valid notification once.
    // Works on any routing mode; returns how many pages were armed.
    async armHookDrop(indices) {
      const r = await Promise.all(indices.map((i) => pages[i]?.page
        .evaluate(() => { window.__osl = Object.assign(window.__osl || {}, { dropNextNotification: true }); return true; })
        .catch(() => false)));
      return r.filter(Boolean).length;
    },
    // Whether page i still holds an unconsumed hook drop (null = gone).
    async hookDropPending(i) {
      if (!pages[i]) return null;
      return pages[i].page.evaluate(() => window.__osl?.dropNextNotification === true).catch(() => null);
    },
    // Clear the hook drop; returns how many pages still had it armed
    // (never consumed).
    async disarmHookDrop(indices) {
      const r = await Promise.all(indices.map((i) => pages[i]?.page
        .evaluate(() => {
          const was = window.__osl?.dropNextNotification === true;
          if (window.__osl) window.__osl.dropNextNotification = false;
          return was;
        })
        .catch(() => false)));
      return r.filter(Boolean).length;
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
    // --drill=overlap --overlap-page-reaction=1: the reaction ack-hold
    // test on page i (see armAckHold below).
    armAckHold: (i, opts) => armAckHold(pages[i], opts),
    async close() {
      await Promise.allSettled(pages.filter(Boolean).map((p) => p.context.close()));
      await browser.close().catch(() => {});
    },
  };
}

// ─── reaction ack-hold test (run.mjs --drill=overlap --overlap-page-reaction=1) ───
// What it must expose (design §2.4): the acknowledgement of this page's
// own reaction succeeds; THEN a snapshot that was read BEFORE the
// reaction committed (capturedAt ≤ ackAt, a lower count for that item)
// reaches <ReactionButtons> while the acknowledged display is held; THEN
// a snapshot captured after the ack releases the hold. Without a server
// fault the only way to make an older snapshot land after the ack is to
// hold one genuine response back in this page:
//
//   arm   page.route on /api/setlist: the FIRST hinted request (`hint=1`,
//         the page's notification fetch of the group's save A) is sent to
//         the server for real (route.fetch) and its response is held;
//   run   once a response is held: click the reaction button on anchor
//         row A (in the page, element.click() — React's onClick), wait
//         for the POST /api/reactions response (reactionId, counts,
//         ackAt), then release the held response (route.fulfill), let
//         everything after it through, and sample the button's displayed
//         count every 20 ms in the page until a snapshot with capturedAt
//         > ackAt has arrived (+2 s) or the window ends.
//
// The held response was requested before the click and fully received
// before it, so its snapshot predates the reaction. The page's own 8 s
// fetch deadline bounds the hold: it is released after `holdMaxMs` at the
// latest even if the click or the ack failed (the trace then says why
// the test was not exercised). The row is found by its marker song link
// (`a[href*="/songs/<id>/"]` inside the row's <li>) — any of the run's A
// markers, since save A swaps the song on the row — and the button by
// its position among the row's `button[aria-pressed]` (REACTION_TYPES
// order, src/lib/reactions.ts). A DOM change that breaks this shows up as
// "button not found" in the trace and the verdict reads "not exercised",
// never a pass.
async function armAckHold(p, { anchorId, markerIds, typeIndex, reactionType, holdMaxMs = 5000, waitHintMs = 10000, windowMs = 30000 }) {
  if (!p) return { run: async () => ({ error: "page not open" }) };
  const { page } = p;
  const responses = []; // [t, capturedAtMs, count, rev]
  const countOf = (body) => Number(body?.reactionCounts?.[String(anchorId)]?.[reactionType] ?? 0);
  const capOf = (body) => {
    const v = typeof body?.capturedAt === "string" ? Date.parse(body.capturedAt) : NaN;
    return Number.isFinite(v) ? v : null;
  };
  const onResp = async (r) => {
    if (!r.url().includes("/api/setlist?")) return;
    const t = Date.now();
    try {
      const body = await r.json();
      responses.push([t, capOf(body), countOf(body), Number.isSafeInteger(body?.rev) ? body.rev : null]);
    } catch { /* body gone */ }
  };
  page.on("response", onResp);
  let held = null;
  let captured;
  const capturedP = new Promise((res) => { captured = res; });
  let release;
  const releasedP = new Promise((res) => { release = res; });
  let taken = false;
  const handler = async (route) => {
    const u = route.request().url();
    if (taken || !u.includes("/api/setlist?") || !/[?&]hint=1(?:&|$)/.test(u)) return route.fallback();
    taken = true;
    const reqAt = Date.now();
    let resp;
    try {
      resp = await route.fetch();
    } catch (e) {
      captured({ error: `held fetch failed: ${String(e?.message || e).slice(0, 80)}` });
      return route.abort().catch(() => {});
    }
    let body = null;
    try { body = JSON.parse(await resp.text()); } catch { /* not JSON */ }
    held = { reqAt, gotAt: Date.now(), status: resp.status(), rev: Number.isSafeInteger(body?.rev) ? body.rev : null, capturedAtMs: capOf(body), count: body ? countOf(body) : null, releasedAt: null };
    captured(held);
    await Promise.race([releasedP, new Promise((r) => setTimeout(r, holdMaxMs))]);
    held.releasedAt = Date.now();
    await route.fulfill({ response: resp }).catch((e) => { held.fulfillError = String(e?.message || e).slice(0, 80); });
  };
  await page.route("**/api/setlist*", handler);
  const disarm = async () => {
    release();
    await page.unroute("**/api/setlist*", handler).catch(() => {});
  };

  async function run() {
    const trace = { anchorId: String(anchorId), reactionType, armedAt: Date.now(), held: null, ack: null, clickAt: null, samples: [], responses, error: null };
    try {
      const c = await Promise.race([capturedP, new Promise((r) => setTimeout(() => r(null), waitHintMs))]);
      if (!c) { trace.error = `no hinted fetch within ${waitHintMs} ms`; return trace; }
      if (c.error) { trace.error = c.error; return trace; }
      // Sampler first, so the display before the click is on record too.
      await page.evaluate(({ ids, idx }) => {
        const out = [];
        window.__oslRx = out;
        let last = null;
        const find = () => {
          for (const id of ids) {
            for (const a of document.querySelectorAll(`a[href*="/songs/${id}/"]`)) {
              const li = a.closest("li");
              const b = li ? li.querySelectorAll("button[aria-pressed]")[idx] : null;
              if (b) return { b, id };
            }
          }
          return null;
        };
        window.__oslRxFind = find;
        const tick = () => {
          const f = find();
          const digits = f ? (f.b.textContent || "").replace(/\D/g, "") : null;
          const v = f ? [digits === "" ? 0 : Number(digits), f.b.getAttribute("aria-pressed"), f.id] : [null, null, null];
          const key = v.join("|");
          if (key !== last) { last = key; out.push([Date.now(), ...v]); }
        };
        tick();
        window.__oslRxTimer = setInterval(tick, 20);
      }, { ids: markerIds.map(String), idx: typeIndex });
      const ackP = page.waitForResponse((r) => r.url().includes("/api/reactions") && r.request().method() === "POST", { timeout: 10000 })
        .then(async (r) => {
          const recvAt = Date.now();
          let body = null;
          try { body = await r.json(); } catch { /* not JSON */ }
          const ackAtMs = typeof body?.ackAt === "string" ? Date.parse(body.ackAt) : NaN;
          return { recvAt, status: r.status(), reactionId: body?.reactionId ?? null, ackAt: body?.ackAt ?? null, ackAtMs: Number.isFinite(ackAtMs) ? ackAtMs : null, count: body?.counts ? Number(body.counts[reactionType] ?? 0) : null };
        })
        .catch((e) => ({ error: String(e?.message || e).slice(0, 80) }));
      trace.clickAt = await page.evaluate(() => {
        const f = window.__oslRxFind();
        if (!f) return null;
        f.b.click();
        return Date.now();
      });
      if (trace.clickAt == null) { trace.error = "reaction button not found in the DOM (selector unstable?)"; return trace; }
      const ack = await ackP;
      trace.ack = ack;
      // Release only now: the held, pre-click snapshot must reach the
      // component AFTER the acknowledgement.
      release();
      if (ack.error) { trace.error = `no POST /api/reactions response: ${ack.error}`; return trace; }
      const end = Date.now() + windowMs;
      let relAt = null;
      while (Date.now() < end) {
        if (relAt == null && ack.ackAtMs != null) {
          const rel = responses.find((x) => x[0] >= ack.recvAt && x[1] != null && x[1] > ack.ackAtMs);
          if (rel) relAt = rel[0];
        }
        if (relAt != null && Date.now() > relAt + 2000) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      return trace;
    } catch (e) {
      trace.error = trace.error ?? `ack-hold: ${String(e?.message || e).slice(0, 120)}`;
      return trace;
    } finally {
      await disarm();
      page.off("response", onResp);
      trace.held = held;
      trace.samples = await page.evaluate(() => {
        clearInterval(window.__oslRxTimer);
        return window.__oslRx || [];
      }).catch(() => []);
      trace.endedAt = Date.now();
    }
  }
  return { run };
}
