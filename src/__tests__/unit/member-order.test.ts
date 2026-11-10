// @vitest-environment node
//
// Official member order (`StageIdentity.sortOrder`): the shared orderBy
// rule, every read that lists members (event roster → pre-show lineup,
// the event performers API → performer checklists, the admin
// stage-identity list → admin pickers), and every write path that sets
// the number (admin validators / routes, members.csv). Prisma is
// mocked, so the reads are pinned by the orderBy they send — the
// database applies it.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin-auth", () => ({ verifyAdminAPI: vi.fn() }));
vi.mock("@/lib/dataCache", () => ({
  CACHE_TTL: { event: 60, entity: 3600 },
  // The cache wrapper is irrelevant here: call the loader directly.
  cachedQuery: (_name: string, fn: unknown) => fn,
  eventTag: (id: unknown) => `event:${String(id)}`,
  revalidatePublicData: vi.fn(),
  revalidateEventData: vi.fn(),
}));
vi.mock("@/lib/slug", () => ({
  resolveCanonicalSlug: vi.fn(async () => ({ ok: true, slug: "member" })),
  deriveSlug: vi.fn(async () => "member"),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    event: { findFirst: vi.fn() },
    eventPerformer: { findMany: vi.fn() },
    artist: { findUnique: vi.fn(), findMany: vi.fn() },
    stageIdentity: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    stageIdentityTranslation: { deleteMany: vi.fn(), upsert: vi.fn() },
    stageIdentityArtist: { upsert: vi.fn() },
    realPersonStageIdentity: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

import type { NextRequest } from "next/server";
import {
  byStageIdentityOrderBy,
  compareMemberOrder,
  stageIdentityOrderBy,
} from "@/lib/memberOrder";
import { fetchEventRoster } from "@/lib/eventRoster";
import { GET as PERFORMERS_GET } from "@/app/api/events/[id]/performers/route";
import { GET as ADMIN_SI_GET } from "@/app/api/admin/stage-identities/route";
import { PUT as ADMIN_SI_PUT } from "@/app/api/admin/stage-identities/[id]/route";
import { POST as ADD_MEMBER_POST } from "@/app/api/admin/artists/[id]/stage-identities/route";
import { parseStageIdentity } from "@/app/api/admin/artists/_validate";
import { POST as IMPORT_POST } from "@/app/api/admin/import/route";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { jsonRequest } from "../helpers/requestFactory";

type Mock = ReturnType<typeof vi.fn>;
const si = prisma.stageIdentity as unknown as Record<string, Mock>;
const eventPerformer = prisma.eventPerformer as unknown as Record<string, Mock>;
const event = prisma.event as unknown as Record<string, Mock>;
const txMock = prisma.$transaction as unknown as Mock;

// The rule every member list applies: operator number (nulls last),
// then creation order, then id.
const RELATION_ORDER = [
  { stageIdentity: { sortOrder: { sort: "asc", nulls: "last" } } },
  { stageIdentity: { createdAt: "asc" } },
  { stageIdentityId: "asc" },
];

beforeEach(() => {
  vi.clearAllMocks();
  (verifyAdminAPI as Mock).mockResolvedValue(null);
  txMock.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma),
  );
});

describe("memberOrder helpers", () => {
  it("stageIdentityOrderBy: sortOrder nulls last → createdAt → id", () => {
    expect(stageIdentityOrderBy()).toEqual([
      { sortOrder: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
      { id: "asc" },
    ]);
  });

  it("byStageIdentityOrderBy: same rule through the relation, FK as tiebreak", () => {
    expect(byStageIdentityOrderBy()).toEqual(RELATION_ORDER);
  });

  it("returns a fresh array per call (a caller cannot mutate the rule)", () => {
    const a = byStageIdentityOrderBy();
    a.pop();
    expect(byStageIdentityOrderBy()).toHaveLength(3);
  });
});

describe("compareMemberOrder (in-memory re-sort, same rule as the orderBy)", () => {
  const row = (id: string, sortOrder: number | null, createdAt: string | Date) => ({
    id,
    sortOrder,
    createdAt,
  });
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  it("numbered first by sortOrder; unnumbered last", () => {
    const rows = [
      row("n", null, "2020-01-01T00:00:00.000Z"),
      row("3", 3, "2024-01-01T00:00:00.000Z"),
      row("0", 0, "2025-01-01T00:00:00.000Z"),
      row("-1", -1, "2026-01-01T00:00:00.000Z"),
    ];
    expect(ids([...rows].sort(compareMemberOrder))).toEqual(["-1", "0", "3", "n"]);
  });

  it("equal or missing numbers fall back to createdAt, not the input order", () => {
    const rows = [
      row("new-null", null, "2024-05-01T00:00:00.000Z"),
      row("old-null", null, "2024-01-01T00:00:00.000Z"),
      row("new-2", 2, "2024-06-01T00:00:00.000Z"),
      row("old-2", 2, "2024-02-01T00:00:00.000Z"),
    ];
    expect(ids([...rows].sort(compareMemberOrder))).toEqual([
      "old-2",
      "new-2",
      "old-null",
      "new-null",
    ]);
  });

  it("same createdAt → id; Date and ISO string compare alike", () => {
    const at = "2024-01-01T00:00:00.000Z";
    const rows = [row("b", null, new Date(at)), row("c", null, at), row("a", null, at)];
    expect(ids([...rows].sort(compareMemberOrder))).toEqual(["a", "b", "c"]);
  });
});

describe("event roster (pre-show lineup source)", () => {
  it("reads EventPerformer rows in the official member order", async () => {
    eventPerformer.findMany.mockResolvedValue([]);
    await fetchEventRoster(BigInt(7), "ko");
    const args = eventPerformer.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ eventId: BigInt(7) });
    expect(args.orderBy).toEqual(RELATION_ORDER);
  });
});

