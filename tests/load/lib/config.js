// Shared configuration + helpers for the k6 capacity harness (n12).
//
// Everything is driven by environment variables so the same scripts
// run against `next start` on a laptop, the dev Vercel preview, or —
// for the read-only confirmation run only — prod on a throwaway event.
// See tests/load/README.md for the full variable list and the run
// order (ramp → hold → burst).
//
// This file is plain k6 JavaScript (goja runtime), not Node: no npm
// imports, no `process.env` — `__ENV` is the k6 equivalent.

import http from "k6/http";
import { check } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

export function requireEnv(name) {
  const v = __ENV[name];
  if (!v) {
    throw new Error(`missing required env var ${name} (see tests/load/README.md)`);
  }
  return v;
}

// Trailing slash stripped so `${BASE_URL}/api/...` never doubles up.
export const BASE_URL = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
export const EVENT_ID = __ENV.EVENT_ID || "";
export const EVENT_SLUG = __ENV.EVENT_SLUG || "";

// Row-count correctness gate. EXPECTED_ROWS is the number of non-deleted
// setlist items on the test event when the run starts. The admin-write
// loop in the hold run temporarily adds up to 2 rows per cycle, so the
// hold run passes ROW_SLACK=2 and a response is "correct" when its row
// count lies in [EXPECTED_ROWS, EXPECTED_ROWS + ROW_SLACK]. Unset →
// only shape is checked (valid JSON, `items` array, `status` present).
export const EXPECTED_ROWS = __ENV.EXPECTED_ROWS ? parseInt(__ENV.EXPECTED_ROWS, 10) : null;
export const ROW_SLACK = __ENV.ROW_SLACK ? parseInt(__ENV.ROW_SLACK, 10) : 0;

// Fraction of snapshot responses whose body is downloaded and parsed.
// Parsing a ~30-40 KB JSON body 200×/s is real CPU on the load
// generator, and a generator that saturates its own CPU under-reports
// achieved rps (the gate this harness most needs to be honest about).
// Every response still gets its status code checked; only the body
// validation is sampled. 1 = validate everything (fine ≤ 50 rps).
export const BODY_SAMPLE_RATE = __ENV.BODY_SAMPLE_RATE ? parseFloat(__ENV.BODY_SAMPLE_RATE) : 0.1;

// Vercel Deployment Protection on preview deployments answers 401 with
// an SSO page to anything without the bypass. The project's
// "Protection Bypass for Automation" secret goes in VERCEL_BYPASS.
// Without it every request "fails" and the run measures the auth wall,
// not the app — the README tells the operator to check this first.
export function baseHeaders() {
  const h = {};
  if (__ENV.VERCEL_BYPASS) h["x-vercel-protection-bypass"] = __ENV.VERCEL_BYPASS;
  return h;
}

// 70 % ja / 20 % ko / 10 % en — the agreed audience mix for the Fes
// (dome + 配信, Japanese-majority). Locale changes the translation
// filter in /api/setlist, so the mix matters for DB work, not just
// for realism.
export function pickLocale() {
  const r = Math.random();
  if (r < 0.7) return "ja";
  if (r < 0.9) return "ko";
  return "en";
}

// ── Custom metrics ────────────────────────────────────────────────
// Two separate gates, because they have different denominators:
//
// - `snapshot_errors`: the "app/network error rate" gate. Non-200 and
//   transport errors (status 0), counted over *every* request. Kept
//   apart from k6's built-in http_req_failed so the burst and SSR
//   scenarios don't blur the snapshot number.
// - `snapshot_bad_body`: the "data correctness" gate. Malformed JSON or
//   a wrong row count, counted over the *sampled* bodies only. Folding
//   it into snapshot_errors would divide body failures by all requests
//   and dilute them by BODY_SAMPLE_RATE (0.5 % bad bodies at a 10 %
//   sample reads as 0.05 % and passes the 0.1 % gate), so it is gated
//   on its own and must be 0.
export const snapshotErrors = new Rate("snapshot_errors");
export const snapshotBadBody = new Rate("snapshot_bad_body");
export const snapshotRows = new Trend("snapshot_rows");
export const ssrErrors = new Rate("ssr_errors");
export const snapshotRequests = new Counter("snapshot_requests");

export function snapshotUrl(locale) {
  return `${BASE_URL}/api/setlist?eventId=${EVENT_ID}&locale=${locale}`;
}

// One polled snapshot, exactly as `useSetlistPolling` / Realtime's
// `fetchSnapshot` issue it. Returns the parsed body when it was
// downloaded (sampled or `forceBody`), otherwise null.
export function getSnapshot({ forceBody = false, tags = {} } = {}) {
  const locale = pickLocale();
  const wantBody = forceBody || Math.random() < BODY_SAMPLE_RATE;
  const res = http.get(snapshotUrl(locale), {
    headers: baseHeaders(),
    responseType: wantBody ? "text" : "none",
    tags: { name: "snapshot", locale, ...tags },
    // A slow-but-successful response must be measured, not cut off;
    // 30 s is well past the 5 s abort gate.
    timeout: "30s",
  });
  snapshotRequests.add(1, tags);

  const ok = res.status === 200;
  let body = null;
  let bodyOk = true;
  if (ok && wantBody) {
    try {
      body = JSON.parse(res.body);
      bodyOk = validateSnapshotBody(body);
    } catch {
      bodyOk = false;
    }
    snapshotBadBody.add(!bodyOk, tags);
  }
  snapshotErrors.add(!ok, tags);
  check(res, { "snapshot 200": (r) => r.status === 200 }, tags);
  return body;
}

// Shape = the `NextResponse.json({ items, reactionCounts, top3Wishes,
// status, updatedAt })` at the end of src/app/api/setlist/route.ts —
// all five keys are always present (reactionCounts may be `{}`,
// top3Wishes may be `[]`, status may be null). If that route's shape
// changes, update this check with it, or every sampled body counts as
// an error and the ramp aborts on the 2 % gate.
export function validateSnapshotBody(body) {
  if (!body || !Array.isArray(body.items) || !("status" in body)) return false;
  if (typeof body.reactionCounts !== "object" || !Array.isArray(body.top3Wishes)) return false;
  snapshotRows.add(body.items.length);
  if (EXPECTED_ROWS != null) {
    const n = body.items.length;
    if (n < EXPECTED_ROWS || n > EXPECTED_ROWS + ROW_SLACK) return false;
  }
  return true;
}

// The ongoing event page, cache-bypassed while status = ongoing
// (`page.tsx` skips the data cache). Redirects are NOT followed: a
// stale slug would 308 to the canonical URL, and silently following
// it would make the run measure two hops per request while still
// reporting success. A 308 here means EVENT_SLUG is wrong — fix it.
export function getEventPage(tags = {}) {
  const res = http.get(`${BASE_URL}/ja/events/${EVENT_ID}/${EVENT_SLUG}`, {
    headers: baseHeaders(),
    redirects: 0,
    responseType: "none",
    tags: { name: "ssr_event_page", ...tags },
    timeout: "30s",
  });
  ssrErrors.add(res.status !== 200, tags);
  check(res, { "event page 200": (r) => r.status === 200 }, tags);
}

// Gate values from the n12 spec (Step 2). One place so the ramp, hold
// and burst scripts can't drift apart.
export const GATES = {
  passP95: 1000,
  passP99: 2000,
  passErrorRate: 0.001,
  // Every sampled body must be valid (spec: "every sampled response
  // valid JSON with the expected row count").
  passBadBodyRate: 0,
  abortP95: 5000,
  abortErrorRate: 0.02,
  adminP95: 3000,
  achievedRatio: 0.95,
};
