import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  ALBUMS_PER_PAGE,
  getAlbumArtistFilters,
  getAlbumsPage,
  groupAlbumsByYear,
} from "@/lib/albums";

// Album list pagination against the DEV database: the properties only
// real SQL can prove — the bounded page query and the count use the same
// filter, `releaseDate DESC NULLS LAST, id DESC` survives OFFSET paging,
// and the concatenated pages equal the full sorted list with no row
// duplicated or dropped at a boundary.
//
// Two parts:
// 1. Read-only over the existing catalog: every filter chip (and "all")
//    is paged through and compared with an independent raw-SQL ordering
//    of the same rows. Nothing is written.
// 2. Throwaway fixtures for the cases the catalog lacks (dev has no
//    undated album): a top-level artist with a sub-unit, a deleted
//    sub-unit, release-date ties straddling the page boundary and two
//    undated albums. Every row carries the per-run token
//    `c07itest<ts>`; afterAll hard-deletes them and asserts nothing is
//    left. No existing record is written.
//
// The catalog comparisons of part 1 read the live shared dev DB, so a
// concurrent album insert/delete by another session between the count,
// the page queries and the reference query would fail them; nothing in
// this repo writes albums on a schedule, and a rerun settles it.

const PREFIX = "c07itest";
const TOKEN = `${PREFIX}${Date.now()}`;
const created = { artists: [] as bigint[], albums: [] as bigint[] };

/*
 * An interrupted run (Ctrl-C, hook timeout) skips afterAll and leaves its
 * 2099 rows at the top of the shared dev catalog (and a fixture chip).
 * Remove any earlier run's rows first — keyed on the file's own fixed
 * prefix, not this run's token, so nothing else matches it. Runs before
 * part 1 so the catalog comparison never sees them either.
 */
async function purge(prefix: string) {
  const albums = await prisma.album.findMany({
    where: { slug: { startsWith: prefix } },
    select: { id: true },
  });
  const artists = await prisma.artist.findMany({
    where: { slug: { startsWith: prefix } },
    select: { id: true },
  });
  const albumIds = albums.map((a) => a.id);
  const artistIds = artists.map((a) => a.id);
  await prisma.albumArtist.deleteMany({
    where: { OR: [{ albumId: { in: albumIds } }, { artistId: { in: artistIds } }] },
  });
  await prisma.album.deleteMany({ where: { id: { in: albumIds } } });
  await prisma.artist.deleteMany({
    where: { id: { in: artistIds }, parentArtistId: { not: null } },
  });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
}

beforeAll(async () => {
  await purge(PREFIX);
});

/*
 * Independent reference ordering: raw SQL with the same filter semantics
 * written out by hand (artist OR its direct sub-units, deleted artists
 * excluded) rather than through the helper under test.
 */
async function referenceIds(artistId?: bigint): Promise<number[]> {
  const rows =
    artistId === undefined
      ? await prisma.$queryRaw<{ id: bigint }[]>`
          SELECT a.id FROM "Album" a
          ORDER BY a."releaseDate" DESC NULLS LAST, a.id DESC`
      : await prisma.$queryRaw<{ id: bigint }[]>`
          SELECT a.id FROM "Album" a
          WHERE EXISTS (
            SELECT 1 FROM "AlbumArtist" aa
            JOIN "Artist" ar ON ar.id = aa."artistId"
            WHERE aa."albumId" = a.id
              AND ar."isDeleted" = false
              AND (ar.id = ${artistId} OR ar."parentArtistId" = ${artistId})
          )
          ORDER BY a."releaseDate" DESC NULLS LAST, a.id DESC`;
  return rows.map((r) => Number(r.id));
}

async function pagedIds(artistId?: bigint) {
  const first = await getAlbumsPage("ko", artistId, 1);
  const ids: number[] = first.albums.map((a) => Number(a.id));
  const sizes = [first.albums.length];
  for (let page = 2; page <= first.totalPages; page++) {
    const next = await getAlbumsPage("ko", artistId, page);
    // The count is the same on every page of one filter.
    expect(next.total).toBe(first.total);
    ids.push(...next.albums.map((a) => Number(a.id)));
    sizes.push(next.albums.length);
  }
  return { ids, sizes, total: first.total, totalPages: first.totalPages };
}

function expectPages(
  paged: Awaited<ReturnType<typeof pagedIds>>,
  reference: number[],
) {
  expect(paged.total).toBe(reference.length);
  expect(paged.totalPages).toBe(Math.ceil(reference.length / ALBUMS_PER_PAGE));
  // Every page full except the last, which holds the remainder.
  for (const [i, size] of paged.sizes.entries()) {
    expect(size).toBe(
      i < paged.sizes.length - 1
        ? ALBUMS_PER_PAGE
        : reference.length - ALBUMS_PER_PAGE * i,
    );
  }
  // Same rows, same order, nothing duplicated or dropped at a boundary.
  expect(paged.ids).toEqual(reference);
  expect(new Set(paged.ids).size).toBe(paged.ids.length);
}

describe("album list pagination — existing catalog (read-only)", () => {
  it("pages the unfiltered catalog in the reference order", async () => {
    const reference = await referenceIds();
    // Positive control: the catalog spans several pages, so boundaries
    // are actually exercised.
    expect(reference.length).toBeGreaterThan(ALBUMS_PER_PAGE * 2);
    expectPages(await pagedIds(), reference);
  });

  it("pages every artist chip in the reference order", async () => {
    const chips = await getAlbumArtistFilters("ko");
    expect(chips.length).toBeGreaterThan(1);
    for (const chip of chips) {
      const id = BigInt(chip.id);
      const reference = await referenceIds(id);
      // A chip exists only for an artist family with albums.
      expect(reference.length).toBeGreaterThan(0);
      expectPages(await pagedIds(id), reference);
    }
  });
});

