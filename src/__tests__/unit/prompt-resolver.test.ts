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
// each carrying an artist with { slug, type, parentArtistId }. The
// resolver filters down to top-level group Artists (type=group AND
// parentArtistId IS NULL) and treats those slugs as IP identities.
function performer(
  artists: Array<{
    slug: string;
    type: "group" | "unit" | "solo";
    parentArtistId: string | null;
  }>,
) {
  return {
    stageIdentity: {
      artistLinks: artists.map((artist) => ({ artist })),
    },
  };
}

// Convenience helpers for the most common rosters.
function topLevelGroup(slug: string) {
  return { slug, type: "group" as const, parentArtistId: null };
}
function subUnit(slug: string, parentArtistId: string) {
  return { slug, type: "unit" as const, parentArtistId };
}
function soloArtist(slug: string, parentArtistId: string | null = null) {
  return { slug, type: "solo" as const, parentArtistId };
}

describe("resolvePromptForImpression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPromptResolverCacheForTests();
    (
      prisma.eventImpression.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ eventId: BigInt(100) });
  });

  it("uses the registered IP prompt when exactly one top-level Artist matches", async () => {
    // Realistic Hasunosora event: each performer is a stage identity (a
    // character) whose artistLinks include the solo Artist + sub-unit
    // Artist + top-level hasunosora group Artist. Only the last counts.
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      performer([
        soloArtist("hino-kaho-solo", "hasunosora"),
        subUnit("cerise-bouquet", "hasunosora"),
        topLevelGroup("hasunosora"),
      ]),
    ]);

    const result = await resolvePromptForImpression("imp-1");

    expect(result.ipKey).toBe("hasunosora");
    expect(result.prompt).toBe(IP_PROMPTS["hasunosora"]);
    expect(result.multiIp).toBe(false);
    expect(result.unregisteredSlug).toBeNull();
    expect(result.ipSlugs).toEqual(["hasunosora"]);
  });

  it("resolves Nijigasaki to its registered prompt", async () => {
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      performer([
        soloArtist("uehara-ayumu-solo", "nijigasaki"),
        subUnit("azuna", "nijigasaki"),
        topLevelGroup("nijigasaki"),
      ]),
    ]);

    const result = await resolvePromptForImpression("imp-1");

    expect(result.ipKey).toBe("nijigasaki");
    expect(result.prompt).toBe(IP_PROMPTS["nijigasaki"]);
    expect(result.multiIp).toBe(false);
    expect(result.ipSlugs).toEqual(["nijigasaki"]);
  });

  it("ignores sub-unit and solo Artists — only the top-level group counts toward the IP set", async () => {
    // Pathological case: a performer's artistLinks include sub-unit and
    // solo entries but the top-level group is missing. The resolver
    // surfaces zero IP slugs and falls back to generic. This wouldn't
    // happen with our seed data (every character is linked to the parent
    // group) but documents the filter contract.
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      performer([
        soloArtist("hino-kaho-solo", "hasunosora"),
        subUnit("cerise-bouquet", "hasunosora"),
      ]),
    ]);

    const result = await resolvePromptForImpression("imp-1");

    expect(result.ipKey).toBe("generic");
    expect(result.ipSlugs).toEqual([]);
  });

  it("falls back to generic + flags unregisteredSlug for an unknown single IP", async () => {
    // Future IP that hasn't been onboarded yet — surfaced through the
    // walk but not in IP_PROMPTS. Operator signal: this IP shipped events
    // without a prompt.
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([performer([topLevelGroup("aqours")])]);

    const result = await resolvePromptForImpression("imp-1");

    expect(result.ipKey).toBe("generic");
    expect(result.prompt).toBe(FALLBACK_PROMPT);
    expect(result.multiIp).toBe(false);
    expect(result.unregisteredSlug).toBe("aqours");
    expect(result.ipSlugs).toEqual(["aqours"]);
  });

  it("falls back to generic + multiIp=true when two registered IPs appear (joint live)", async () => {
    // Hasunosora × Nijigasaki joint live — both top-level group Artists
    // registered. Composite override not implemented; resolver falls back
    // to generic with multiIp=true for observability.
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      performer([topLevelGroup("hasunosora")]),
      performer([topLevelGroup("nijigasaki")]),
    ]);

    const result = await resolvePromptForImpression("imp-1");

    expect(result.ipKey).toBe("generic");
    expect(result.prompt).toBe(FALLBACK_PROMPT);
    expect(result.multiIp).toBe(true);
    expect(result.unregisteredSlug).toBeNull();
    expect(result.ipSlugs.slice().sort()).toEqual(["hasunosora", "nijigasaki"]);
  });

  it("collapses duplicate top-level slugs across performers", async () => {
    // Realistic case: every character on a Niji event links to the same
    // top-level nijigasaki Artist. Set semantics collapse to one slug.
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      performer([topLevelGroup("nijigasaki")]),
      performer([topLevelGroup("nijigasaki")]),
      performer([topLevelGroup("nijigasaki")]),
    ]);

    const result = await resolvePromptForImpression("imp-1");

    expect(result.ipKey).toBe("nijigasaki");
    expect(result.ipSlugs).toEqual(["nijigasaki"]);
  });

  it("falls back to generic with no extras when the event has zero top-level group Artists", async () => {
    // Performers link only to solo/unit artists with no top-level group.
    // Won't happen in our seed data but documents the zero-IP branch.
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([performer([soloArtist("guest-singer")])]);

    const result = await resolvePromptForImpression("imp-1");

    expect(result.ipKey).toBe("generic");
    expect(result.prompt).toBe(FALLBACK_PROMPT);
    expect(result.multiIp).toBe(false);
    expect(result.unregisteredSlug).toBeNull();
    expect(result.ipSlugs).toEqual([]);
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
    expect(result.ipSlugs).toEqual([]);
    // Bailing on missing impression means we never query performers.
    expect(prisma.eventPerformer.findMany).not.toHaveBeenCalled();
  });

  it("caches by impressionId — second call within TTL skips Prisma", async () => {
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([performer([topLevelGroup("hasunosora")])]);

    await resolvePromptForImpression("imp-1");
    await resolvePromptForImpression("imp-1");

    // Both calls returned from the same Prisma read.
    expect(prisma.eventImpression.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.eventPerformer.findMany).toHaveBeenCalledTimes(1);
  });
});
