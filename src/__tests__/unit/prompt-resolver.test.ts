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
// Each group entry is a (slug, type) tuple so individual cases can mix
// franchise/series/label types within one performer's artist.
function performer(
  groups: Array<{ slug: string; type: "franchise" | "series" | "label" | "agency" }>,
) {
  return {
    stageIdentity: {
      artistLinks: [
        {
          artist: {
            groupLinks: groups.map((g) => ({ group: g })),
          },
        },
      ],
    },
  };
}

// Convenience helpers for the common cases.
function franchisePerformer(...slugs: string[]) {
  return performer(slugs.map((slug) => ({ slug, type: "franchise" as const })));
}
function seriesPerformer(...slugs: string[]) {
  return performer(slugs.map((slug) => ({ slug, type: "series" as const })));
}

describe("resolvePromptForImpression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPromptResolverCacheForTests();
    (
      prisma.eventImpression.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ eventId: BigInt(100) });
  });

  it("uses the registered IP prompt when exactly one series slug matches", async () => {
    // Hasunosora artists carry only their series Group at the test fixture
    // level (real data also carries `lovelive` franchise — covered below).
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([seriesPerformer("hasunosora-club")]);

    const result = await resolvePromptForImpression("imp-1");

    expect(result.ipKey).toBe("hasunosora-club");
    expect(result.prompt).toBe(IP_PROMPTS["hasunosora-club"]);
    expect(result.multiIp).toBe(false);
    expect(result.unregisteredSlug).toBeNull();
    expect(result.franchiseSlugs).toEqual(["hasunosora-club"]);
  });

  it("uses the registered IP prompt when the series slug appears alongside an unregistered franchise (lovelive)", async () => {
    // Real Hasunosora artist data carries BOTH `lovelive` (franchise) and
    // `hasunosora-club` (series). The walk surfaces both; registered-first
    // selection picks the series and ignores the franchise — without this
    // rule the event would (wrongly) fall to multi-slug generic.
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      performer([
        { slug: "lovelive", type: "franchise" },
        { slug: "hasunosora-club", type: "series" },
      ]),
    ]);

    const result = await resolvePromptForImpression("imp-1");

    expect(result.ipKey).toBe("hasunosora-club");
    expect(result.prompt).toBe(IP_PROMPTS["hasunosora-club"]);
    expect(result.multiIp).toBe(false);
    expect(result.unregisteredSlug).toBeNull();
    // Both slugs are surfaced for observability even though only the
    // series one was used.
    expect(result.franchiseSlugs.slice().sort()).toEqual([
      "hasunosora-club",
      "lovelive",
    ]);
  });

  it("resolves Nijigasaki to its series-level prompt", async () => {
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      performer([
        { slug: "lovelive", type: "franchise" },
        { slug: "nijigasaki-club", type: "series" },
      ]),
    ]);

    const result = await resolvePromptForImpression("imp-1");

    expect(result.ipKey).toBe("nijigasaki-club");
    expect(result.prompt).toBe(IP_PROMPTS["nijigasaki-club"]);
    expect(result.multiIp).toBe(false);
  });

  it("falls back to generic + flags unregisteredSlug when only an unregistered franchise/series appears", async () => {
    // Future series that hasn't been onboarded yet — surfaced through the
    // walk but not in IP_PROMPTS. Operator signal: this IP shipped events
    // without a prompt.
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([seriesPerformer("aqours-club")]);

    const result = await resolvePromptForImpression("imp-1");

    expect(result.ipKey).toBe("generic");
    expect(result.prompt).toBe(FALLBACK_PROMPT);
    expect(result.multiIp).toBe(false);
    expect(result.unregisteredSlug).toBe("aqours-club");
    expect(result.franchiseSlugs).toEqual(["aqours-club"]);
  });

  it("falls back to generic + multiIp=true when two registered series appear (joint live)", async () => {
    // Hasunosora × Nijigasaki joint live — both series Groups are
    // registered. Composite override not implemented; resolver falls back
    // to generic with multiIp=true for observability.
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      performer([
        { slug: "lovelive", type: "franchise" },
        { slug: "hasunosora-club", type: "series" },
      ]),
      performer([
        { slug: "lovelive", type: "franchise" },
        { slug: "nijigasaki-club", type: "series" },
      ]),
    ]);

    const result = await resolvePromptForImpression("imp-1");

    expect(result.ipKey).toBe("generic");
    expect(result.prompt).toBe(FALLBACK_PROMPT);
    expect(result.multiIp).toBe(true);
    expect(result.unregisteredSlug).toBeNull();
    expect(result.franchiseSlugs.slice().sort()).toEqual([
      "hasunosora-club",
      "lovelive",
      "nijigasaki-club",
    ]);
  });

  it("falls back to generic with no extras when the event has zero franchise/series groups", async () => {
    // Performers link only to a label-type Group — must NOT count toward
    // the franchise/series set. The resolver lands in the zero-IP branch.
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      performer([{ slug: "some-label", type: "label" }]),
    ]);

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
    ).mockResolvedValue([seriesPerformer("hasunosora-club")]);

    await resolvePromptForImpression("imp-1");
    await resolvePromptForImpression("imp-1");

    // Both calls returned from the same Prisma read.
    expect(prisma.eventImpression.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.eventPerformer.findMany).toHaveBeenCalledTimes(1);
  });

  it("ignores agency-type groups (only franchise/series count)", async () => {
    // Cross-check the inverse of the registered-first rule: an agency-type
    // Group like "lantis" must NOT count toward the candidate set, so an
    // artist with only an agency link resolves to generic with no slugs.
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      performer([{ slug: "lantis", type: "agency" }]),
    ]);

    const result = await resolvePromptForImpression("imp-1");

    expect(result.ipKey).toBe("generic");
    expect(result.franchiseSlugs).toEqual([]);
  });
});
