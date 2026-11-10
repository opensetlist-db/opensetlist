// `PUT /api/admin/stage-identities/[id]` — the member edit row of the
// admin artist form saves through here with only what the row holds
// (ko name, type, colour, sortOrder). The route must therefore be
// non-destructive toward what the body does not carry: other locales'
// rows, every row's shortName, and the stored colour / sortOrder when
// the key is absent. The pre-fix handler deleted every translation row
// and recreated {locale, name} from the body, so one 저장 on a member
// wiped its ja / en names and all shortNames.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin-auth", () => ({ verifyAdminAPI: vi.fn() }));
vi.mock("@/lib/dataCache", () => ({ revalidatePublicData: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    stageIdentity: { update: vi.fn(), findUnique: vi.fn() },
    stageIdentityTranslation: { upsert: vi.fn(), deleteMany: vi.fn() },
  },
}));

import type { NextRequest } from "next/server";
import { PUT } from "@/app/api/admin/stage-identities/[id]/route";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { jsonRequest } from "../helpers/requestFactory";

type Mock = ReturnType<typeof vi.fn>;
const si = prisma.stageIdentity as unknown as Record<string, Mock>;

const txMock = prisma.$transaction as unknown as Mock;

const ID = "si-megumi";
const params = Promise.resolve({ id: ID });

// The existing locales and short names are the positive control for a partial edit.
const stored = {
  id: ID,
  originalName: "藤島慈",
  originalLanguage: "ja",
  type: "character",
  color: "#77dd00",
  sortOrder: 3,
  translations: [
    { locale: "ja", name: "藤島慈", shortName: "慈" },
    { locale: "ko", name: "후지시마 메구미", shortName: "메구미" },
    { locale: "en", name: "Megumi Fujishima", shortName: "Megumi" },
  ],
};

function put(body: unknown) {
  return PUT(
    jsonRequest(`http://localhost/api/admin/stage-identities/${ID}`, body, "PUT") as NextRequest,
    { params },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (verifyAdminAPI as Mock).mockResolvedValue(null);
  txMock.mockImplementation(async (run: (tx: typeof prisma) => unknown) => run(prisma));
  si.findUnique.mockResolvedValue(stored);
  si.update.mockResolvedValue(stored);
});

describe("PUT /api/admin/stage-identities/[id] — translations", () => {
  it("a ko-only save upserts ko and leaves ja / en rows and every shortName alone", async () => {
    const res = await put({
      type: "character",
      color: "#77dd00",
      sortOrder: 3,
      translations: [{ locale: "ko", name: "후지시마 메구미" }],
    });
    expect(res.status).toBe(200);

    const writes = si.update.mock.calls[0][0].data.translations;
    expect(writes).toEqual({ upsert: [{
      where: { stageIdentityId_locale: { stageIdentityId: ID, locale: "ko" } },
      create: { locale: "ko", name: "후지시마 메구미" },
      update: { name: "후지시마 메구미", shortName: undefined },
    }] });
    expect(stored.translations.find((row) => row.locale === "ko")?.shortName).toBe("메구미");

    // The response is the re-read identity with all three locales.
    const json = await res.json();
    expect(json.translations).toHaveLength(3);
    expect(json.translations.map((t: { locale: string }) => t.locale)).toEqual(["ja", "ko", "en"]);
  });

  it("shortName is written only when the body carries the key (empty string clears it)", async () => {
    const res = await put({
      translations: [
        { locale: "ko", name: "메구미", shortName: "메구" },
        { locale: "en", name: "Megumi", shortName: "" },
      ],
    });
    expect(res.status).toBe(200);
    const [ko, en] = si.update.mock.calls[0][0].data.translations.upsert;
    expect(ko.update).toEqual({ name: "메구미", shortName: "메구" });
    expect(en.update).toEqual({ name: "Megumi", shortName: null });
    expect(en.create.shortName).toBeNull();
  });

  it("requires evidence for the same English spelling and only passes name data to Prisma", async () => {
    si.findUnique.mockResolvedValue({ ...stored, originalName: "Megumi" });
    const english = { locale: "en", name: "Megumi" };
    const korean = { locale: "ko", name: "메구미" };
    const source = "https://example.com/cast";
    for (const translations of [
      [korean, english],
      [{ ...korean, nameSameSource: source }, english],
      [korean, { ...english, nameSameSource: "javascript:void(0)" }],
    ]) {
      expect((await put({ translations })).status).toBe(400);
    }
    expect(si.update).not.toHaveBeenCalled();
    expect((await put({ translations: [korean, { ...english, nameSameSource: source }] })).status).toBe(200);
    expect(si.update.mock.calls[0][0].data.translations.upsert[1].create).toEqual(english);
  });

  it("still 400s on a malformed translations array before touching the DB", async () => {
    for (const body of [
      { translations: "ko" },
      { translations: [{ locale: "ko" }] },
      { translations: [{ locale: "ko", name: "a", shortName: 3 }] },
      { translations: [{ locale: "ko", name: "a" }, { locale: "ko", name: "b" }] },
    ]) {
      const res = await put(body);
      expect(res.status).toBe(400);
    }
    expect(txMock).not.toHaveBeenCalled();
  });
});

