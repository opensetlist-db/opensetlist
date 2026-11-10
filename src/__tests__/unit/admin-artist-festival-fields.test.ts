// Artist-level festival display fields (n15 owner feedback): `color`,
// `sortOrder`, `isSideProject` — the validators, the admin create /
// update routes, and the artists.csv import. The property every layer
// shares: a field the input does not carry leaves the stored value
// alone (colours were backfilled by CSV long before the form could edit
// them), a field it does carry is authoritative.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin-auth", () => ({ verifyAdminAPI: vi.fn() }));
vi.mock("@/lib/dataCache", () => ({ revalidatePublicData: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    artist: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    artistTranslation: { upsert: vi.fn(), deleteMany: vi.fn() },
    artistGroup: { deleteMany: vi.fn() },
  },
}));

import type { NextRequest } from "next/server";
import {
  nullableHexColor,
  nullableInt,
  parseCsvNullableIntCell,
} from "@/lib/admin-input";
import { parseArtistDisplayFields } from "@/app/api/admin/artists/_validate";
import { POST as CREATE } from "@/app/api/admin/artists/route";
import { PUT } from "@/app/api/admin/artists/[id]/route";
import { POST as IMPORT_POST } from "@/app/api/admin/import/route";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { jsonRequest } from "../helpers/requestFactory";

const artist = prisma.artist as unknown as Record<string, ReturnType<typeof vi.fn>>;
const txMock = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  (verifyAdminAPI as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  // Interactive transaction: run the callback against the same mocks.
  txMock.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : arg,
  );
  artist.update.mockResolvedValue({ id: BigInt(20), translations: [] });
  artist.create.mockResolvedValue({ id: BigInt(21), translations: [] });
  artist.findMany.mockResolvedValue([]);
});

describe("nullableHexColor", () => {
  it("accepts #rgb and #rrggbb, trims, empty / null → null", () => {
    expect(nullableHexColor("#e91e8c", "color")).toEqual({ ok: true, value: "#e91e8c" });
    expect(nullableHexColor(" #ABC ", "color")).toEqual({ ok: true, value: "#ABC" });
    for (const v of [undefined, null, "", "   "]) {
      expect(nullableHexColor(v, "color")).toEqual({ ok: true, value: null });
    }
  });

  it("refuses anything else", () => {
    for (const v of ["e91e8c", "#e91e8", "#gggggg", "red", 0xe91e8c]) {
      expect(nullableHexColor(v, "color").ok).toBe(false);
    }
  });
});

describe("nullableInt", () => {
  it("numbers and digit strings (sign allowed); empty / null → null", () => {
    expect(nullableInt(3, "n")).toEqual({ ok: true, value: 3 });
    expect(nullableInt("0", "n")).toEqual({ ok: true, value: 0 });
    expect(nullableInt("-2", "n")).toEqual({ ok: true, value: -2 });
    for (const v of [undefined, null, ""]) {
      expect(nullableInt(v, "n")).toEqual({ ok: true, value: null });
    }
  });

  it("refuses fractions, junk and values outside Postgres integer", () => {
    for (const v of [1.5, "1.5", "abc", NaN, 2 ** 31, "-2147483649", true, {}]) {
      expect(nullableInt(v, "n").ok).toBe(false);
    }
  });
});

describe("parseCsvNullableIntCell", () => {
  it("absent column → undefined, blank → null, integer → number, junk → invalid", () => {
    expect(parseCsvNullableIntCell(undefined)).toBeUndefined();
    expect(parseCsvNullableIntCell("")).toBeNull();
    expect(parseCsvNullableIntCell(" 4 ")).toBe(4);
    expect(parseCsvNullableIntCell("first")).toBe("invalid");
  });
});

describe("parseArtistDisplayFields", () => {
  it("absent keys stay absent (= column untouched)", () => {
    expect(parseArtistDisplayFields({ originalName: "x" })).toEqual({ ok: true, value: {} });
  });

  it("present keys are authoritative, including clears", () => {
    expect(
      parseArtistDisplayFields({ color: "", sortOrder: "", isSideProject: null }),
    ).toEqual({ ok: true, value: { color: null, sortOrder: null, isSideProject: false } });
    expect(
      parseArtistDisplayFields({ color: "#123456", sortOrder: 2, isSideProject: true }),
    ).toEqual({ ok: true, value: { color: "#123456", sortOrder: 2, isSideProject: true } });
  });

  it("an invalid value is a validation error, named by field", () => {
    const bad = [{ color: "pink" }, { sortOrder: "first" }, { isSideProject: "yes" }];
    for (const body of bad) {
      const r = parseArtistDisplayFields(body);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain(Object.keys(body)[0]);
    }
  });
});

