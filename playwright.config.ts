import { defineConfig, devices } from "@playwright/test";

/*
 * Playwright config for the b06 Sprint B1 integration test suite —
 * first E2E surface in the repo. Vitest stays the home for unit /
 * integration tests under `src/__tests__/`; Playwright owns
 * end-to-end browser-driven verification under `tests/e2e/`.
 *
 * Scope today: a single Album-page spec covering the three album
 * types (live_album / album / single), TabBar visibility, slug
 * redirect, tab-param fallback, and OG meta presence. Selectors
 * lean on i18n-stable structural anchors (nav role + aria-current,
 * meta tags, redirect status) rather than translated UI copy, so
 * the spec is locale-agnostic at the assertion layer even though
 * the browser context is ko-KR.
 *
 * Local-only for now — no CI workflow shipped with this PR. CI
 * integration is a deferred follow-up to keep the b06 PR scope to
 * "infra + first spec." The webServer block lets `npm run test:e2e`
 * start `next dev` on demand and reuses an already-running dev
 * server when one is present.
 *
 * Why workers: 1 + retries: 0 — these tests hit a real dev DB
 * shared with the operator's manual work; serial execution avoids
 * surprising contention and surfacing intermittent failures as
 * flakes would mask the spec's value at this catalog scale.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    // TEST_BASE_URL override lets CI or a remote-server runbook point
    // the suite at a non-local origin (Vercel preview, staging) without
    // a config edit. Default keeps the local `npm run dev` flow
    // ergonomic — no env var needed for the common case.
    baseURL: process.env.TEST_BASE_URL ?? "http://localhost:3000",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
