import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    eventImpression: {
      findFirst: vi.fn(),
    },
    impressionTranslation: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

const translateMock = vi.fn();
vi.mock("@/lib/translator", () => ({
  getTranslator: () => ({ translate: translateMock }),
}));

// Mock only `getGlossaryForEvent` so the real `applyGlossary` /
// `restoreGlossary` pure functions still exercise the substitution code path.
// Default in beforeEach is `[]` (empty pairs) → applyGlossary/restoreGlossary
// are no-ops, preserving the pre-glossary behavior of the other tests.
//
// `vi.hoisted` is required because `vi.mock` factories run before top-level
// declarations — declaring `getGlossaryForEventMock` outside `vi.hoisted`
// would trip a "Cannot access ... before initialization" error.
const { getGlossaryForEventMock } = vi.hoisted(() => ({
  getGlossaryForEventMock: vi.fn(),
}));
vi.mock("@/lib/glossary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/glossary")>();
  return {
    ...actual,
    getGlossaryForEvent: getGlossaryForEventMock,
  };
});

// Minimal stand-in for Prisma's runtime PrismaClientKnownRequestError so the
// route's `instanceof Prisma.PrismaClientKnownRequestError` check fires for
// our test-injected error. Class is defined inside the factory because
// `vi.mock` is hoisted above any top-level declarations.
vi.mock("@/generated/prisma/client", () => {
  class FakePrismaKnownError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return { Prisma: { PrismaClientKnownRequestError: FakePrismaKnownError } };
});

import { POST } from "@/app/api/impressions/translate/route";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

