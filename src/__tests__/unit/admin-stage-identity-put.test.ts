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
    stageIdentity: { update: vi.fn(), findUniqueOrThrow: vi.fn() },
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
const siT = prisma.stageIdentityTranslation as unknown as Record<string, Mock>;
const txMock = prisma.$transaction as unknown as Mock;

const ID = "si-megumi";
const params = Promise.resolve({ id: ID });

// What the DB holds before the save: three locales, each with a
// shortName. The route never reads these before writing — the point of
// the test is that it must not need to, because it only touches what
// it was sent.
const stored = {
  id: ID,
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
  // Sequential (array) transaction: the mocked model calls already ran
  // when the array was built, so resolving the array itself hands the
  // route the per-operation mock results in order.
  txMock.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : arg,
  );
  si.update.mockReturnValue({ id: ID });
  si.findUniqueOrThrow.mockReturnValue(stored);
  siT.upsert.mockReturnValue({});
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

    // The data-loss path: no blanket delete of the identity's rows.
    expect(siT.deleteMany).not.toHaveBeenCalled();

    // Exactly the locale that was sent, upserted on the
    // (stageIdentityId, locale) key ...
    expect(siT.upsert).toHaveBeenCalledTimes(1);
    const call = siT.upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      stageIdentityId_locale: { stageIdentityId: ID, locale: "ko" },
    });
    expect(call.create).toEqual({
      stageIdentityId: ID,
      locale: "ko",
      name: "후지시마 메구미",
      shortName: null,
    });
    // ... and with the shortName column left out of `update`, so the
    // stored "메구미" survives a body that did not mention it.
    expect(call.update).toEqual({ name: "후지시마 메구미" });
    expect(call.update.shortName).toBeUndefined();

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
    expect(siT.upsert).toHaveBeenCalledTimes(2);
    expect(siT.upsert.mock.calls[0][0].update).toEqual({ name: "메구미", shortName: "메구" });
    expect(siT.upsert.mock.calls[1][0].update).toEqual({ name: "Megumi", shortName: null });
    expect(siT.upsert.mock.calls[1][0].create.shortName).toBeNull();
  });

  it("still 400s on a missing / malformed translations array before touching the DB", async () => {
    for (const body of [
      { type: "character" },
      { translations: [] },
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
    await put({ translations: ko, color: "#ABC" });
    expect(si.update.mock.calls[0][0].data.color).toBe("#ABC");
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

  it("the write is one transaction: scalar update, upserts, then the re-read", async () => {
    await put({ translations: ko, color: "#77dd00" });
    expect(txMock).toHaveBeenCalledTimes(1);
    const ops = txMock.mock.calls[0][0];
    expect(Array.isArray(ops)).toBe(true);
    expect(ops).toHaveLength(3);
    expect(si.update).toHaveBeenCalledTimes(1);
    expect(si.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: ID },
      include: { translations: true },
    });
  });
});
