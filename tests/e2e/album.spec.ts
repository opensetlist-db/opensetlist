import { test, expect, type Locator, type Page } from "@playwright/test";
import { readSampleIds } from "./helpers/sampleIds";

/*
 * b06 Sprint B1 integration spec — Album page MVP smoke verification.
 *
 * Coverage scope (deliberate trims vs the original b06 wiki spec):
 *   - 3 album types (live_album / album / single) render at the
 *     public route with the right tab count + default-tab anchor.
 *   - Slug redirect normalizes a stale path to the canonical numeric
 *     URL per CLAUDE.md URL strategy.
 *   - Tab query-param sanitiser falls back when the value is unknown
 *     or refers to a tab hidden for the current album type.
 *   - OG metadata + the /api/og/album/<id> endpoint round-trip.
 *
 * NOT covered here (deferred to manual QA per the b06 plan):
 *   - 16-variant lifecycle grid + stale warning — both were dropped
 *     in the b03 simplification handoff, so the UI never renders them.
 *   - Disc grouping / Pattern 2 off-vocal row rendering — too dev-DB-
 *     sample-dependent to assert reliably at this catalog scale.
 *   - Mobile Safari / Android Chrome / OG share unfurl / Lighthouse —
 *     real-device + 3rd-party-platform QA that emulators can't fake.
 *
 * Sample IDs come from E2E_LIVE_ALBUM_ID / E2E_ALBUM_ID / E2E_SINGLE_ID
 * env vars (see helpers/sampleIds.ts for the rationale). Missing vars
 * cause the relevant cases to skip with a populate-via-admin message;
 * the rest of the suite still runs.
 */

const TAB_LABELS = {
  bonus: "매장특전",
  tracks: "수록곡",
  events: "관련 공연",
} as const;

const TAB_NAV_SELECTOR = 'nav[aria-label="앨범 페이지 탭"]';

const { liveAlbumId, albumId, singleId } = readSampleIds();

function requireSample(id: string | null, envVar: string): asserts id is string {
  test.skip(
    id === null,
    `${envVar} env var not set — populate via /admin/albums (b05) and add the id to .env.local`,
  );
}

function tabButtons(page: Page): Locator {
  return page.locator(`${TAB_NAV_SELECTOR} button`);
}

function activeTab(page: Page): Locator {
  return page.locator(`${TAB_NAV_SELECTOR} button[aria-current="page"]`);
}

test.describe("Album detail page — type-aware render", () => {
  test("live_album renders with 2 tabs and Events as the default", async ({
    page,
  }) => {
    requireSample(liveAlbumId, "E2E_LIVE_ALBUM_ID");
    const resp = await page.goto(`/ko/albums/${liveAlbumId}`);
    expect(resp?.ok(), "GET should resolve with a 2xx status").toBeTruthy();

    await expect(page.locator("main h1")).toHaveText(/\S/);
    await expect(tabButtons(page)).toHaveCount(2);
    await expect(activeTab(page)).toHaveText(TAB_LABELS.events);
  });

  test("album renders with all 3 tabs and Bonus as the default", async ({
    page,
  }) => {
    requireSample(albumId, "E2E_ALBUM_ID");
    const resp = await page.goto(`/ko/albums/${albumId}`);
    expect(resp?.ok()).toBeTruthy();

    await expect(page.locator("main h1")).toHaveText(/\S/);
    await expect(tabButtons(page)).toHaveCount(3);
    await expect(activeTab(page)).toHaveText(TAB_LABELS.bonus);
  });

  test("single renders with all 3 tabs and Bonus as the default", async ({
    page,
  }) => {
    requireSample(singleId, "E2E_SINGLE_ID");
    const resp = await page.goto(`/ko/albums/${singleId}`);
    expect(resp?.ok()).toBeTruthy();

    await expect(tabButtons(page)).toHaveCount(3);
    await expect(activeTab(page)).toHaveText(TAB_LABELS.bonus);
  });
});

test.describe("Album detail page — URL sanitisers", () => {
  test("wrong slug 308s to the canonical numeric URL", async ({ page }) => {
    requireSample(albumId, "E2E_ALBUM_ID");
    // A timestamped slug guarantees we're not accidentally hitting the
    // album's actual slug if the dev DB row happens to be named
    // "wrong-slug" (paranoia, not a real-world concern).
    const resp = await page.goto(
      `/ko/albums/${albumId}/wrong-slug-${Date.now()}`,
    );
    expect(resp?.ok()).toBeTruthy();
    // After redirect we land on the bare numeric URL per page.tsx
    // (`permanentRedirect('/${locale}/albums/${id}')`).
    expect(page.url()).toMatch(new RegExp(`/ko/albums/${albumId}(?:$|[?#])`));
  });

  test("?tab=<unknown> falls back to the default tab", async ({ page }) => {
    requireSample(albumId, "E2E_ALBUM_ID");
    await page.goto(`/ko/albums/${albumId}?tab=foo`);
    await expect(activeTab(page)).toHaveText(TAB_LABELS.bonus);
  });

  test("?tab=tracks on a live_album falls back to Events (tracks hidden)", async ({
    page,
  }) => {
    requireSample(liveAlbumId, "E2E_LIVE_ALBUM_ID");
    await page.goto(`/ko/albums/${liveAlbumId}?tab=tracks`);
    await expect(activeTab(page)).toHaveText(TAB_LABELS.events);
  });
});

test.describe("Album detail page — metadata", () => {
  test("og:image meta is set and the endpoint resolves with an image", async ({
    page,
    request,
  }) => {
    requireSample(albumId, "E2E_ALBUM_ID");
    await page.goto(`/ko/albums/${albumId}`);
    const ogImage = await page
      .locator('meta[property="og:image"]')
      .getAttribute("content");
    expect(ogImage, "og:image meta should be present").toBeTruthy();

    // Exercise the OG route directly — the share-card endpoint is its
    // own surface and warrants a separate 200 + content-type check.
    const ogResp = await request.get(`/api/og/album/${albumId}?lang=ko`);
    expect(ogResp.ok(), "OG route should return 200").toBeTruthy();
    expect(ogResp.headers()["content-type"] ?? "").toMatch(/image\//);
  });

  test("canonical link points to the slug-less numeric URL", async ({
    page,
  }) => {
    requireSample(albumId, "E2E_ALBUM_ID");
    await page.goto(`/ko/albums/${albumId}`);
    const canonical = await page
      .locator('link[rel="canonical"]')
      .getAttribute("href");
    expect(canonical).toMatch(new RegExp(`/ko/albums/${albumId}$`));
  });
});
