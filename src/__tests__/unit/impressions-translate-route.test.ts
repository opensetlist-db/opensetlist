import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    eventImpression: {
      findFirst: vi.fn(),
    },
    impressionTranslation: {
      findUnique: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

const translateMock = vi.fn();
vi.mock("@/lib/translator", () => ({
  getTranslator: () => ({ translate: translateMock }),
}));

import { POST } from "@/app/api/impressions/translate/route";
import { prisma } from "@/lib/prisma";

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
      prisma.impressionTranslation.createMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ count: 2 });
    // The translator returns all three locales in a single call. The route
    // picks the requested target, and caches both non-source locales.
    translateMock.mockResolvedValue({
      ko: "오늘 라이브 최고였어요",
      ja: "今日のライブ最高でした",
      en: "Today's live was amazing",
    });
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
    expect(prisma.impressionTranslation.createMany).not.toHaveBeenCalled();
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
    expect(prisma.impressionTranslation.createMany).not.toHaveBeenCalled();
  });

  it("calls translator on cache miss and writes both non-source rows in one insert", async () => {
    const res = await POST(
      makeRequest({
        impressionId: "imp-1",
        targetLocale: "ko",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.translatedText).toBe("오늘 라이브 최고였어요");
    // Translator signature is now 3-arg (no targetLocale) — all targets come
    // back in one MultilingualOutput.
    expect(translateMock).toHaveBeenCalledWith(
      "今日のライブ最高でした",
      "ja",
      expect.any(AbortSignal),
    );
    // Both non-source (ja) locales cached from a single LLM round-trip.
    expect(prisma.impressionTranslation.createMany).toHaveBeenCalledWith({
      data: [
        {
          impressionId: "imp-1",
          sourceLocale: "ja",
          targetLocale: "ko",
          translatedText: "오늘 라이브 최고였어요",
        },
        {
          impressionId: "imp-1",
          sourceLocale: "ja",
          targetLocale: "en",
          translatedText: "Today's live was amazing",
        },
      ],
      skipDuplicates: true,
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
    expect(prisma.impressionTranslation.createMany).not.toHaveBeenCalled();
  });

  it("502s when the translator returns an empty target locale", async () => {
    // Provider returned the JSON shape but omitted the requested target —
    // the route logs locale presence and 502s without caching anything.
    translateMock.mockResolvedValueOnce({
      ko: "",
      ja: "今日のライブ最高でした",
      en: "Today's live was amazing",
    });

    const res = await POST(
      makeRequest({
        impressionId: "imp-1",
        targetLocale: "ko",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(502);
    expect(prisma.impressionTranslation.createMany).not.toHaveBeenCalled();
  });

  it("falls through and still returns translation when createMany throws", async () => {
    // Cache-write failure is non-fatal — user still gets the fresh
    // translation; next call repeats the LLM hit.
    (
      prisma.impressionTranslation.createMany as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new Error("db down"));

    const res = await POST(
      makeRequest({
        impressionId: "imp-1",
        targetLocale: "ko",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.translatedText).toBe("오늘 라이브 최고였어요");
  });
});
