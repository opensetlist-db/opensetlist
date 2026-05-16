import { describe, it, expect, vi, beforeEach } from "vitest";
import { FALLBACK_PROMPT } from "@/lib/translator/prompts";

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

// The route resolves the per-IP system prompt before the translator call.
// Tests don't exercise the resolver internals — that's covered by the
// dedicated prompt-resolver.test.ts. Here we just stub a deterministic
// ResolvedPrompt so the route can thread it into translateMock and we can
// assert on the third positional arg.
const resolvePromptMock = vi.fn();
vi.mock("@/lib/translator/promptResolver", () => ({
  resolvePromptForImpression: (...args: unknown[]) => resolvePromptMock(...args),
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
    // Default resolver: pretend the impression's event maps to Hasunosora.
    // Individual tests can override by re-mocking resolvePromptMock.
    resolvePromptMock.mockResolvedValue({
      prompt: "MOCK_PROMPT",
      ipKey: "hasunosora",
      multiIp: false,
      unregisteredSlug: null,
      franchiseSlugs: ["hasunosora"],
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
    // Resolver is downstream of the same-locale check — must not run.
    expect(resolvePromptMock).not.toHaveBeenCalled();
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
    // Cache hits skip the resolver — no LLM call to inform, no need to walk.
    expect(resolvePromptMock).not.toHaveBeenCalled();
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
    // Translator signature: (text, sourceLocale, systemPrompt, signal).
    // All targets come back in one MultilingualOutput; the resolved
    // systemPrompt comes from the mocked resolver above.
    expect(translateMock).toHaveBeenCalledWith(
      "今日のライブ最高でした",
      "ja",
      "MOCK_PROMPT",
      expect.any(AbortSignal),
    );
    // Resolver invoked with the impression id once per cache miss.
    expect(resolvePromptMock).toHaveBeenCalledWith("imp-1");
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

  it("falls back to FALLBACK_PROMPT when the resolver throws", async () => {
    // Transient Prisma failure on the resolver walk should NOT 500 the
    // handler — the route catches and falls back to FALLBACK_PROMPT so
    // translation still succeeds (with degraded IP context).
    resolvePromptMock.mockRejectedValueOnce(new Error("resolver db down"));

    const res = await POST(
      makeRequest({
        impressionId: "imp-1",
        targetLocale: "ko",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    // Translator must have been called with the actual FALLBACK_PROMPT —
    // a stricter check than "non-empty + not MOCK_PROMPT" so the assertion
    // fails if the fallback ever changes to a different constant.
    expect(translateMock).toHaveBeenCalledTimes(1);
    const systemPromptArg = (translateMock.mock.calls[0] as unknown[])[2];
    expect(systemPromptArg).toBe(FALLBACK_PROMPT);
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