// Use the mocked class for instanceof identity in the route's catch block.
const FakePrismaKnownError = Prisma.PrismaClientKnownRequestError as unknown as new (
  code: string,
) => Error & { code: string };

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/impressions/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/impressions/translate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.eventImpression.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "imp-1",
      content: "今日のライブ最高でした",
      locale: "ja",
      eventId: BigInt(100),
    });
    (
      prisma.impressionTranslation.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);
    (
      prisma.impressionTranslation.create as ReturnType<typeof vi.fn>
    ).mockResolvedValue({});
    translateMock.mockResolvedValue("오늘 라이브 최고였어요");
    // Default to empty glossary — real applyGlossary/restoreGlossary become
    // no-ops, so the rest of the route exercises its pre-glossary behavior.
    // Tests that need substitution override this with mockResolvedValueOnce.
    getGlossaryForEventMock.mockResolvedValue([]);
  });

  it("rejects missing impressionId", async () => {
    const res = await POST(
      makeRequest({ targetLocale: "ko" }) as unknown as Parameters<
        typeof POST
      >[0],
    );
    expect(res.status).toBe(400);
    expect(prisma.eventImpression.findFirst).not.toHaveBeenCalled();
  });

  it("rejects invalid targetLocale (not in ko/ja/en)", async () => {
    const res = await POST(
      makeRequest({
        impressionId: "imp-1",
        targetLocale: "de",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
    expect(prisma.eventImpression.findFirst).not.toHaveBeenCalled();
  });

  it("returns 404 when impression is missing/hidden/deleted/superseded", async () => {
    (prisma.eventImpression.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );

    const res = await POST(
      makeRequest({
        impressionId: "imp-1",
        targetLocale: "ko",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(404);
    // Pin the predicate so a regression that drops one of the visibility
    // filters (isDeleted / isHidden / supersededAt) trips this test instead
    // of silently translating moderated content.
    expect(prisma.eventImpression.findFirst).toHaveBeenCalledWith({
      where: {
        id: "imp-1",
        isDeleted: false,
        isHidden: false,
        supersededAt: null,
      },
      select: { id: true, content: true, locale: true, eventId: true },
    });
    expect(translateMock).not.toHaveBeenCalled();
    expect(prisma.impressionTranslation.findUnique).not.toHaveBeenCalled();
  });

  it("short-circuits when source locale === target locale", async () => {
    const res = await POST(
      makeRequest({
        impressionId: "imp-1",
        targetLocale: "ja",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.translatedText).toBe("今日のライブ最高でした");
    expect(translateMock).not.toHaveBeenCalled();
    expect(prisma.impressionTranslation.findUnique).not.toHaveBeenCalled();
    expect(prisma.impressionTranslation.create).not.toHaveBeenCalled();
  });

  it("returns cached translation without calling the translator", async () => {
    (
      prisma.impressionTranslation.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ translatedText: "캐시된 번역" });

    const res = await POST(
      makeRequest({
        impressionId: "imp-1",
        targetLocale: "ko",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.translatedText).toBe("캐시된 번역");
    expect(translateMock).not.toHaveBeenCalled();
    expect(prisma.impressionTranslation.create).not.toHaveBeenCalled();
  });

  it("calls translator on cache miss and writes the row", async () => {
    const res = await POST(
      makeRequest({
        impressionId: "imp-1",
        targetLocale: "ko",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.translatedText).toBe("오늘 라이브 최고였어요");
    expect(translateMock).toHaveBeenCalledWith(
      "今日のライブ最高でした",
      "ja",
      "ko",
      expect.any(AbortSignal),
    );
    expect(prisma.impressionTranslation.create).toHaveBeenCalledWith({
      data: {
        impressionId: "imp-1",
        sourceLocale: "ja",
        targetLocale: "ko",
        translatedText: "오늘 라이브 최고였어요",
      },
    });
  });

  it("returns 502 when the translator throws", async () => {
    translateMock.mockRejectedValue(new Error("provider down"));

    const res = await POST(
      makeRequest({
        impressionId: "imp-1",
        targetLocale: "ko",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(502);
    expect(prisma.impressionTranslation.create).not.toHaveBeenCalled();
  });

  it("substitutes glossary terms before translation and restores after", async () => {
    // Glossary returns one pair; the route should swap "ライブ" → __GLOSS_0__
    // before sending to the translator, then restore __GLOSS_0__ → "라이브"
    // before caching/responding.
    getGlossaryForEventMock.mockResolvedValueOnce([
      { source: "ライブ", target: "라이브" },
    ]);
    translateMock.mockResolvedValueOnce("오늘 __GLOSS_0__ 최고였어요");

    const res = await POST(
      makeRequest({
        impressionId: "imp-1",
        targetLocale: "ko",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Restored — placeholder swapped back to the target-language value.
    expect(body.translatedText).toBe("오늘 라이브 최고였어요");

    // Verify glossary was actually called with the right context.
    expect(getGlossaryForEventMock).toHaveBeenCalledWith(
      BigInt(100),
      "ja",
      "ko",
    );
    // Translator received the placeholder-substituted text, NOT the raw content.
    expect(translateMock).toHaveBeenCalledWith(
      "今日の__GLOSS_0__最高でした",
      "ja",
      "ko",
      expect.any(AbortSignal),
    );
    // Cache stores the post-restoration text — never the placeholder form.
    expect(prisma.impressionTranslation.create).toHaveBeenCalledWith({
      data: {
        impressionId: "imp-1",
        sourceLocale: "ja",
        targetLocale: "ko",
        translatedText: "오늘 라이브 최고였어요",
      },
    });
  });

  it("fails open when glossary lookup throws — translates raw content instead of 502", async () => {
    getGlossaryForEventMock.mockRejectedValueOnce(new Error("db down"));

    const res = await POST(
      makeRequest({
        impressionId: "imp-1",
        targetLocale: "ko",
      }) as unknown as Parameters<typeof POST>[0],
    );
    // Glossary failure is degraded, not fatal — user still gets a translation.
    expect(res.status).toBe(200);
    // Translator was called with the raw (non-substituted) content.
    expect(translateMock).toHaveBeenCalledWith(
      "今日のライブ最高でした",
      "ja",
      "ko",
      expect.any(AbortSignal),
    );
  });

  it("handles P2002 race by returning the winner's cached row", async () => {
    (
      prisma.impressionTranslation.create as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new FakePrismaKnownError("P2002"));
    // First findUnique (cache lookup) → null; second (after P2002) → winner.
    (prisma.impressionTranslation.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ translatedText: "winner-text" });

    const res = await POST(
      makeRequest({
        impressionId: "imp-1",
        targetLocale: "ko",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.translatedText).toBe("winner-text");
  });
});
