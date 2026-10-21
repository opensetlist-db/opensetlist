import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { rankIds, searchType } from "@/lib/globalSearch/service";

// Global search service (ticket 13) against the DEV database: the
// properties only the real SQL can prove — NFKC / apostrophe / case
// folding on both operands, exact → prefix → substring → ID ranking over
// every own name, one row per entity (dedup before LIMIT/OFFSET), stable
// pagination, visibility (soft-deleted rows excluded, Album has no
// deletion column), no artist → song expansion, and literal `%` / `_`.
//
// Fixtures are throwaway rows whose names contain a per-run token
// (`srchitest<ts>`), so every query here matches only this run's rows;
// afterAll hard-deletes them and asserts nothing is left. No existing
// record is read for assertions or written.

const TOKEN = `srchitest${Date.now()}`;
const created = {
  artists: [] as bigint[],
  songs: [] as bigint[],
  albums: [] as bigint[],
  events: [] as bigint[],
};

let exactSong: bigint;
let prefixSong: bigint;
let substringSong: bigint;
let translatedSong: bigint;
let variantSong: bigint;
let deletedSong: bigint;
let creditedSong: bigint;
let artistId: bigint;
let deletedArtist: bigint;
let albumId: bigint;
let eventId: bigint;
let deletedEvent: bigint;

async function song(data: {
  title: string;
  slug: string;
  ko?: string;
  baseVersionId?: bigint;
  isDeleted?: boolean;
}) {
  const row = await prisma.song.create({
    data: {
      slug: `${TOKEN}-${data.slug}`,
      originalTitle: data.title,
      baseVersionId: data.baseVersionId,
      variantLabel: data.baseVersionId ? "Test Ver." : null,
      isDeleted: data.isDeleted ?? false,
      translations: data.ko ? { create: { locale: "ko", title: data.ko } } : undefined,
    },
  });
  created.songs.push(row.id);
  return row.id;
}

beforeAll(async () => {
  // Songs, created in an order where ID order differs from rank order.
  substringSong = await song({ title: `My ${TOKEN} Song`, slug: "substring" });
  prefixSong = await song({ title: `${TOKEN} Rising`, slug: "prefix" });
  exactSong = await song({ title: TOKEN, slug: "exact" });
  // Matches through its translation only, and twice (exact via ko) — must
  // appear once, ranked exact.
  translatedSong = await song({ title: "無関係", slug: "translated", ko: TOKEN.toUpperCase() });
  variantSong = await song({
    title: `${TOKEN} Rising`,
    slug: "variant",
    baseVersionId: prefixSong,
  });
  deletedSong = await song({ title: TOKEN, slug: "deleted", isDeleted: true });

  const artist = await prisma.artist.create({
    data: {
      slug: `${TOKEN}-artist`,
      type: "group",
      originalName: `${TOKEN} Orchestra`,
      // Curly apostrophe in the stored short name; the query uses ASCII.
      originalShortName: `${TOKEN}’s`,
      translations: { create: { locale: "ko", name: "테스트 오케스트라" } },
    },
  });
  artistId = artist.id;
  created.artists.push(artistId);
  const gone = await prisma.artist.create({
    data: { slug: `${TOKEN}-gone`, type: "solo", originalName: TOKEN, isDeleted: true },
  });
  deletedArtist = gone.id;
  created.artists.push(deletedArtist);

  // A song credited to the matching artist whose own title does not
  // contain the token: must NOT be found (no artist → song expansion).
  creditedSong = await song({ title: "Unrelated Title", slug: "credited" });
  await prisma.songArtist.create({
    data: { songId: creditedSong, artistId, role: "primary" },
  });

  const album = await prisma.album.create({
    data: {
      slug: `${TOKEN}-album`,
      type: "single",
      originalTitle: "アルバム",
      translations: { create: { locale: "en", title: `The ${TOKEN} Album` } },
    },
  });
  albumId = album.id;
  created.albums.push(albumId);

  const event = await prisma.event.create({
    data: {
      slug: `${TOKEN}-event`,
      type: "concert",
      startTime: new Date("2030-01-01T09:00:00Z"),
      date: new Date("2030-01-01T00:00:00Z"),
      originalName: "テスト公演",
      originalShortName: `${TOKEN} Live`,
    },
  });
  eventId = event.id;
  created.events.push(eventId);
  const deleted = await prisma.event.create({
    data: {
      slug: `${TOKEN}-event-gone`,
      type: "concert",
      startTime: new Date("2030-01-02T09:00:00Z"),
      originalName: TOKEN,
      isDeleted: true,
    },
  });
  deletedEvent = deleted.id;
  created.events.push(deletedEvent);
});

