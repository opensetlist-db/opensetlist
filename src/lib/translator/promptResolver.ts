import { prisma } from "@/lib/prisma";
import { IP_PROMPTS, FALLBACK_PROMPT } from "./prompts";
import { GENERIC_IP_KEY } from "./prompts/keys";

export type ResolvedPrompt = {
  prompt: string;
  ipKey: string; // a registered IP slug, or "generic"
  // Observability metadata, surfaced as Sentry tags / extras at the route's
  // call site. Not part of the cache key — these describe *why* the
  // resolver landed where it did, not the resolution input itself.
  multiIp: boolean;
  unregisteredSlug: string | null;
  ipSlugs: string[]; // distinct top-level-group Artist slugs found on the walk
};

// Resolve which system prompt the translator should send for a given
// impression. Walks:
//   EventImpression.eventId
//     → EventPerformer (eventId, stageIdentityId, isGuest)
//       → StageIdentity.artistLinks → Artist
// Then filters Artist rows down to top-level group Artists (type=group AND
// parentArtistId IS NULL — i.e. Hasunosora itself, not its Cerise Bouquet
// sub-unit, and not the solo Artists representing individual characters).
// Each such top-level slug is a candidate IP key. Selection rules:
//   - 1 distinct slug + registered → IP_PROMPTS[slug], ipKey=slug
//   - 1 distinct slug + unregistered → FALLBACK_PROMPT, ipKey="generic",
//       unregisteredSlug=<the slug> (signal for operator: this IP shipped
//       events without an onboarded prompt)
//   - ≥2 distinct slugs → FALLBACK_PROMPT, ipKey="generic", multiIp=true,
//       ipSlugs=<all> (signal for future per-event composite override)
//   - 0 distinct slugs → FALLBACK_PROMPT, ipKey="generic" (genre-neutral)
//
// Why Artist slug rather than Group slug: in this catalog, the top-level
// Artist (Hasunosora, Nijigasaki, μ's, …) IS the IP — its slug is the
// natural identifier operators reason about when authoring a prompt. The
// Group entities (franchise=`lovelive`, series=`hasunosora-club`) are
// administrative/canon groupings whose slugs leak naming-convention
// artifacts (the `-club` suffix) that don't belong in IP_PROMPTS keys.
//
// `isGuest` is NOT filtered — guest VAs from foreign rosters count toward
// the IP slug set, matching how the glossary substrate handles them in
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
  // Only sweep/evict when inserting a NEW key. Refreshing an existing
  // entry's data field replaces it in place (insertion order is
  // preserved by Map.set on an existing key for our purposes), so it
  // can't push the cache past MAX_ENTRIES — running eviction in that
  // case would needlessly drop unrelated hot entries.
  const isNewKey = !cache.has(impressionId);
  if (isNewKey && cache.size >= MAX_ENTRIES) {
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
  // the top-level Artist slug, type, and parentArtistId for filtering.
  const performers = await prisma.eventPerformer.findMany({
    where: { eventId: impression.eventId },
    select: {
      stageIdentity: {
        select: {
          artistLinks: {
            select: {
              artist: {
                select: {
                  slug: true,
                  type: true,
                  parentArtistId: true,
                },
              },
            },
          },
        },
      },
    },
  });

  // Collect top-level group Artists (type=group AND no parent) — these are
  // the IP identities (Hasunosora, Nijigasaki, μ's, …). Sub-units like
  // Cerise Bouquet (type=unit, parent=hasunosora) and solo artists
  // (type=solo) are skipped — they appear on the same event's performers
  // but don't introduce a new IP. Multiple character performers from the
  // same IP collapse to one slug via the Set.
  const ipSlugSet = new Set<string>();
  for (const performer of performers) {
    for (const artistLink of performer.stageIdentity.artistLinks) {
      const a = artistLink.artist;
      if (a.type === "group" && a.parentArtistId === null) {
        ipSlugSet.add(a.slug);
      }
    }
  }

  const slugList = Array.from(ipSlugSet);
  // Registered-first selection: filter the candidate slugs to those that
  // have an entry in IP_PROMPTS. In practice each event's performers
  // resolve to exactly one top-level group Artist (the IP itself), so the
  // registered/unregistered split here mostly distinguishes
  // "we authored a prompt for this IP" from "we haven't yet".
  const registeredSlugs = slugList.filter((s) => IP_PROMPTS[s] !== undefined);
  let resolved: ResolvedPrompt;

  if (registeredSlugs.length === 1) {
    const slug = registeredSlugs[0];
    resolved = {
      prompt: IP_PROMPTS[slug]!,
      ipKey: slug,
      multiIp: false,
      unregisteredSlug: null,
      ipSlugs: slugList,
    };
  } else if (registeredSlugs.length >= 2) {
    // Joint live across ≥2 registered IPs. The per-event composite
    // override (Event.translationPromptKey) is deferred — fall back to
    // generic and surface the multiIp flag for observability.
    resolved = makeGeneric(slugList);
    resolved.multiIp = true;
  } else if (slugList.length === 1) {
    // Exactly one IP slug came back from the walk and it isn't in
    // IP_PROMPTS — signal which one so the operator can decide whether
    // to onboard a prompt for it.
    resolved = {
      prompt: FALLBACK_PROMPT,
      ipKey: GENERIC_IP_KEY,
      multiIp: false,
      unregisteredSlug: slugList[0],
      ipSlugs: slugList,
    };
  } else {
    // 0 slugs OR ≥2 slugs but none registered — generic. makeGeneric sets
    // multiIp based on count.
    resolved = makeGeneric(slugList);
  }

  recordInCache(impressionId, resolved);
  return resolved;
}

function makeGeneric(slugs: string[]): ResolvedPrompt {
  return {
    prompt: FALLBACK_PROMPT,
    ipKey: GENERIC_IP_KEY,
    multiIp: slugs.length > 1,
    unregisteredSlug: null,
    ipSlugs: slugs,
  };
}

// Test-only escape hatch — clears the module cache between test runs so
// each test starts from a known empty state. Mirror of
// _resetGlossaryCacheForTests at src/lib/glossary.ts:172. Not exported
// through any public path.
export function _resetPromptResolverCacheForTests(): void {
  cache.clear();
}
