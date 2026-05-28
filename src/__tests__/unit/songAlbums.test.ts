import { describe, it, expect } from "vitest";
import {
  getSongAlbums,
  type SongAlbumsAlbum,
  type SongAlbumsVocalTrack,
} from "@/lib/songAlbums";

function album(overrides: Partial<SongAlbumsAlbum> = {}): SongAlbumsAlbum {
  return {
    id: "1",
    slug: "test-album",
    type: "single",
    releaseDate: "2024-01-01",
    imageUrl: null,
    originalTitle: "Test Album",
    originalLanguage: "ja",
    translations: [],
    artists: [],
    listings: [],
    ...overrides,
  };
}

function track(
  overrides: Partial<SongAlbumsVocalTrack> = {},
): SongAlbumsVocalTrack {
  return {
    discNumber: 1,
    trackNumber: 1,
    album: album(),
    ...overrides,
  };
}

describe("getSongAlbums", () => {
  it("returns empty array for no tracks", () => {
    expect(getSongAlbums([])).toEqual([]);
  });

  it("returns single row marked canonical for one album", () => {
    const result = getSongAlbums([track()]);
    expect(result).toHaveLength(1);
    expect(result[0].isCanonical).toBe(true);
  });

  it("marks only the oldest album canonical when multiple albums present", () => {
    const result = getSongAlbums([
      track({
        album: album({ id: "2", slug: "newer", releaseDate: "2025-06-01" }),
      }),
      track({
        album: album({ id: "1", slug: "older", releaseDate: "2024-01-01" }),
      }),
      track({
        album: album({ id: "3", slug: "mid", releaseDate: "2024-08-01" }),
      }),
    ]);
    expect(result.map((r) => r.album.slug)).toEqual(["older", "mid", "newer"]);
    expect(result.map((r) => r.isCanonical)).toEqual([true, false, false]);
  });

  it("breaks releaseDate ties with smaller album.id wins canonical", () => {
    const result = getSongAlbums([
      track({
        album: album({ id: "5", slug: "later-id", releaseDate: "2024-01-01" }),
      }),
      track({
        album: album({ id: "3", slug: "earlier-id", releaseDate: "2024-01-01" }),
      }),
    ]);
    expect(result.map((r) => r.album.slug)).toEqual(["earlier-id", "later-id"]);
    expect(result[0].isCanonical).toBe(true);
  });

  it("sorts dated albums ahead of null-releaseDate albums", () => {
    const result = getSongAlbums([
      track({
        album: album({ id: "1", slug: "no-date", releaseDate: null }),
      }),
      track({
        album: album({ id: "2", slug: "dated", releaseDate: "2024-01-01" }),
      }),
    ]);
    expect(result.map((r) => r.album.slug)).toEqual(["dated", "no-date"]);
    expect(result[0].isCanonical).toBe(true);
  });

  it("drops tracks whose album is null (defensive guard)", () => {
    const result = getSongAlbums([
      track({
        album: album({ id: "1", slug: "alive", releaseDate: "2024-01-01" }),
      }),
      track({ album: null }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].album.slug).toBe("alive");
  });

  it("counts active bonuses across non-ended listings", () => {
    const result = getSongAlbums([
      track({
        album: album({
          listings: [
            { status: "active", bonuses: [{}, {}, {}] },
            { status: "sold_out", bonuses: [{}] },
          ],
        }),
      }),
    ]);
    expect(result[0].activeBonusCount).toBe(4);
  });

  it("excludes bonuses on ended listings from the count", () => {
    const result = getSongAlbums([
      track({
        album: album({
          listings: [
            { status: "active", bonuses: [{}, {}] },
            { status: "ended", bonuses: [{}, {}, {}] },
          ],
        }),
      }),
    ]);
    expect(result[0].activeBonusCount).toBe(2);
  });

  it("returns zero activeBonusCount when all listings are ended", () => {
    const result = getSongAlbums([
      track({
        album: album({
          listings: [{ status: "ended", bonuses: [{}, {}] }],
        }),
      }),
    ]);
    expect(result[0].activeBonusCount).toBe(0);
  });

  it("returns zero activeBonusCount when no listings exist", () => {
    const result = getSongAlbums([
      track({ album: album({ listings: [] }) }),
    ]);
    expect(result[0].activeBonusCount).toBe(0);
  });

  it("preserves disc/track numbers from the source track row", () => {
    const result = getSongAlbums([
      track({ discNumber: 2, trackNumber: 7 }),
    ]);
    expect(result[0].discNumber).toBe(2);
    expect(result[0].trackNumber).toBe(7);
  });

  it("dedupes by album.id — same album at multiple positions appears once", () => {
    // A song that sits on disc 1 track 3 AND disc 2 track 7 of the
    // same album (medley reprise + full version) — the section
    // should render one card for that album, not two. Lowest-
    // disc-then-track position wins as the canonical context.
    const sameAlbum = album({
      id: "10",
      slug: "anniversary-box",
      releaseDate: "2024-01-01",
    });
    const result = getSongAlbums([
      { discNumber: 1, trackNumber: 3, album: sameAlbum },
      { discNumber: 2, trackNumber: 7, album: sameAlbum },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].discNumber).toBe(1);
    expect(result[0].trackNumber).toBe(3);
  });

  it("dedupe pairs with multi-album sort — count reflects unique albums", () => {
    // Same song on two distinct albums; one of them at two positions.
    // After dedupe we get exactly 2 cards.
    const albumA = album({
      id: "1",
      slug: "single",
      releaseDate: "2023-04-01",
    });
    const albumB = album({
      id: "5",
      slug: "best-album",
      releaseDate: "2025-04-01",
    });
    const result = getSongAlbums([
      { discNumber: 1, trackNumber: 1, album: albumA },
      { discNumber: 1, trackNumber: 3, album: albumB },
      { discNumber: 2, trackNumber: 7, album: albumB },
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.album.slug)).toEqual([
      "single",
      "best-album",
    ]);
    expect(result[0].isCanonical).toBe(true);
  });

  it("treats invalid date strings the same as null (sort to end)", () => {
    const result = getSongAlbums([
      track({
        album: album({ id: "1", slug: "bad-date", releaseDate: "not-a-date" }),
      }),
      track({
        album: album({ id: "2", slug: "valid", releaseDate: "2024-01-01" }),
      }),
    ]);
    expect(result.map((r) => r.album.slug)).toEqual(["valid", "bad-date"]);
  });
});