afterAll(async () => {
  await prisma.songArtist.deleteMany({ where: { songId: { in: created.songs } } });
  await prisma.songTranslation.deleteMany({ where: { songId: { in: created.songs } } });
  // Variants reference their base: delete them first.
  await prisma.song.deleteMany({ where: { id: { in: created.songs }, baseVersionId: { not: null } } });
  await prisma.song.deleteMany({ where: { id: { in: created.songs } } });
  await prisma.artistTranslation.deleteMany({ where: { artistId: { in: created.artists } } });
  await prisma.artist.deleteMany({ where: { id: { in: created.artists } } });
  await prisma.albumTranslation.deleteMany({ where: { albumId: { in: created.albums } } });
  await prisma.album.deleteMany({ where: { id: { in: created.albums } } });
  await prisma.event.deleteMany({ where: { id: { in: created.events } } });
  const left = await Promise.all([
    prisma.song.count({ where: { slug: { startsWith: TOKEN } } }),
    prisma.artist.count({ where: { slug: { startsWith: TOKEN } } }),
    prisma.album.count({ where: { slug: { startsWith: TOKEN } } }),
    prisma.event.count({ where: { slug: { startsWith: TOKEN } } }),
  ]);
  expect(left).toEqual([0, 0, 0, 0]);
});

describe("global search service (dev DB)", () => {
  it("ranks exact → prefix → substring, ID-stable, one row per entity", async () => {
    const rows = await rankIds("songs", TOKEN, 20, 0);
    expect(rows.map((r) => [r.id, r.rank])).toEqual([
      [exactSong, 0],
      [translatedSong, 0],
      [prefixSong, 1],
      [variantSong, 1],
      [substringSong, 2],
    ]);
    // The translated song matched through its ko title.
    const translated = rows.find((r) => r.id === translatedSong)!;
    expect(translated).toMatchObject({ matchedName: TOKEN.toUpperCase(), matchedLocale: "ko" });
  });

  it("excludes soft-deleted songs/artists/events and does not expand artist matches", async () => {
    const songs = (await rankIds("songs", TOKEN, 50, 0)).map((r) => r.id);
    expect(songs).not.toContain(deletedSong);
    expect(songs).not.toContain(creditedSong);
    const artists = (await rankIds("artists", TOKEN, 50, 0)).map((r) => r.id);
    expect(artists).toEqual([artistId]);
    const events = (await rankIds("events", TOKEN, 50, 0)).map((r) => r.id);
    expect(events).toEqual([eventId]);
  });

  it("applies the same NFKC / apostrophe / case folding to names and query", async () => {
    // Full-width query → ASCII name; ASCII apostrophe query → curly stored.
    const fullWidth = TOKEN.replace(/[a-z0-9]/g, (c) =>
      String.fromCodePoint(c.codePointAt(0)! + 0xfee0),
    );
    expect((await rankIds("songs", fullWidth, 1, 0))[0]).toMatchObject({ id: exactSong, rank: 0 });
    const apostrophe = await rankIds("artists", `${TOKEN.toUpperCase()}'S`, 5, 0);
    expect(apostrophe).toEqual([
      expect.objectContaining({ id: artistId, rank: 0, matchedName: `${TOKEN}’s` }),
    ]);
  });

  it("matches short names and translations of events and albums", async () => {
    expect((await rankIds("events", `${TOKEN} live`, 5, 0))[0]).toMatchObject({
      id: eventId,
      rank: 0,
    });
    expect((await rankIds("albums", TOKEN, 5, 0)).map((r) => r.id)).toEqual([albumId]);
  });

  it("treats % and _ literally", async () => {
    expect(await rankIds("songs", `${TOKEN}%`, 5, 0)).toEqual([]);
    expect(await rankIds("songs", `${TOKEN.slice(0, -1)}_`, 5, 0)).toEqual([]);
  });

  it("paginates the deduplicated ranking without gaps or overlap, signalling more", async () => {
    const all = (await searchType("songs", TOKEN, 20, 0)).hits.map((h) => h.entity.id);
    const first = await searchType("songs", TOKEN, 2, 0);
    const second = await searchType("songs", TOKEN, 2, 2);
    const third = await searchType("songs", TOKEN, 2, 4);
    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(true);
    expect(third.hasMore).toBe(false);
    expect([...first.hits, ...second.hits, ...third.hits].map((h) => h.entity.id)).toEqual(all);
    expect(await searchType("songs", TOKEN, 2, 6)).toMatchObject({ hits: [], hasMore: false });
  });

  it("hydrates minimal projections, including the variant count of a base song", async () => {
    const { hits } = await searchType("songs", `${TOKEN} rising`, 5, 0);
    const base = hits.find((h) => h.entity.id === prefixSong)!;
    expect(base.entity._count.variants).toBe(1);
    expect(base.entity.slug).toBe(`${TOKEN}-prefix`);
    const variant = hits.find((h) => h.entity.id === variantSong)!;
    expect(variant.entity.baseVersionId).toBe(prefixSong);
  });

  it("matches nothing for an input that normalizes to empty", async () => {
    expect(await rankIds("songs", "   ", 5, 0)).toEqual([]);
  });
});
