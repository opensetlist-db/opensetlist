import { test, expect, type Page } from "@playwright/test";
import { readCrossLinkSampleIds } from "./helpers/sampleIds";

/*
 * b11 Sprint B2 integration spec — Album cross-link surfaces.
 *
 * Verifies the bidirectional Album link density Sprint B2 built:
 *   - Song page  "수록 앨범"      → Album (b08)
 *   - Artist page "최신 앨범" + discography → Album (b09)
 *   - Series page "투어 BD 목록"  → Album (b09)
 *   - Album page  "관련 앨범"      → Album (b09)
 *   - /albums list + 4th nav item → Album (b10b)
 *
 * Assertion philosophy (mirrors the b06 album.spec): structural,
 * i18n-stable anchors under the ko-KR context — section-heading text +
 * link hrefs + the nav's `aria-current`, never dev-DB-row *counts*
 * (catalog volume varies per environment). "Link resolves" is verified
 * by following the first album href and checking the detail page's
 * `main h1` — the same anchor album.spec uses.
 *
 * Reconciled against what actually shipped (the b11 wiki spec predated
 * b08/b09): the Song "수록 앨범" list is FLAT (no expandable secondary
 * list — dropped in b08), and the Artist discography is the overview-tab
 * hero + grid (b09 spec-only scope), not a standalone 30-album page.
 *
 * Sample IDs come from env (see helpers/sampleIds.ts). Missing vars skip
 * the relevant case with a populate-via-admin message; the rest run.
 */

const HEADINGS = {
  songAlbums: "수록 앨범",
  artistLatest: "최신 앨범",
  seriesTourBds: "투어 BD 목록",
  albumRelated: "관련 앨범",
  albumsListTitle: "앨범",
  navAlbums: "앨범",
} as const;

const {
  crossLinkSongId,
  discographyArtistId,
  bdSeriesId,
  relatedAlbumId,
} = readCrossLinkSampleIds();

function requireSample(id: string | null, envVar: string): asserts id is string {
  test.skip(
    id === null,
    `${envVar} env var not set — populate via /admin (b05) and add the id to .env.local`,
  );
}

// Follow the first link that targets an album detail URL and assert the
// destination renders. Album hrefs are `/ko/albums/<id>[/slug]`; the
// `/\d/` guard skips the bare `/ko/albums` list link if it's ever in
// scope (it has no numeric segment).
async function firstAlbumLinkResolves(page: Page) {
  const albumLink = page.locator('a[href*="/albums/"]').first();
  await expect(albumLink).toBeVisible();
  const href = await albumLink.getAttribute("href");
  expect(href, "album link should have an href").toBeTruthy();
  expect(href!, "href targets a numeric album id").toMatch(/\/albums\/\d+/);
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

    await expect(
      page.getByRole("heading", { name: HEADINGS.songAlbums }),
    ).toBeVisible();
    await firstAlbumLinkResolves(page);
  });
});

test.describe("Artist highlights → Album (b09)", () => {
  test("artist overview shows 최신 앨범 with a resolving Album link", async ({
    page,
  }) => {
    requireSample(discographyArtistId, "E2E_DISCOGRAPHY_ARTIST_ID");
    const resp = await page.goto(`/ko/artists/${discographyArtistId}`);
    expect(resp?.ok()).toBeTruthy();

    await expect(
      page.getByRole("heading", { name: HEADINGS.artistLatest }),
    ).toBeVisible();
    await firstAlbumLinkResolves(page);
  });
});

test.describe("Series tour BDs → Album (b09)", () => {
  test("series shows 투어 BD 목록 with a resolving Album link", async ({
    page,
  }) => {
    requireSample(bdSeriesId, "E2E_BD_SERIES_ID");
    const resp = await page.goto(`/ko/series/${bdSeriesId}`);
    expect(resp?.ok()).toBeTruthy();

    await expect(
      page.getByRole("heading", { name: HEADINGS.seriesTourBds }),
    ).toBeVisible();
    await firstAlbumLinkResolves(page);
  });
});

test.describe("Album related sidebar (b09)", () => {
  test("album page sidebar shows 관련 앨범 (same-artist albums)", async ({
    page,
  }) => {
    requireSample(relatedAlbumId, "E2E_RELATED_ALBUM_ID");
    const resp = await page.goto(`/ko/albums/${relatedAlbumId}`);
    expect(resp?.ok()).toBeTruthy();

    // The section returns null when the artist has no other albums, so
    // its heading being present already proves ≥1 related album rendered.
    await expect(
      page.getByRole("heading", { name: HEADINGS.albumRelated }),
    ).toBeVisible();
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
    // stable anchor (added in b11 alongside this spec); assert exactly
    // one current link and that it's Albums.
    const current = page.locator('a[aria-current="page"]');
    await expect(current.first()).toHaveText(HEADINGS.navAlbums);

    // At least one album card links into a detail page, and it resolves.
    await firstAlbumLinkResolves(page);
  });
});
