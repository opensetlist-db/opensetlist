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
import {
  IP_PROMPTS,
  FRANCHISE_PROMPTS,
  FALLBACK_PROMPT,
} from "@/lib/translator/prompts";
import { prisma } from "@/lib/prisma";

// Test shape mirrors the Prisma select in promptResolver.ts: each
// performer carries a single stageIdentity, which carries artistLinks,
// each carrying an artist with { slug, type, parentArtistId, groupLinks }.
// The resolver filters down to top-level group Artists (type=group AND
// parentArtistId IS NULL) and treats those slugs as IP identities.
type PerformerArtist = {
  slug: string;
  type: "group" | "unit" | "solo";
  parentArtistId: string | null;
  groupLinks?: Array<{ group: { slug: string } }>;
};
function performer(artists: PerformerArtist[]) {
  return {
    stageIdentity: {
      artistLinks: artists.map((artist) => ({ artist })),
    },
  };
}

// Convenience helpers for the most common rosters.
function topLevelGroup(slug: string, groups: string[] = []) {
  return {
    slug,
    type: "group" as const,
    parentArtistId: null,
    groupLinks: groups.map((g) => ({ group: { slug: g } })),
  };
}
// Top-level IP Artist inside the Love Live! series Group — the shape every
// LL IP (hasunosora, nijigasaki, aqours, …) AND the cross-IP AiScReam
// carry in the real catalog.
function llGroup(slug: string) {
  return topLevelGroup(slug, ["love-live"]);
}