describe("album list pagination — fixtures", () => {
  let parent: bigint;
  let emptyParent: bigint;
  // Expected order of the parent filter, computed independently.
  const expected: { id: number; date: string | null }[] = [];

  async function artist(key: string, data: { parentArtistId?: bigint; isDeleted?: boolean } = {}) {
    const row = await prisma.artist.create({
      data: {
        slug: `${TOKEN}-${key}`,
        type: data.parentArtistId ? "unit" : "group",
        originalName: `[QA] ${TOKEN} ${key}`,
        parentArtistId: data.parentArtistId,
        isDeleted: data.isDeleted ?? false,
      },
    });
    created.artists.push(row.id);
    return row.id;
  }

  async function album(key: string, date: string | null, artistIds: bigint[]) {
    const row = await prisma.album.create({
      data: {
        slug: `${TOKEN}-${key}`,
        type: "single",
        originalTitle: `[QA] ${TOKEN} ${key}`,
        releaseDate: date ? new Date(`${date}T00:00:00Z`) : null,
        artists: { create: artistIds.map((artistId) => ({ artistId })) },
      },
    });
    created.albums.push(row.id);
    return Number(row.id);
  }

  beforeAll(async () => {
    parent = await artist("parent");
    const sub = await artist("sub", { parentArtistId: parent });
    const deletedSub = await artist("deleted-sub", { parentArtistId: parent, isDeleted: true });
    emptyParent = await artist("empty-parent");
    const emptyDeletedSub = await artist("empty-deleted-sub", {
      parentArtistId: emptyParent,
      isDeleted: true,
    });

    // 27 albums for `parent` — created undated first and oldest-to-newest,
    // so insertion (id) order is the reverse of display order. Expected
    // rows 15–24 (indexes 14–23) share one date: a tie straddling the
    // 20-row page boundary, decided by id DESC alone.
    const dates: (string | null)[] = [
      null,
      null,
      "2099-01-01",
      ...Array.from({ length: 10 }, () => "2099-06-15"),
      ...Array.from({ length: 14 }, (_, i) => `2099-12-${String(10 + i).padStart(2, "0")}`),
    ];
    for (const [i, date] of dates.entries()) {
      // Alternate the credit between the parent, the sub-unit and both
      // (the both-credited album must still appear once).
      const credit = i % 3 === 0 ? [parent] : i % 3 === 1 ? [sub] : [parent, sub];
      expected.push({ id: await album(`a${i}`, date, credit), date });
    }
    // Credited only to the deleted sub-unit: excluded from the parent's
    // filter and the only album of `emptyParent`'s family.
    await album("deleted-only", "2099-12-31", [deletedSub]);
    await album("empty-deleted-only", "2099-12-31", [emptyDeletedSub]);

    expected.sort((a, b) => {
      if (a.date === b.date) return b.id - a.id;
      if (a.date === null) return 1;
      if (b.date === null) return -1;
      return a.date < b.date ? 1 : -1;
    });
  });

  afterAll(async () => {
    await prisma.albumArtist.deleteMany({ where: { albumId: { in: created.albums } } });
    await prisma.album.deleteMany({ where: { id: { in: created.albums } } });
    // Sub-units reference their parent; delete children first.
    await prisma.artist.deleteMany({
      where: { id: { in: created.artists }, parentArtistId: { not: null } },
    });
    await prisma.artist.deleteMany({ where: { id: { in: created.artists } } });
    const left =
      (await prisma.album.count({ where: { slug: { startsWith: TOKEN } } })) +
      (await prisma.artist.count({ where: { slug: { startsWith: TOKEN } } }));
    expect(left).toBe(0);
  });

  it("splits ties and undated albums across pages in the stable order", async () => {
    const reference = expected.map((e) => e.id);
    // The SQL reference agrees with the independently computed order.
    expect(await referenceIds(parent)).toEqual(reference);
    const paged = await pagedIds(parent);
    expectPages(paged, reference);
    expect(paged.sizes).toEqual([20, 7]);
    // The tie group really does straddle the boundary.
    expect(expected[13].date).toBe("2099-12-10");
    expect(expected[14].date).toBe("2099-06-15");
    expect(expected[19].date).toBe("2099-06-15");
    expect(expected[20].date).toBe("2099-06-15");
    expect(expected[23].date).toBe("2099-06-15");
    expect(expected[24].date).toBe("2099-01-01");
  });

  it("groups the last page by year with the undated bucket last", async () => {
    const last = await getAlbumsPage("ko", parent, 2);
    const groups = groupAlbumsByYear(last.albums);
    expect(groups.map((g) => [g.year, g.albums.length])).toEqual([
      [2099, 5],
      [null, 2],
    ]);
    const first = await getAlbumsPage("ko", parent, 1);
    expect(groupAlbumsByYear(first.albums).map((g) => [g.year, g.albums.length])).toEqual([
      [2099, 20],
    ]);
  });

  it("returns no rows past the last page and an empty filter as 0 pages", async () => {
    const past = await getAlbumsPage("ko", parent, 3);
    expect(past).toMatchObject({ albums: [], total: 27, totalPages: 2 });
    const empty = await getAlbumsPage("ko", emptyParent, 1);
    expect(empty).toEqual({ albums: [], total: 0, totalPages: 0 });
  });

  it("offers a chip for the fixture family but not for the deleted-only one", async () => {
    const chips = (await getAlbumArtistFilters("ko")).map((c) => c.id);
    expect(chips).toContain(String(parent));
    expect(chips).not.toContain(String(emptyParent));
  });
});