describe("PUT /api/admin/stage-identities/[id] — scalar fields", () => {
  const ko = [{ locale: "ko", name: "메구미" }];

  it("rejects a non-hex colour with 400 instead of a 500 from Prisma", async () => {
    for (const color of ["green", "#12345", 0x77dd00, { hex: "#77dd00" }, true]) {
      const res = await put({ translations: ko, color });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/color/);
    }
    expect(txMock).not.toHaveBeenCalled();
  });

  it("colour: absent leaves the stored one, empty / null clears, #rgb / #rrggbb stored", async () => {
    await put({ translations: ko });
    expect(si.update.mock.calls[0][0].data.color).toBeUndefined();

    for (const color of ["", null]) {
      si.update.mockClear();
      await put({ translations: ko, color });
      expect(si.update.mock.calls[0][0].data.color).toBeNull();
    }

    si.update.mockClear();
    const newColor = "#ABC";
    await put({ translations: ko, color: newColor });
    expect(si.update.mock.calls[0][0].data.color).toBe(newColor);
  });

  it("type: absent / null keeps the stored one, a non-member is a 400", async () => {
    await put({ translations: ko });
    expect(si.update.mock.calls[0][0].data.type).toBeUndefined();

    si.update.mockClear();
    await put({ translations: ko, type: "persona" });
    expect(si.update.mock.calls[0][0].data.type).toBe("persona");

    si.update.mockClear();
    const res = await put({ translations: ko, type: "mascot" });
    expect(res.status).toBe(400);
    expect(si.update).not.toHaveBeenCalled();
  });

  it("sortOrder: preserve-on-missing, empty / null clears, non-integer is a 400", async () => {
    await put({ translations: ko });
    expect(si.update.mock.calls[0][0].data.sortOrder).toBeUndefined();

    si.update.mockClear();
    await put({ translations: ko, sortOrder: "" });
    expect(si.update.mock.calls[0][0].data.sortOrder).toBeNull();

    si.update.mockClear();
    await put({ translations: ko, sortOrder: 7 });
    expect(si.update.mock.calls[0][0].data.sortOrder).toBe(7);

    si.update.mockClear();
    const res = await put({ translations: ko, sortOrder: 1.5 });
    expect(res.status).toBe(400);
    expect(si.update).not.toHaveBeenCalled();
  });

  it("allows scalar-only saves on legacy records and rejects incomplete name changes", async () => {
    const change = { translations: [{ locale: "ko", name: "메구미" }] };
    expect((await put(change)).status).toBe(200);
    si.findUnique.mockResolvedValue({ ...stored, translations: stored.translations.slice(0, 2) });
    expect((await put({ color: stored.color })).status).toBe(200);
    const response = await put(change);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("name (en");
    expect(si.update).toHaveBeenCalledTimes(2);
  });
});