describe("GET /api/events/[id]/performers (performer checklists)", () => {
  const call = () =>
    PERFORMERS_GET({} as NextRequest, { params: Promise.resolve({ id: "7" }) });

  it("orders the performers relation and keeps that order in the payload", async () => {
    const row = (id: string) => ({
      stageIdentityId: id,
      isGuest: false,
      stageIdentity: {
        originalName: id,
        originalShortName: null,
        originalLanguage: "ja",
        translations: [],
        artistLinks: [{ artistId: BigInt(1) }],
      },
    });
    // The DB returns rows already sorted; the route must not reorder.
    event.findFirst.mockResolvedValue({ performers: [row("b"), row("a"), row("c")] });
    const res = await call();
    expect(res.status).toBe(200);
    const select = event.findFirst.mock.calls[0][0].select;
    expect(select.performers.orderBy).toEqual(RELATION_ORDER);
    const body = await res.json();
    expect(body.performers.map((p: { stageIdentityId: string }) => p.stageIdentityId)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
});

describe("GET /api/admin/stage-identities (admin pickers)", () => {
  it("remains available when catalog hierarchy contains a cycle", async () => {
    vi.mocked(prisma.artist.findMany).mockResolvedValue([
      { id: BigInt(10), parentArtistId: BigInt(2), type: "group", sortOrder: null },
      { id: BigInt(2), parentArtistId: BigInt(10), type: "group", sortOrder: null },
    ] as Awaited<ReturnType<typeof prisma.artist.findMany>>);
    const rows = ["b", "a"].map((id) => ({ id, sortOrder: null, createdAt: "2024-01-01T00:00:00Z", artistLinks: [{ artistId: BigInt(id === "a" ? 2 : 10), sortOrder: null }] }));
    si.findMany.mockResolvedValue(rows);
    const res = await ADMIN_SI_GET();
    expect(res.status).toBe(200);
    expect((await res.json()).map((member: { id: string }) => member.id)).toEqual(["a", "b"]);
  });
  it("lists identities in the official member order", async () => {
    const row = (id: string, rank: number | null) => ({ id, sortOrder: rank, createdAt: "2024-01-01T00:00:00Z", artistLinks: [] });
    si.findMany.mockResolvedValue([row("c", null), row("b", 2), row("a", 1)]);
    vi.mocked(prisma.artist.findMany).mockResolvedValue([]);
    const res = await ADMIN_SI_GET();
    expect(res.status).toBe(200);
    expect((await res.json()).map((member: { id: string }) => member.id)).toEqual(["a", "b", "c"]);
  });
});

describe("parseStageIdentity — sortOrder", () => {
  const base = {
    type: "character",
    originalName: "M",
    originalLanguage: "ja",
    translations: [{ locale: "ko", name: "M" }],
  };

  it("integer (number or digit string) → the number", () => {
    for (const [raw, value] of [
      [3, 3],
      ["4", 4],
      ["-1", -1],
      [0, 0],
    ] as const) {
      const parsed = parseStageIdentity({ ...base, sortOrder: raw }, 0);
      expect(parsed.ok && parsed.value.sortOrder).toBe(value);
    }
  });

  it("absent, empty and null → null (not numbered)", () => {
    for (const body of [base, { ...base, sortOrder: "" }, { ...base, sortOrder: null }]) {
      const parsed = parseStageIdentity(body, 0);
      expect(parsed).toMatchObject({ ok: true, value: { sortOrder: null } });
    }
  });

  it("refuses non-integers with the row's field path", () => {
    for (const raw of ["first", 1.5, "2.0", true]) {
      const parsed = parseStageIdentity({ ...base, sortOrder: raw }, 2);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.message).toContain("stageIdentities[2].sortOrder");
    }
  });
});

describe("PUT /api/admin/stage-identities/[id] — sortOrder", () => {
  const put = (body: Record<string, unknown>) =>
    ADMIN_SI_PUT(
      jsonRequest("http://localhost/api/admin/stage-identities/si-1", body, "PUT") as unknown as NextRequest,
      { params: Promise.resolve({ id: "si-1" }) },
    );
  const base = { type: "character", color: null, translations: [{ locale: "ko", name: "M" }] };

  beforeEach(() => {
    si.update.mockResolvedValue({ id: "si-1", translations: [] });
    si.findUniqueOrThrow.mockReturnValue({ id: "si-1", translations: [] });
    (prisma.stageIdentityTranslation.upsert as unknown as Mock).mockReturnValue({});
  });

  it("a body without the key leaves the stored order alone", async () => {
    const res = await put(base);
    expect(res.status).toBe(200);
    expect(si.update.mock.calls[0][0].data.sortOrder).toBeUndefined();
  });

  it("an integer sets it; empty / null clears it", async () => {
    await put({ ...base, sortOrder: 5 });
    await put({ ...base, sortOrder: "" });
    await put({ ...base, sortOrder: null });
    expect(si.update.mock.calls.map((c) => c[0].data.sortOrder)).toEqual([5, null, null]);
  });

  it("a non-integer is a 400 and nothing is written", async () => {
    const res = await put({ ...base, sortOrder: "first" });
    expect(res.status).toBe(400);
    expect(si.update).not.toHaveBeenCalled();
    expect(txMock).not.toHaveBeenCalled();
  });
});

describe("PUT /api/admin/stage-identities/[id] — body validation", () => {
  const put = (body: unknown) =>
    ADMIN_SI_PUT(
      jsonRequest("http://localhost/api/admin/stage-identities/si-1", body, "PUT") as unknown as NextRequest,
      { params: Promise.resolve({ id: "si-1" }) },
    );
  const translations = [{ locale: "ko", name: "M" }];

  beforeEach(() => {
    si.update.mockResolvedValue({ id: "si-1", translations: [] });
    si.findUniqueOrThrow.mockReturnValue({ id: "si-1", translations: [] });
    (prisma.stageIdentityTranslation.upsert as unknown as Mock).mockReturnValue({});
  });

  it("missing / malformed translations or an unknown type → 400 with a message, nothing written", async () => {
    for (const body of [
      {},
      { type: "character" },
      { translations: "M" },
      { translations: [] },
      { translations: [{ locale: "ko" }] },
      { translations: [{ name: "M" }] },
      { translations: [{ locale: "ko", name: 3 }] },
      { translations, type: "idol" },
      { translations, type: 1 },
      [],
    ]) {
      const res = await put(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
    }
    expect(si.update).not.toHaveBeenCalled();
    expect(txMock).not.toHaveBeenCalled();
  });

  it("type absent or null keeps the stored one; a valid type is written", async () => {
    await put({ translations });
    await put({ translations, type: null });
    await put({ translations, type: "persona" });
    expect(si.update.mock.calls.map((c) => c[0].data.type)).toEqual([
      undefined,
      undefined,
      "persona",
    ]);
    // Translations go through per-locale upserts, not the scalar update
    // (see admin-stage-identity-put.test.ts for the full contract).
    expect(si.update.mock.calls[2][0].data.translations).toBeUndefined();
    expect(prisma.stageIdentityTranslation.upsert).toHaveBeenCalledTimes(3);
  });
});

describe("POST /api/admin/artists/[id]/stage-identities — sortOrder", () => {
  const post = (body: Record<string, unknown>) =>
    ADD_MEMBER_POST(
      jsonRequest("http://localhost/api/admin/artists/1/stage-identities", body) as unknown as NextRequest,
      { params: Promise.resolve({ id: "1" }) },
    );
  const base = {
    type: "character",
    originalName: "M",
    originalLanguage: "ja",
    translations: [{ locale: "ko", name: "M" }],
  };

  beforeEach(() => {
    si.create.mockResolvedValue({ id: "si-new", translations: [], voicedBy: [] });
  });

  it("stores the typed number; absent / empty → null", async () => {
    await post({ ...base, sortOrder: "2" });
    await post(base);
    await post({ ...base, sortOrder: "" });
    expect(si.create.mock.calls.map((c) => c[0].data.sortOrder)).toEqual([2, null, null]);
  });

  it("a non-integer is a 400 and nothing is created", async () => {
    const res = await post({ ...base, sortOrder: "x" });
    expect(res.status).toBe(400);
    expect(si.create).not.toHaveBeenCalled();
  });
});

describe("members.csv import — sortOrder", () => {
  const importCsv = (csv: string) =>
    IMPORT_POST(
      jsonRequest("http://localhost/api/admin/import", { type: "members", csv }) as unknown as NextRequest,
    );
  const warnsOf = async (res: Response) =>
    ((await res.json()).log as string[]).filter((l) => l.startsWith("WARN"));

  beforeEach(() => {
    si.findUnique.mockResolvedValue({ id: "si-1" });
    si.update.mockResolvedValue({ id: "si-1" });
    si.create.mockResolvedValue({ id: "si-new" });
  });

  it("update: column omitted from the header → stored order untouched", async () => {
    const res = await importCsv(["character_slug,ja_name", "m1,メンバー"].join("\n"));
    expect(res.status).toBe(200);
    expect(si.update.mock.calls[0][0].data.sortOrder).toBeUndefined();
    expect(await warnsOf(res)).toEqual([]);
  });

  it("update: integer sets, blank clears", async () => {
    const res = await importCsv(
      ["character_slug,ja_name,sortOrder", "m1,メンバー,3", "m2,メンバー2,"].join("\n"),
    );
    expect(si.update.mock.calls.map((c) => c[0].data.sortOrder)).toEqual([3, null]);
    expect(await warnsOf(res)).toEqual([]);
  });

  it("update: invalid cell WARNs and keeps the stored value", async () => {
    const res = await importCsv(["character_slug,ja_name,sortOrder", "m1,メンバー,first"].join("\n"));
    expect(si.update.mock.calls[0][0].data.sortOrder).toBeUndefined();
    expect(await warnsOf(res)).toEqual([
      'WARN: members.csv sortOrder "first" is not an integer (member m1) — kept existing value',
    ]);
  });

  it("create: integer stored; absent → null; invalid → WARN and unnumbered", async () => {
    si.findUnique.mockResolvedValue(null);
    await importCsv(["character_slug,ja_name,sortOrder", "m1,メンバー,2"].join("\n"));
    await importCsv(["character_slug,ja_name", "m2,メンバー2"].join("\n"));
    const res = await importCsv(["character_slug,ja_name,sortOrder", "m3,メンバー3,x"].join("\n"));
    expect(si.create.mock.calls.map((c) => c[0].data.sortOrder)).toEqual([2, null, null]);
    expect(await warnsOf(res)).toEqual([
      'WARN: members.csv sortOrder "x" is not an integer (member m3) — new member left unnumbered',
    ]);
  });
});