const BASE_BODY = {
  type: "group",
  originalName: "サイド",
  originalLanguage: "ja",
  translations: [{ locale: "ja", name: "サイド" }],
};
const params = { params: Promise.resolve({ id: "20" }) };
const put = (body: unknown) =>
  PUT(
    jsonRequest("http://localhost/api/admin/artists/20", body, "PUT") as unknown as NextRequest,
    params,
  );

describe("PUT /api/admin/artists/[id] — festival fields", () => {
  it("rejects self/descendant and existing ancestor cycles before deleting translations or groups", async () => {
    const rows = [
      { id: BigInt(21), parentArtistId: BigInt(20) },
      { id: BigInt(22), parentArtistId: BigInt(21) },
      { id: BigInt(30), parentArtistId: BigInt(31) },
      { id: BigInt(31), parentArtistId: BigInt(30) },
    ];
    artist.findMany.mockResolvedValue(rows);
    expect((await put({ ...BASE_BODY, parentArtistId: "99" })).status).toBe(200);
    expect(prisma.artistTranslation.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.artistGroup.deleteMany).toHaveBeenCalledTimes(1);
    expect(artist.update).toHaveBeenCalledTimes(1);
    for (const parentArtistId of ["20", "21", "22", "30"]) {
      const res = await put({ ...BASE_BODY, parentArtistId });
      expect(res.status).toBe(400);
    }
    expect(prisma.artistTranslation.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.artistGroup.deleteMany).toHaveBeenCalledTimes(1);
    expect(artist.update).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(5);
  });

  it("allows clearing a cyclic parent so operators can repair it", async () => {
    artist.findMany.mockResolvedValue([{ id: BigInt(20), parentArtistId: BigInt(20) }]);
    expect((await put({ ...BASE_BODY, parentArtistId: null })).status).toBe(200);
    expect(artist.update.mock.calls[0][0].data.parentArtistId).toBeNull();
  });
  it("writes them when sent", async () => {
    const res = await put({ ...BASE_BODY, color: "#e91e8c", sortOrder: 5, isSideProject: true });
    expect(res.status).toBe(200);
    expect(artist.update.mock.calls[0][0].data).toMatchObject({
      color: "#e91e8c",
      sortOrder: 5,
      isSideProject: true,
    });
  });

  it("leaves them alone when the body does not carry them", async () => {
    const res = await put(BASE_BODY);
    expect(res.status).toBe(200);
    const data = artist.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("color");
    expect(data).not.toHaveProperty("sortOrder");
    expect(data).not.toHaveProperty("isSideProject");
  });

  it("400 on an invalid colour, before any write", async () => {
    const res = await put({ ...BASE_BODY, color: "#zzzzzz" });
    expect(res.status).toBe(400);
    expect(txMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/artists — festival fields", () => {
  it("passes them to the create", async () => {
    const res = await CREATE(
      jsonRequest("http://localhost/api/admin/artists", {
        ...BASE_BODY,
        slug: "side",
        color: "#abc",
        sortOrder: "3",
        isSideProject: true,
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(201);
    expect(artist.create.mock.calls[0][0].data).toMatchObject({
      color: "#abc",
      sortOrder: 3,
      isSideProject: true,
    });
  });
});

describe("artists.csv import — sortOrder / isSideProject", () => {
  const importCsv = (csv: string) =>
    IMPORT_POST(
      jsonRequest("http://localhost/api/admin/import", {
        type: "artists",
        csv,
      }) as unknown as NextRequest,
    );

  beforeEach(() => {
    artist.findUnique.mockResolvedValue({ id: BigInt(20), type: "group" });
  });

  it("rejects a parent cycle without changing the stored parent, while retaining row feedback", async () => {
    artist.findUnique.mockImplementation(async ({ where }: { where: { slug: string } }) => ({ id: BigInt(where.slug === "root" ? 99 : 20), type: "group" }));
    expect((await importCsv("slug,ja_name,parentArtist_slug\nside,サイド,root")).status).toBe(200);
    const parentWrites = () => artist.update.mock.calls.filter(([args]) => Object.hasOwn(args.data, "parentArtistId"));
    expect(parentWrites()).toHaveLength(1);
    expect(parentWrites()[0][0].data.parentArtistId).toBe(BigInt(99));
    const res = await importCsv("slug,ja_name,parentArtist_slug\nside,サイド,side");
    expect(res.status).toBe(200);
    expect((await res.json()).log).toContain('ERROR: artists.csv parentArtist_slug "side" creates a cycle (artist side) — parent kept');
    expect(parentWrites()).toHaveLength(1);
  });

  it("update: columns omitted from the header leave the stored values alone", async () => {
    const res = await importCsv(["slug,ja_name", "side,サイド"].join("\n"));
    expect(res.status).toBe(200);
    const data = artist.update.mock.calls[0][0].data;
    expect(data.sortOrder).toBeUndefined();
    expect(data.isSideProject).toBeUndefined();
  });

  it("update: values set; a blank sortOrder clears, a blank isSideProject keeps", async () => {
    const res = await importCsv(
      ["slug,ja_name,sortOrder,isSideProject", "side,サイド,2,true", "main,メイン,,"].join("\n"),
    );
    // Blank cells are a valid "keep"/"clear", not an invalid value.
    const body = await res.json();
    expect(body.log.filter((l: string) => l.startsWith("WARN"))).toEqual([]);
    expect(artist.update.mock.calls[0][0].data).toMatchObject({
      sortOrder: 2,
      isSideProject: true,
    });
    const second = artist.update.mock.calls[1][0].data;
    expect(second.sortOrder).toBeNull();
    expect(second.isSideProject).toBeUndefined();
  });

  it("invalid cells WARN and keep the stored value", async () => {
    const res = await importCsv(
      ["slug,ja_name,sortOrder,isSideProject", "side,サイド,first,maybe"].join("\n"),
    );
    const body = await res.json();
    const warns = body.log.filter((l: string) => l.startsWith("WARN"));
    expect(warns).toHaveLength(2);
    expect(warns.every((l: string) => l.endsWith("kept existing value"))).toBe(true);
    const data = artist.update.mock.calls[0][0].data;
    expect(data.sortOrder).toBeUndefined();
    expect(data.isSideProject).toBeUndefined();
  });

  it("create: an invalid cell skips the row with a WARN per cell", async () => {
    artist.findUnique.mockResolvedValue(null);
    const res = await importCsv(
      ["slug,ja_name,sortOrder,isSideProject", "new-one,ニュー,first,maybe"].join("\n"),
    );
    const body = await res.json();
    const warns = body.log.filter((l: string) => l.startsWith("WARN"));
    expect(warns).toEqual([
      'WARN: artists.csv sortOrder "first" is not an integer (artist new-one) — row skipped, fix the CSV and re-import',
      'WARN: artists.csv isSideProject "maybe" is not true/false (artist new-one) — row skipped, fix the CSV and re-import',
    ]);
    expect(artist.create).not.toHaveBeenCalled();
    expect(body.log.some((l: string) => l.startsWith("CREATED"))).toBe(false);
  });

  it("create: one invalid cell is enough to skip; valid rows still import", async () => {
    artist.findUnique.mockResolvedValue(null);
    const res = await importCsv(
      ["slug,ja_name,sortOrder,isSideProject", "bad-one,バッド,3,treu", "good-one,グッド,4,true"].join("\n"),
    );
    const body = await res.json();
    const warns = body.log.filter((l: string) => l.startsWith("WARN"));
    expect(warns).toEqual([
      'WARN: artists.csv isSideProject "treu" is not true/false (artist bad-one) — row skipped, fix the CSV and re-import',
    ]);
    expect(artist.create).toHaveBeenCalledTimes(1);
    expect(artist.create.mock.calls[0][0].data).toMatchObject({
      slug: "good-one",
      sortOrder: 4,
      isSideProject: true,
    });
  });

  it("create: defaults when the CSV carries nothing", async () => {
    artist.findUnique.mockResolvedValue(null);
    await importCsv(["slug,ja_name", "new-one,ニュー"].join("\n"));
    expect(artist.create.mock.calls[0][0].data).toMatchObject({
      sortOrder: null,
      isSideProject: false,
    });
  });
});