// Headliner shape mirrors the resolver's select on Event.artist /
// EventSeries.artist: slug + groupLinks + a parentArtist chain.
type HeadlinerArtist = {
  slug: string;
  groupLinks: Array<{ group: { slug: string } }>;
  parentArtist: HeadlinerArtist | null;
};
function headliner(
  slug: string,
  opts: { groups?: string[]; parent?: HeadlinerArtist } = {},
): HeadlinerArtist {
  return {
    slug,
    groupLinks: (opts.groups ?? []).map((g) => ({ group: { slug: g } })),
    parentArtist: opts.parent ?? null,
  };
}
function mockEvent(event: {
  artist?: HeadlinerArtist | null;
  seriesArtist?: HeadlinerArtist | null;
}) {
  (
    prisma.eventImpression.findUnique as ReturnType<typeof vi.fn>
  ).mockResolvedValue({
    eventId: BigInt(100),
    event: {
      artist: event.artist ?? null,
      eventSeries:
        event.seriesArtist === undefined
          ? null
          : { artist: event.seriesArtist },
    },
  });
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

  it("falls back to generic + multiIp=true on partially-registered joint live (one registered + one not)", async () => {
    // Hasunosora × Aqours joint live where aqours has no authored prompt
    // yet. The resolver MUST NOT silently pick the registered prompt —
    // doing so would apply the Hasunosora glossary to impressions about
    // the Aqours co-headliner. Honest answer is generic + multiIp.
    (
      prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      performer([topLevelGroup("hasunosora")]),
      performer([topLevelGroup("aqours")]),
    ]);

    const result = await resolvePromptForImpression("imp-1");

    expect(result.ipKey).toBe("generic");
    expect(result.prompt).toBe(FALLBACK_PROMPT);
    expect(result.multiIp).toBe(true);
    expect(result.ipSlugs.slice().sort()).toEqual(["aqours", "hasunosora"]);
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
  describe("headliner-first resolution", () => {
    it("uses the series headliner even when a cross-IP group (AiScReam) appears on the performer walk", async () => {
      // The real-data regression: セラス柳田リリエンフェルト links to both
      // hasunosora and AiScReam (a top-level group whose members come from
      // five IPs). The performer walk alone saw two top-level slugs and
      // classified every Ceras-era Hasunosora live as a joint live.
      mockEvent({
        seriesArtist: headliner("hasunosora", { groups: ["love-live"] }),
      });
      (
        prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue([
        performer([llGroup("hasunosora"), llGroup("aiscream")]),
        performer([llGroup("hasunosora")]),
      ]);

      const result = await resolvePromptForImpression("imp-1");

      expect(result.ipKey).toBe("hasunosora");
      expect(result.prompt).toBe(IP_PROMPTS["hasunosora"]);
      expect(result.multiIp).toBe(false);
      expect(result.unregisteredSlug).toBeNull();
      expect(result.ipSlugs).toEqual(["hasunosora"]);
      // A known headliner settles the IP — the performer walk is skipped.
      expect(prisma.eventPerformer.findMany).not.toHaveBeenCalled();
    });

    it("resolves a Nijigasaki live to nijigasaki despite Ayumu's AiScReam link", async () => {
      mockEvent({
        seriesArtist: headliner("nijigasaki", { groups: ["love-live"] }),
      });

      const result = await resolvePromptForImpression("imp-1");

      expect(result.ipKey).toBe("nijigasaki");
      expect(result.prompt).toBe(IP_PROMPTS["nijigasaki"]);
      expect(result.multiIp).toBe(false);
    });

    it("prefers Event.artist over EventSeries.artist", async () => {
      mockEvent({
        artist: headliner("nijigasaki", { groups: ["love-live"] }),
        seriesArtist: headliner("hasunosora", { groups: ["love-live"] }),
      });

      const result = await resolvePromptForImpression("imp-1");

      expect(result.ipKey).toBe("nijigasaki");
    });

    it("walks a sub-unit headliner (Mira-Cra Park!) up to its top-level IP", async () => {
      mockEvent({
        seriesArtist: headliner("mira-cra-park", {
          parent: headliner("hasunosora", { groups: ["love-live"] }),
        }),
      });

      const result = await resolvePromptForImpression("imp-1");

      expect(result.ipKey).toBe("hasunosora");
      expect(result.ipSlugs).toEqual(["hasunosora"]);
    });

    it("gives an unregistered Love Live! IP headliner the franchise prompt, still flagging unregisteredSlug", async () => {
      // Aqours has no dedicated prompt yet, but its glossary lives in the
      // Love Live! franchise prompt — strictly better than generic.
      mockEvent({
        seriesArtist: headliner("aqours", { groups: ["love-live"] }),
      });

      const result = await resolvePromptForImpression("imp-1");

      expect(result.ipKey).toBe("love-live");
      expect(result.prompt).toBe(FRANCHISE_PROMPTS["love-live"]);
      expect(result.multiIp).toBe(false);
      expect(result.unregisteredSlug).toBe("aqours");
      expect(result.ipSlugs).toEqual(["aqours"]);
    });

    it("falls back to generic for an unregistered headliner outside any registered franchise", async () => {
      mockEvent({ seriesArtist: headliner("umamusume-pretty-derby") });

      const result = await resolvePromptForImpression("imp-1");

      expect(result.ipKey).toBe("generic");
      expect(result.prompt).toBe(FALLBACK_PROMPT);
      expect(result.unregisteredSlug).toBe("umamusume-pretty-derby");
      expect(prisma.eventPerformer.findMany).not.toHaveBeenCalled();
    });
  });

  describe("no headliner (multi-artist festival)", () => {
    it("uses the Love Live! franchise prompt when every IP on the walk shares the love-live Group", async () => {
      // ラブライブ！シリーズ 15th fes: EventSeries.artistId is null,
      // organizerName carries the display label.
      mockEvent({ seriesArtist: null });
      (
        prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue([
        performer([llGroup("hasunosora"), llGroup("aiscream")]),
        performer([llGroup("nijigasaki")]),
        performer([llGroup("aqours")]),
        performer([llGroup("muse")]),
        performer([llGroup("liella")]),
      ]);

      const result = await resolvePromptForImpression("imp-1");

      expect(result.ipKey).toBe("love-live");
      expect(result.prompt).toBe(FRANCHISE_PROMPTS["love-live"]);
      expect(result.multiIp).toBe(true);
      expect(result.unregisteredSlug).toBeNull();
      expect(result.ipSlugs.slice().sort()).toEqual([
        "aiscream",
        "aqours",
        "hasunosora",
        "liella",
        "muse",
        "nijigasaki",
      ]);
    });

    it("stays generic for a cross-franchise joint live (one IP outside love-live)", async () => {
      // 이차원 페스-style: Love Live! IPs alongside a non-LL IP. No single
      // franchise glossary covers everyone on stage.
      mockEvent({ seriesArtist: null });
      (
        prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue([
        performer([llGroup("hasunosora")]),
        performer([topLevelGroup("umamusume-pretty-derby")]),
      ]);

      const result = await resolvePromptForImpression("imp-1");

      expect(result.ipKey).toBe("generic");
      expect(result.prompt).toBe(FALLBACK_PROMPT);
      expect(result.multiIp).toBe(true);
    });

    it("still resolves a single registered IP from the performer walk when no headliner is set", async () => {
      mockEvent({ seriesArtist: null });
      (
        prisma.eventPerformer.findMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue([performer([llGroup("hasunosora")])]);

      const result = await resolvePromptForImpression("imp-1");

      expect(result.ipKey).toBe("hasunosora");
      expect(result.multiIp).toBe(false);
    });
  });
});

describe("FRANCHISE_PROMPTS['love-live']", () => {
  const prompt = FRANCHISE_PROMPTS["love-live"] ?? "";

  it("embeds the registered IP glossaries verbatim so edits there flow through", () => {
    for (const marker of [
      "セラス柳田リリエンフェルト",
      "スリーズブーケ",
      "上原歩夢",
      "QU4RTZ",
    ]) {
      expect(prompt).toContain(marker);
    }
  });

  it("covers the other Love Live! IPs that appear at series festivals", () => {
    for (const marker of [
      "高海千歌",
      "Guilty Kiss",
      "高坂穂乃果",
      "Printemps",
      "澁谷かのん",
      "唐可可",
      "AiScReam",
      "いきづらい部",
      "Saint Snow",
    ]) {
      expect(prompt).toContain(marker);
    }
  });

  it("keeps a single system-prompt frame: one header, one rules section, JSON-array format clause last", () => {
    expect(prompt.match(/당신은 OpenSetlist의 전문 번역가입니다/g)).toHaveLength(1);
    expect(prompt.match(/### \[2\. 번역 규칙\]/g)).toHaveLength(1);
    expect(prompt.trimEnd().endsWith("로만 응답.")).toBe(true);
  });
});
