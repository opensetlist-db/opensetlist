import { test, expect, type Locator } from "@playwright/test";
import { readCrossLinkSampleIds } from "./helpers/sampleIds";

/*
 * b11 Sprint B2 integration spec — Album cross-link surfaces.
 *
 * Verifies the bidirectional Album link density Sprint B2 built:
 *   - Song page  "수록 앨범"      → Album (b08)
 *   - Artist page "최신 앨범" + discography → Album (b09)
 *   - Series page "투어 BD 목록"  → Album (b09)
 *   - /albums list + 4th nav item → Album (b10b)
 *
 * The Album page "관련 앨범" sidebar (b09) was removed post-Sprint B2 —
 * the /albums list page covers the same browsing intent.
 *
 * Assertion philosophy (mirrors the b06 album.spec): structural,
 * i18n-stable anchors under the ko-KR context — section-label text +
 * link hrefs + the nav's `aria-current`, never dev-DB-row *counts*
 * (catalog volume varies per environment). The album-link check is
 * SCOPED to the section under test (the label's container) so a link
 * from another region can't make a broken section's link pass; "link
 * resolves" then follows the first in-section album href and checks the
 * destination's `main h1`.
 *
 * Reconciled against what actually shipped (the b11 wiki spec predated
 * b08/b09): the Song "수록 앨범" list is FLAT (no expandable secondary —
 * dropped in b08) and its label is a styled <div>, not a heading (so it
 * anchors via getByText, unlike the b09 sections' real <h2>/<h3>); the
 * Artist discography is the overview-tab hero + grid (b09 spec-only
 * scope), not a standalone 30-album page.
 *
 * Sample IDs come from env (see helpers/sampleIds.ts). Missing vars skip
 * the relevant case with a populate-via-admin message; the rest run.
 */

const HEADINGS = {
  songAlbums: "수록 앨범",
  artistLatest: "최신 앨범",
  seriesTourBds: "투어 BD 목록",
  albumsListTitle: "앨범",
  navAlbums: "앨범",
} as const;

const {
  crossLinkSongId,
  discographyArtistId,
  bdSeriesId,
} = readCrossLinkSampleIds();

function requireSample(id: string | null, envVar: string): asserts id is string {
  test.skip(
    id === null,
    `${envVar} env var not set — populate via /admin (b05) and add the id to .env.local`,
  );
}

// Follow the first album-detail link WITHIN `scope` and assert the
// destination renders. Scoping to the section container (not the whole
// page) is the point: a link from a different region must not satisfy a
// test whose section's own link is broken. Album hrefs are
// `/ko/albums/<id>[/slug]`; the `\d` guard ignores the bare `/albums`
// list link (no numeric segment).
async function firstAlbumLinkResolves(scope: Locator) {
  const albumLink = scope.locator('a[href*="/albums/"]').first();
  await expect(albumLink).toBeVisible();
  const href = await albumLink.getAttribute("href");
  expect(href, "album link should have an href").toBeTruthy();
  expect(href!, "href targets a numeric album id").toMatch(/\/albums\/\d+/);
  const page = scope.page();
  const resp = await page.goto(href!);
  expect(resp?.ok(), "the linked album page resolves 2xx").toBeTruthy();
  await expect(page.locator("main h1")).toHaveText(/\S/);
}

test.describe("Song → Album (b08)", () => {
  test("song page surfaces 수록 앨범 with a resolving Album link", async ({
    page,
  }) => {
    requireSample(crossLinkSongId, "E2E_MULTI_ALBUM_SONG_ID");
    const resp = await page.goto(`/ko/songs/${crossLinkSongId}`);
    expect(resp?.ok()).toBeTruthy();

    // The 수록 앨범 label is a styled <div> (not a heading); its parent
    // container holds the album cards — scope the link search there.
    const label = page.getByText(HEADINGS.songAlbums, { exact: true });
    await expect(label).toBeVisible();
    await firstAlbumLinkResolves(label.locator("xpath=.."));
  });
});

test.describe("Artist highlights → Album (b09)", () => {
  test("artist overview shows 최신 앨범 with a resolving Album link", async ({
    page,
  }) => {
    requireSample(discographyArtistId, "E2E_DISCOGRAPHY_ARTIST_ID");
    const resp = await page.goto(`/ko/artists/${discographyArtistId}`);
    expect(resp?.ok()).toBeTruthy();

    // The 최신 앨범 preview is a <section>; its SectionLabel heading sits
    // in a header row (alongside the 전체 보기 link), so scope to the
    // whole section (not the heading's immediate parent) to reach the
    // album-card rows below the header.
    const heading = page.getByRole("heading", { name: HEADINGS.artistLatest });
    await expect(heading).toBeVisible();
    const section = page.locator("section").filter({ has: heading });
    await firstAlbumLinkResolves(section);
  });
});

test.describe("Series tour BDs → Album (b09)", () => {
  test("series shows 투어 BD 목록 with a resolving Album link", async ({
    page,
  }) => {
    requireSample(bdSeriesId, "E2E_BD_SERIES_ID");
    const resp = await page.goto(`/ko/series/${bdSeriesId}`);
    expect(resp?.ok()).toBeTruthy();

    const heading = page.getByRole("heading", { name: HEADINGS.seriesTourBds });
    await expect(heading).toBeVisible();
    await firstAlbumLinkResolves(heading.locator("xpath=.."));
  });
});

test.describe("Albums list page + nav (b10b)", () => {
  test("/albums renders and the header nav marks Albums current", async ({
    page,
  }) => {
    const resp = await page.goto(`/ko/albums`);
    expect(resp?.ok()).toBeTruthy();

    await expect(page.locator("main h1")).toHaveText(HEADINGS.albumsListTitle);

    // 4th nav item is the active page. `aria-current="page"` is the
    // stable anchor (added in b11 alongside this spec); assert the
    // current link is Albums.
    const current = page.locator('a[aria-current="page"]');
    await expect(current.first()).toHaveText(HEADINGS.navAlbums);

    // The list itself (main) is all album cards — scope there so the
    // nav's own `/albums` link can't satisfy the check (it has no
    // numeric segment anyway, but scoping keeps intent explicit).
    await firstAlbumLinkResolves(page.locator("main"));
  });
});
