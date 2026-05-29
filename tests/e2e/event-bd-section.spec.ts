import { test, expect } from "@playwright/test";
import { readBdEventSampleIds } from "./helpers/sampleIds";

/*
 * b11 Sprint B2 integration spec — EventBdSection (b07).
 *
 * Verifies the BD section's presence/absence on the Event detail page:
 *   - an event with a linked BD album renders the section + an Album link
 *   - an event with no bdAlbumId renders no section
 *
 * Deliberately NOT asserted here: the specific lifecycle variant
 * (announce / preorder / released). The state is a function of the
 * request's `now` vs the album's release/preorder dates, so it drifts
 * over time — a pinned-id state assertion would rot as dates pass. The
 * per-state matrix stays (a) b07's `src/__tests__/unit/eventBdState.test.ts`,
 * which is exhaustive over the state machine against a frozen clock, and
 * (b) manual mobile QA (wiki spec Step 1). This spec only asserts the
 * coarse "section renders for a BD event, not for a plain one" contract,
 * which is stable regardless of which variant is current.
 *
 * Anchor: the section header text `Event.bd.sectionTitle` ("이 라이브의
 * BD"), which only the rendering variants emit — the long_mid teaser
 * uses a different string, so anchoring on it correctly excludes the
 * teaser + null states. ko-KR context per playwright.config.
 *
 * Sample IDs from env (helpers/sampleIds.ts); missing vars skip.
 */

const BD_SECTION_TITLE = "이 라이브의 BD";

const { bdEventId, plainEventId } = readBdEventSampleIds();

function requireSample(id: string | null, envVar: string): asserts id is string {
  test.skip(
    id === null,
    `${envVar} env var not set — link a BD album via /admin/events (b07) and add the id to .env.local`,
  );
}

test.describe("EventBdSection (b07)", () => {
  test("a BD-linked event renders the section + a resolving Album link", async ({
    page,
  }) => {
    requireSample(bdEventId, "E2E_BD_EVENT_ID");
    const resp = await page.goto(`/ko/events/${bdEventId}`);
    expect(resp?.ok()).toBeTruthy();

    await expect(
      page.getByText(BD_SECTION_TITLE, { exact: true }),
    ).toBeVisible();

    // The section (album info row + CTA) links to the Album detail page.
    const albumLink = page.locator('a[href*="/albums/"]').first();
    await expect(albumLink).toBeVisible();
    const href = await albumLink.getAttribute("href");
    expect(href!).toMatch(/\/albums\/\d+/);
    const albumResp = await page.goto(href!);
    expect(albumResp?.ok(), "the BD album page resolves 2xx").toBeTruthy();
    await expect(page.locator("main h1")).toHaveText(/\S/);
  });

  test("an event with no BD album renders no BD section", async ({ page }) => {
    requireSample(plainEventId, "E2E_PLAIN_EVENT_ID");
    const resp = await page.goto(`/ko/events/${plainEventId}`);
    // resp.ok() guards the false pass — a 404 would also lack the BD
    // title, so confirm the event page itself rendered first. The BD
    // section is server-rendered (no client-lazy mount), so it's present
    // in the initial HTML or not at all.
    expect(resp?.ok()).toBeTruthy();
    await expect(page.getByText(BD_SECTION_TITLE, { exact: true })).toHaveCount(
      0,
    );
  });
});
