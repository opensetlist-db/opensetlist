import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin-auth", () => ({
  verifyAdminAPI: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    albumBonusImportJob: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    albumStoreListing: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    albumStoreBonus: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { POST as IMPORT_POST } from "@/app/api/admin/album-bonuses/import/route";
import {
  GET as JOB_GET,
  PATCH as JOB_PATCH,
  DELETE as JOB_DELETE,
} from "@/app/api/admin/album-bonuses/import/[jobId]/route";
import { POST as JOB_APPLY } from "@/app/api/admin/album-bonuses/import/[jobId]/apply/route";
import { prisma } from "@/lib/prisma";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { jsonRequest } from "../helpers/requestFactory";

const verifyMock = verifyAdminAPI as ReturnType<typeof vi.fn>;

const validCandidates = {
  sourceUrl: null,
  parsedAt: "2026-05-28T00:00:00Z",
  albumTitleGuess: null,
  releaseDateGuess: null,
  listings: [
    {
      originalStoreName: "Amazon.co.jp",
      originalEditionLabel: null,
      productUrl: null,
      bonuses: [
        {
          originalBonusType: "スリーブケース",
          originalBonusDescription: null,
          bonusImageUrl: null,
        },
      ],
    },
  ],
  globalEarlyBooking: null,
  warnings: [],
};

const noJobParams = { params: Promise.resolve({ jobId: "" }) };
const fakeParams = (jobId: string) => ({ params: Promise.resolve({ jobId }) });

beforeEach(() => {
  vi.clearAllMocks();
  verifyMock.mockResolvedValue(null);
});

