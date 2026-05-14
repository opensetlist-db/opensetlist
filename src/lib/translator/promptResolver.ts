import { prisma } from "@/lib/prisma";
import { IP_PROMPTS, FALLBACK_PROMPT } from "./prompts";

export type ResolvedPrompt = {
  prompt: string;
  ipKey: string; // a registered IP slug, or "generic"
  // Observability metadata, surfaced as Sentry tags / extras at the route's
  // call site. Not part of the cache key — these describe *why* the
  // resolver landed where it did, not the resolution input itself.
  multiIp: boolean;
  unregisteredSlug: string | null;
  franchiseSlugs: string[]; // distinct franchise-Group slugs found on the walk
};

// Resolve which system prompt the translator should send for a given
// impression. Walks:
//   EventImpression.eventId
//     → EventPerformer (eventId, stageIdentityId, isGuest)
//       → StageIdentity.artistLinks → Artist
//         → Artist.groupLinks (ArtistGroup) → Group(slug, type)
// Then filters the distinct slug set to type=franchise Groups in JS, and
// applies these rules (see task-multi-ip-translation-context.md §"The
// selection contract"):
//   - 1 distinct slug + registered → IP_PROMPTS[slug], ipKey=slug
//   - 1 distinct slug + unregistered → FALLBACK_PROMPT, ipKey="generic",
//       unregisteredSlug=<the slug> (signal for operator: this IP shipped
//       events without an onboarded prompt)
//   - ≥2 distinct slugs → FALLBACK_PROMPT, ipKey="generic", multiIp=true,
//       franchiseSlugs=<all> (signal for future per-event composite override)
//   - 0 distinct slugs → FALLBACK_PROMPT, ipKey="generic" (genre-neutral)
//
// `isGuest` is NOT filtered — guest VAs from foreign rosters count toward
// the franchise set, matching how the glossary substrate handles them in
// src/lib/glossary.ts:226.
//
// Cache: bounded module-scope Map<impressionId, …> with 1h TTL.
// Impression → IP only changes when the event's performer list changes
// (rare; not a real-time concern). Pattern is similar to
// src/lib/glossary.ts:157-168 but with a hard size cap — that cache
// keys by artistId (small fixed set across the catalog) while this one
// keys by impressionId (unbounded over time, one per fan post), so an
// unbounded Map would leak memory in a long-running Node process.
//
// When `MAX_ENTRIES` is reached on insert, we first sweep expired
// entries; if the cache is still full, the oldest insertion-order
// entry is evicted (Map preserves insertion order, so the first key
// from `cache.keys()` is the oldest). Eviction policy is approximate
// LRU — good enough for the 1h-TTL granularity we care about.
const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 10_000;
const cache = new Map<string, { resolvedAt: number; data: ResolvedPrompt }>();

function recordInCache(impressionId: string, data: ResolvedPrompt): void {
  if (cache.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now - entry.resolvedAt >= TTL_MS) cache.delete(key);
    }
    while (cache.size >= MAX_ENTRIES) {
      // Map iteration order is insertion order — the first key is the
      // oldest. Drop one and re-check (the `while` handles the rare
      // case where MAX_ENTRIES is reached after the sweep above).
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  cache.set(impressionId, { resolvedAt: Date.now(), data });
}

export async function resolvePromptForImpression(
  impressionId: string,
): Promise<ResolvedPrompt> {
  const hit = cache.get(impressionId);
  if (hit && Date.now() - hit.resolvedAt < TTL_MS) return hit.data;

  const impression = await prisma.eventImpression.findUnique({
    where: { id: impressionId },
    select: { eventId: true },
  });
  if (!impression) {
    const resolved = makeGeneric([]);
    recordInCache(impressionId, resolved);
    return resolved;
  }

  // One query fans the joins out. Select shape kept narrow — we only need
  // the franchise slugs, not entity translations or any other field.
  const performers = await prisma.eventPerformer.findMany({
    where: { eventId: impression.eventId },
    select: {
      stageIdentity: {
        select: {
          artistLinks: {
            select: {
              artist: {
                select: {
                  groupLinks: {
                    select: {
                      group: { select: { slug: true, type: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const franchiseSlugs = new Set<string>();
  for (const performer of performers) {
    for (const artistLink of performer.stageIdentity.artistLinks) {
      for (const groupLink of artistLink.artist.groupLinks) {
        if (groupLink.group.type === "franchise") {
          franchiseSlugs.add(groupLink.group.slug);
        }
      }
    }
  }

  const slugList = Array.from(franchiseSlugs);
  let resolved: ResolvedPrompt;

  if (slugList.length === 1) {
    const slug = slugList[0];
    const registered = IP_PROMPTS[slug];
    if (registered) {
      resolved = {
        prompt: registered,
        ipKey: slug,
        multiIp: false,
        unregisteredSlug: null,
        franchiseSlugs: slugList,
      };
    } else {
      resolved = {
        prompt: FALLBACK_PROMPT,
        ipKey: "generic",
        multiIp: false,
        unregisteredSlug: slug,
        franchiseSlugs: slugList,
      };
    }
  } else {
    // 0 or ≥2 franchise slugs → generic. makeGeneric sets multiIp based
    // on count, so both cases collapse into one branch.
    resolved = makeGeneric(slugList);
  }

  cache.set(impressionId, { resolvedAt: Date.now(), data: resolved });
  return resolved;
}

function makeGeneric(slugs: string[]): ResolvedPrompt {
  return {
    prompt: FALLBACK_PROMPT,
    ipKey: "generic",
    multiIp: slugs.length > 1,
    unregisteredSlug: null,
    franchiseSlugs: slugs,
  };
}

// Test-only escape hatch — clears the module cache between test runs so
// each test starts from a known empty state. Mirror of
// _resetGlossaryCacheForTests at src/lib/glossary.ts:172. Not exported
// through any public path.
export function _resetPromptResolverCacheForTests(): void {
  cache.clear();
}
