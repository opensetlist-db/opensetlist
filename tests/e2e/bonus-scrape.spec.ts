import { test, expect } from "@playwright/test";
import { readCrossLinkSampleIds } from "./helpers/sampleIds";

/*
 * b11 Sprint B2 integration spec — 매장特典 / bonus-scrape public output
 * (b10).
 *
 * Scope decision: b10's scrape → review → APPLY pipeline is admin-cookie-
 * gated, stateful, and consumes fixtured news HTML — driving it in a
 * browser is brittle (auth + upload + job approval) and would duplicate
 * coverage that already exists as fast unit tests:
 *   - src/__tests__/unit/album-bonus-import-reconciler.test.ts
 *   - src/__tests__/unit/album-bonus-import-route.test.ts
 * Plus the operator review queue is a human step by design.
 *
 * So this E2E asserts the PUBLIC END of that pipeline — the thing a user
 * actually sees once bonuses are applied: the Album page's 매장特典 tab
 * renders the store listing(s) / bonus rows. The admin import flow stays
 * on the unit tests above + manual operator review (wiki spec Step 3's
 * admin half is intentionally deferred, documented here so it's explicit
 * rather than a silent gap).
 *
 * Sample id from env (E2E_BONUS_ALBUM_ID = an album with ≥1 active store
 * listing). Missing var skips.
 */

const BONUS_TAB_LABEL = "구입";
const ALBUM_TAB_NAV = 'nav[aria-label="앨범 페이지 탭"]';

const { bonusAlbumId } = readCrossLinkSampleIds();

function requireSample(id: string | null, envVar: string): asserts id is string {
  test.skip(
    id === null,
    `${envVar} env var not set — apply bonuses via /admin/album-bonuses/import-review (b10) and add the album id to .env.local`,
  );
}

test.describe("Album 매장特典 tab — bonus-scrape public output (b10)", () => {
  test("album with applied bonuses renders ≥1 store listing in the 매장特典 tab", async ({
    page,
  }) => {
    requireSample(bonusAlbumId, "E2E_BONUS_ALBUM_ID");

    // Audio albums default to the 매장特典 tab; pin it via ?tab=bonus so
    // the spec is robust whatever the album type's default is.
    const resp = await page.goto(`/ko/albums/${bonusAlbumId}?tab=bonus`);
    expect(resp?.ok()).toBeTruthy();

    // The bonus tab is the active tab. The label renders with a count
    // suffix (`매장特典 (N)` via Album.tab.withCount), so match the prefix
    // rather than asserting exact text.
    await expect(
      page.locator(`${ALBUM_TAB_NAV} button[aria-current="page"]`),
    ).toContainText(BONUS_TAB_LABEL);

    // ListingCard renders each store as an <article> with a store-name
    // heading + (for active listings) a 구매하기 buy link. Assert ≥1 buy
    // link resolves to an external store URL — the concrete signal that
    // an applied listing rendered (an empty bonus tab shows the
    // Album.bonus.empty placeholder instead, which has no such link).
    const buyLink = page
      .locator('main a[target="_blank"][href^="http"]')
      .first();
    await expect(buyLink).toBeVisible();
    await expect(buyLink).toHaveAttribute("href", /^https?:\/\//);
  });
});