describe("POST /api/admin/album-bonuses/import", () => {
  it("returns 401 without admin session", async () => {
    verifyMock.mockResolvedValue(
      Response.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await IMPORT_POST(
      jsonRequest("http://x/api/admin/album-bonuses/import", {
        candidates: validCandidates,
      }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when candidates JSON is malformed", async () => {
    const res = await IMPORT_POST(
      jsonRequest("http://x/api/admin/album-bonuses/import", {
        candidates: { not: "valid" },
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when listings array is empty", async () => {
    const res = await IMPORT_POST(
      jsonRequest("http://x/api/admin/album-bonuses/import", {
        candidates: { ...validCandidates, listings: [] },
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("creates a pending job and returns initial classifications", async () => {
    (prisma.albumBonusImportJob.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      albumId: null,
      status: "pending",
      sourceUrl: null,
      notes: null,
      candidates: validCandidates,
      decisions: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      appliedAt: null,
      discardedAt: null,
    });
    const res = await IMPORT_POST(
      jsonRequest("http://x/api/admin/album-bonuses/import", {
        candidates: validCandidates,
      }) as never,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.job.id).toBe("job-1");
    expect(body.classifications.listings).toHaveLength(1);
    // No album yet → everything is an insert (no DB rows to match against).
    expect(body.classifications.listings[0].kind).toBe("insert");
    // No DB query happened because albumId is null — keeps the import
    // path cheap when operator hasn't selected an album yet.
    expect(prisma.albumStoreListing.findMany).not.toHaveBeenCalled();
  });

  it("classifies against existing rows when albumId provided", async () => {
    (prisma.albumBonusImportJob.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-2",
      albumId: BigInt(42),
      status: "pending",
      sourceUrl: null,
      notes: null,
      candidates: validCandidates,
      decisions: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      appliedAt: null,
      discardedAt: null,
    });
    (prisma.albumStoreListing.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "L-amazon",
        originalStoreName: "Amazon.co.jp",
        originalEditionLabel: null,
        productUrl: null,
        bonuses: [{ id: "B-1", originalBonusType: "スリーブケース" }],
      },
    ]);
    const res = await IMPORT_POST(
      jsonRequest("http://x/api/admin/album-bonuses/import", {
        candidates: validCandidates,
        albumId: "42",
      }) as never,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.classifications.listings[0].kind).toBe("update-noop");
    expect(body.classifications.bonuses[0].kind).toBe("update-noop");
  });
});

describe("GET /api/admin/album-bonuses/import/[jobId]", () => {
  it("returns 404 when the job is missing", async () => {
    (prisma.albumBonusImportJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await JOB_GET(
      new Request("http://x") as never,
      fakeParams("nope"),
    );
    expect(res.status).toBe(404);
  });

  it("returns job + freshly-computed classifications", async () => {
    (prisma.albumBonusImportJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      albumId: BigInt(42),
      sourceUrl: null,
      notes: null,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
      appliedAt: null,
      discardedAt: null,
      candidates: validCandidates,
      decisions: null,
      album: {
        id: BigInt(42),
        originalTitle: "Test Album",
        slug: "test",
        releaseDate: null,
      },
    });
    (prisma.albumStoreListing.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const res = await JOB_GET(
      new Request("http://x") as never,
      fakeParams("job-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candidates.listings).toHaveLength(1);
    expect(body.classifications.listings[0].kind).toBe("insert");
  });
});

describe("PATCH /api/admin/album-bonuses/import/[jobId]", () => {
  it("returns 409 when job is no longer pending (status guard)", async () => {
    // Simulate the in-tx race-window check: findUnique returns
    // status=applied; the route refuses with 409.
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => {
        const tx = {
          albumBonusImportJob: {
            findUnique: vi.fn().mockResolvedValue({ status: "applied" }),
            update: vi.fn(),
          },
        } as unknown as typeof prisma;
        return fn(tx);
      },
    );
    const res = await JOB_PATCH(
      jsonRequest(
        "http://x/api/admin/album-bonuses/import/job-1",
        { notes: "test" },
        "PATCH",
      ) as never,
      fakeParams("job-1"),
    );
    expect(res.status).toBe(409);
  });

  it("returns 404 when job missing", async () => {
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => {
        const tx = {
          albumBonusImportJob: {
            findUnique: vi.fn().mockResolvedValue(null),
            update: vi.fn(),
          },
        } as unknown as typeof prisma;
        return fn(tx);
      },
    );
    const res = await JOB_PATCH(
      jsonRequest("http://x", { notes: "x" }, "PATCH") as never,
      fakeParams("missing"),
    );
    expect(res.status).toBe(404);
  });

  it("accepts a decisions update", async () => {
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => {
        const tx = {
          albumBonusImportJob: {
            findUnique: vi.fn().mockResolvedValue({ status: "pending" }),
            update: vi.fn().mockResolvedValue({
              id: "job-1",
              status: "pending",
              decisions: {
                listings: { 0: { approved: true } },
                bonuses: {},
                globalEarlyBooking: null,
              },
              album: null,
            }),
          },
        } as unknown as typeof prisma;
        return fn(tx);
      },
    );
    const res = await JOB_PATCH(
      jsonRequest(
        "http://x",
        {
          decisions: {
            listings: { 0: { approved: true } },
            bonuses: {},
            globalEarlyBooking: null,
          },
        },
        "PATCH",
      ) as never,
      fakeParams("job-1"),
    );
    expect(res.status).toBe(200);
  });

  it("rejects invalid decisions shape", async () => {
    const res = await JOB_PATCH(
      jsonRequest(
        "http://x",
        { decisions: "not-an-object" },
        "PATCH",
      ) as never,
      fakeParams("job-1"),
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/admin/album-bonuses/import/[jobId]", () => {
  it("returns 409 when job is applied (audit guard)", async () => {
    (prisma.albumBonusImportJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      { status: "applied" },
    );
    const res = await JOB_DELETE(
      new Request("http://x", { method: "DELETE" }) as never,
      fakeParams("job-1"),
    );
    expect(res.status).toBe(409);
    expect(prisma.albumBonusImportJob.delete).not.toHaveBeenCalled();
  });

  it("hard-deletes a pending job", async () => {
    (prisma.albumBonusImportJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      { status: "pending" },
    );
    (prisma.albumBonusImportJob.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const res = await JOB_DELETE(
      new Request("http://x", { method: "DELETE" }) as never,
      fakeParams("job-1"),
    );
    expect(res.status).toBe(200);
    expect(prisma.albumBonusImportJob.delete).toHaveBeenCalledWith({ where: { id: "job-1" } });
  });
});

describe("POST /api/admin/album-bonuses/import/[jobId]/apply", () => {
  it("returns 400 when albumId is null", async () => {
    (prisma.albumBonusImportJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      status: "pending",
      albumId: null,
      sourceUrl: null,
      candidates: validCandidates,
      decisions: null,
    });
    const res = await JOB_APPLY(
      new Request("http://x", { method: "POST" }) as never,
      fakeParams("job-1"),
    );
    expect(res.status).toBe(400);
  });

  it("returns 409 when job is already applied", async () => {
    (prisma.albumBonusImportJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      status: "applied",
      albumId: BigInt(42),
      sourceUrl: null,
      candidates: validCandidates,
      decisions: null,
    });
    const res = await JOB_APPLY(
      new Request("http://x", { method: "POST" }) as never,
      fakeParams("job-1"),
    );
    expect(res.status).toBe(409);
  });

  it("returns 404 for missing job", async () => {
    (prisma.albumBonusImportJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await JOB_APPLY(
      new Request("http://x", { method: "POST" }) as never,
      fakeParams("missing"),
    );
    expect(res.status).toBe(404);
  });

  it("applies approved inserts in a transaction and flips status to applied", async () => {
    (prisma.albumBonusImportJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      status: "pending",
      albumId: BigInt(42),
      sourceUrl: "https://www.lovelive-anime.jp/news/01_5742.html",
      candidates: validCandidates,
      decisions: {
        listings: { 0: { approved: true } },
        bonuses: { "0:0": { approved: true } },
        globalEarlyBooking: null,
      },
    });

    const createdListing = { id: "L-NEW" };
    const createListing = vi.fn().mockResolvedValue(createdListing);
    const updateListing = vi.fn();
    const createBonus = vi.fn();
    const updateJob = vi.fn().mockResolvedValue({});

    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => {
        const tx = {
          albumStoreListing: {
            findMany: vi.fn().mockResolvedValue([]), // no existing rows
            create: createListing,
            update: updateListing,
          },
          albumStoreBonus: { create: createBonus },
          albumBonusImportJob: { update: updateJob },
        } as unknown as typeof prisma;
        return fn(tx);
      },
    );

    const res = await JOB_APPLY(
      new Request("http://x", { method: "POST" }) as never,
      fakeParams("job-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied.listingsInserted).toBe(1);
    expect(body.applied.bonusesInserted).toBe(1);

    // sourceUrl propagated from job onto new listing.
    expect(createListing).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceUrl: "https://www.lovelive-anime.jp/news/01_5742.html",
          originalStoreName: "Amazon.co.jp",
        }),
      }),
    );
    // Bonus inserted under the freshly-created listing.
    expect(createBonus).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          listingId: "L-NEW",
          originalBonusType: "スリーブケース",
        }),
      }),
    );
    // Status flipped to applied.
    expect(updateJob).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: expect.objectContaining({ status: "applied" }),
      }),
    );
  });

  it("skips listings the operator did not approve", async () => {
    (prisma.albumBonusImportJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      status: "pending",
      albumId: BigInt(42),
      sourceUrl: null,
      candidates: validCandidates,
      decisions: {
        listings: { 0: { approved: false } },
        bonuses: { "0:0": { approved: true } }, // bonus approved but parent listing rejected
        globalEarlyBooking: null,
      },
    });

    const createListing = vi.fn();
    const createBonus = vi.fn();
    const updateJob = vi.fn().mockResolvedValue({});

    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => {
        const tx = {
          albumStoreListing: {
            findMany: vi.fn().mockResolvedValue([]),
            create: createListing,
            update: vi.fn(),
          },
          albumStoreBonus: { create: createBonus },
          albumBonusImportJob: { update: updateJob },
        } as unknown as typeof prisma;
        return fn(tx);
      },
    );

    const res = await JOB_APPLY(
      new Request("http://x", { method: "POST" }) as never,
      fakeParams("job-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied.listingsInserted).toBe(0);
    // Bonus had no listingId to attach to (parent listing was an
    // unapproved insert) — skipped, not erroring.
    expect(body.applied.bonusesInserted).toBe(0);
    expect(createListing).not.toHaveBeenCalled();
    expect(createBonus).not.toHaveBeenCalled();
  });
});

// Silence unused parameter — the file used at top of test for type hint
void noJobParams;
