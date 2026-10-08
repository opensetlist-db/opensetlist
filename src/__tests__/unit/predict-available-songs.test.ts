import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  mapAvailableSongRows,
  type AvailableSongRow,
} from "@/lib/predict/availableSongs";

type RowArtist = AvailableSongRow["artists"][number]["artist"];

function artist(
  id: bigint,
  parentArtistId: bigint | null,
  slug: string,
  isMainUnit = false,
): RowArtist {
  return {
    id,
    slug,
    color: "#123456",
    parentArtistId,
    isMainUnit,
    originalName: slug,
    originalShortName: null,
    originalLanguage: "ja",
    isDeleted: false,
    translations: [],
  };
}

function row(id: bigint, title: string, artists: RowArtist[]): AvailableSongRow {
  return {
    id,
    originalTitle: title,
    originalLanguage: "ja",
    variantLabel: null,
    baseVersionId: null,
    translations: [],
    artists: artists.map((a) => ({ artist: a })),
  };
}

const HASU = artist(BigInt(1), null, "hasunosora");
const CERISE = artist(BigInt(2), BigInt(1), "cerise", true);
const DOLL = artist(BigInt(3), BigInt(1), "dollchestra", true);
const KOZUE = artist(BigInt(4), BigInt(1), "kozue");
const KAHO = artist(BigInt(5), BigInt(1), "kaho");
// Synthetic grandchild (depth 2) under Cerise.
const DEEP = artist(BigInt(9), BigInt(2), "deep-unit");
const OUTSIDER = artist(BigInt(70), null, "liella");

const ROWS = [
  row(BigInt(10), "Dream Believers", [HASU]),
  row(BigInt(20), "Aoku Haruka", [CERISE]),
  row(BigInt(30), "Collab", [HASU, CERISE, DOLL]),
  row(BigInt(40), "Five Solos", [KOZUE, KAHO]),
  row(BigInt(50), "Cover With Guest", [CERISE, OUTSIDER]),
];

describe("mapAvailableSongRows — single-artist scope (root + depth 1)", () => {
  // `rootId` as a number on purpose: the page used to hand in a
  // serializeBigInt'd id while Prisma rows carry bigint.
  const out = mapAvailableSongRows(ROWS, 1, [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)], "ja");

  it("keeps the established routing for every row", () => {
    expect(
      out.map((s) => [
        s.songId,
        s.unit.artistId,
        s.unit.isSubUnit,
        s.isMultiArtist,
        s.creditedArtistIds,
        s.festivalGroupIds,
      ]),
    ).toEqual([
      [10, 1, false, false, [1], []],
      // sub-unit wins over the group credit
      [20, 2, true, false, [2], []],
      // ≥2 sub-units with a main unit → first main unit
      [30, 2, true, false, [1, 2, 3], []],
      // ≥2 non-main sub-units → multi-artist, first one for display
      [40, 4, true, true, [4, 5], []],
      // out-of-scope co-credit is ignored
      [50, 2, true, false, [2], []],
    ]);
  });
});

describe("mapAvailableSongRows — descendant scope", () => {
  it("credits a grandchild when it is in scope", () => {
    const out = mapAvailableSongRows(
      [row(BigInt(60), "Deep Song", [DEEP])],
      BigInt(1),
      [BigInt(1), BigInt(2), BigInt(3), BigInt(9)],
      "ja",
    );
    expect(out).toHaveLength(1);
    expect(out[0].unit.artistId).toBe(9);
    expect(out[0].unit.isSubUnit).toBe(true);
    expect(out[0].creditedArtistIds).toEqual([9]);
  });

  it("drops a row with no in-scope credit", () => {
    expect(
      mapAvailableSongRows([row(BigInt(70), "Other IP", [OUTSIDER])], BigInt(1), [BigInt(1), BigInt(2)], "ja"),
    ).toEqual([]);
  });
});
