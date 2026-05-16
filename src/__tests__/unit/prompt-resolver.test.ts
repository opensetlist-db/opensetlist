import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    eventImpression: { findUnique: vi.fn() },
    eventPerformer: { findMany: vi.fn() },
  },
}));

import {
  resolvePromptForImpression,
  _resetPromptResolverCacheForTests,
} from "@/lib/translator/promptResolver";
import { IP_PROMPTS, FALLBACK_PROMPT } from "@/lib/translator/prompts";
import { prisma } from "@/lib/prisma";

// Test shape mirrors the Prisma select in promptResolver.ts: each
// performer carries a single stageIdentity, which carries artistLinks,
// each carrying an artist with groupLinks → group { slug, type }.
function performer(franchiseSlugs: string[]) {
  return {
    stageIdentity: {
      artistLinks: [
        {
          artist: {
            groupLinks: franchiseSlugs.map((slug) => ({
              group: { slug, type: "franchise" },
            })),
          },
        },
      ],
    },
  };
}

// Helper for non-franchise (label / agency / series) Groups — must NOT
// count toward the franchise slug set.
function performerWithLabel(labelSlug: string) {
  return {
    stageIdentity: {
      artistLinks: [
        {
          artist: {
            groupLinks: [{ group: { slug: labelSlug, type: "label" } }],
          },
        },
      ],
    },
  };
}

describe("resolvePromptForImpression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPromptResolverCacheForTests();
    (
      prisma.eventImpression.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ eventId: BigInt(100) });
  });

  it("uses the registered IP prompt when exactly one franchise slug matches", async () => {
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([performer(["hasunosora"])]);

    const result = await resolvePromptForImpression("imp-1");

    expect(result.ipKey).toBe("hasunosora");
    expect(result.prompt).toBe(IP_PROMPTS["hasunosora"]);
    expect(result.multiIp).toBe(false);
    expect(result.unregisteredSlug).toBeNull();
    expect(result.franchiseSlugs).toEqual(["hasunosora"]);
  });

  it("falls back to generic + flags unregisteredSlug for an unknown single franchise", async () => {
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([performer(["nijigasaki"])]);

    const result = await resolvePromptForImpression("imp-1");

    expect(result.ipKey).toBe("generic");
    expect(result.prompt).toBe(FALLBACK_PROMPT);
    expect(result.multiIp).toBe(false);
    expect(result.unregisteredSlug).toBe("nijigasaki");
    expect(result.franchiseSlugs).toEqual(["nijigasaki"]);
  });

  it("falls back to generic + flags multiIp when two distinct franchises appear", async () => {
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      performer(["hasunosora"]),
      performer(["nijigasaki"]),
    ]);

    const result = await resolvePromptForImpression("imp-1");

    expect(result.ipKey).toBe("generic");
    expect(result.prompt).toBe(FALLBACK_PROMPT);
    expect(result.multiIp).toBe(true);
    expect(result.unregisteredSlug).toBeNull();
    expect(result.franchiseSlugs.slice().sort()).toEqual([
      "hasunosora",
      "nijigasaki",
    ]);
  });

  it("falls back to generic with no extras when the event has zero franchise groups", async () => {
    // Performers link only to a label-type Group — must NOT count toward
    // the franchise set. The resolver lands in the zero-franchise branch.
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([performerWithLabel("some-label")]);

    const result = await resolvePromptForImpression("imp-1");

    expect(result.ipKey).toBe("generic");
    expect(result.prompt).toBe(FALLBACK_PROMPT);
    expect(result.multiIp).toBe(false);
    expect(result.unregisteredSlug).toBeNull();
    expect(result.franchiseSlugs).toEqual([]);
  });

  it("falls back to generic when the impression itself is missing", async () => {
    // Edge case: impressionId is invalid / row was hard-deleted. Resolver
    // must not throw — translation can still proceed against generic.
    (
      prisma.eventImpression.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);

    const result = await resolvePromptForImpression("imp-missing");

    expect(result.ipKey).toBe("generic");
    expect(result.prompt).toBe(FALLBACK_PROMPT);
    expect(result.franchiseSlugs).toEqual([]);
    // Bailing on missing impression means we never query performers.
    expect(prisma.eventPerformer.findMany).not.toHaveBeenCalled();
  });

  it("caches by impressionId — second call within TTL skips Prisma", async () => {
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([performer(["hasunosora"])]);

    await resolvePromptForImpression("imp-1");
    await resolvePromptForImpression("imp-1");

    // Both calls returned from the same Prisma read.
    expect(prisma.eventImpression.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.eventPerformer.findMany).toHaveBeenCalledTimes(1);
  });
});
