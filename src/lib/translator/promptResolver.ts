import { prisma } from "@/lib/prisma";
import { IP_PROMPTS, FRANCHISE_PROMPTS, FALLBACK_PROMPT } from "./prompts";
import { GENERIC_IP_KEY } from "./prompts/keys";

export type ResolvedPrompt = {
  prompt: string;
  // A registered IP slug (IP_PROMPTS), a registered franchise Group slug
  // (FRANCHISE_PROMPTS, e.g. "love-live"), or "generic".
  ipKey: string;
  // Observability metadata, surfaced as Sentry tags / extras at the route's
  // call site. Not part of the cache key — these describe *why* the
  // resolver landed where it did, not the resolution input itself.
  multiIp: boolean;
  unregisteredSlug: string | null;
  ipSlugs: string[]; // distinct top-level IP Artist slugs the decision was based on
};

// Resolve which system prompt the translator should send for a given
// impression. Two sources, in order:
//
// 1. HEADLINER — Event.artist ?? EventSeries.artist, walked up the
//    parentArtist chain to its top-level Artist (Mira-Cra Park! →
//    hasunosora). This is the operator-curated "whose show is this"
//    answer and it settles the IP on its own; the performer walk is
//    skipped.
//      - root slug in IP_PROMPTS          → that prompt
//      - else root in a registered franchise Group (ArtistGroup →
//        FRANCHISE_PROMPTS) → franchise prompt, unregisteredSlug=<root>
//      - else                            → generic, unregisteredSlug=<root>
//
// 2. PERFORMER WALK — only when neither the event nor its series has a
//    headliner (multi-artist festivals: ラブライブ！シリーズ 15th fes,
//    이차원 페스). Walks
//      EventPerformer → StageIdentity.artistLinks → Artist
//    and keeps top-level group Artists (type=group AND parentArtistId IS
//    NULL). Then:
//      - 1 slug                       → same rules as a headliner
//      - ≥2 slugs, all sharing one registered franchise Group
//                                     → franchise prompt, multiIp=true
//      - ≥2 slugs otherwise           → generic, multiIp=true
//      - 0 slugs                      → generic
//
// Why the headliner wins over the performer walk: StageIdentity →
// top-level Artist is many-to-many, and cross-IP groups exist. AiScReam
// is a top-level group Artist whose members are 黒澤ルビィ (Aqours),
// 上原歩夢 (Nijigasaki), 若菜四季 (Liella!), セラス (Hasunosora) and
// 麻布麻衣 (いきづらい部！); GKSS mixes Aqours and Saint Snow. On the
// performer walk alone, every Hasunosora live Ceras appears in and every
// Nijigasaki live (Ayumu is on all of them) picked up a second top-level
// slug and was misread as a joint live → generic prompt, IP glossary
// lost. The structural data can't tell "a cross-IP side project" from "a
// separate IP" (both are top-level group Artists in the same love-live
// series Group), but the headliner field says outright whose show it is.
//
// Trade-off accepted: a guest from another IP at a headlined show gets
// the host IP's prompt. Impressions overwhelmingly talk about the host,
// and the old behaviour (whole show → generic because of one guest) was
// strictly worse.
//
// Why franchise prompts for unregistered single IPs too: the Love Live!
// prompt carries Aqours / μ's / Liella! glossaries that no per-IP prompt
// does yet, so an Aqours live is better served by it than by generic.
// unregisteredSlug stays set so the operator still sees "this IP has no
// dedicated prompt" in Sentry.
//
// Why Artist slug rather than Group slug for IP keys: in this catalog,
// the top-level Artist (Hasunosora, Nijigasaki, μ's, …) IS the IP — its
// slug is the natural identifier operators reason about when authoring a
// prompt. Group entities (series=`love-live`) are the franchise layer
// above IPs and key FRANCHISE_PROMPTS instead.
//
// `isGuest` is NOT filtered on the performer walk — guest VAs from foreign
// rosters count toward the IP slug set, matching how the glossary
// substrate handles them in src/lib/glossary.ts:226.
//
// Cache: bounded module-scope Map<impressionId, …> with 1h TTL.
// Impression → IP only changes when the event's headliner or performer
// list changes
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

// Artist select for the headliner: slug + franchise Group links, plus the
// parentArtist chain three levels up. The catalog's deepest real chain is
// solo/unit → top-level group (two levels); the third is headroom. If an
// Artist ever sits deeper, `rootOf` stops at the deepest fetched level and
// the result surfaces as an unregisteredSlug rather than a wrong prompt.
const GROUP_LINKS_SELECT = {
  select: { group: { select: { slug: true } } },
} as const;
const HEADLINER_SELECT = {
  select: {
    slug: true,
    groupLinks: GROUP_LINKS_SELECT,
    parentArtist: {
      select: {
        slug: true,
        groupLinks: GROUP_LINKS_SELECT,
        parentArtist: {
          select: {
            slug: true,
            groupLinks: GROUP_LINKS_SELECT,
            parentArtist: {
              select: { slug: true, groupLinks: GROUP_LINKS_SELECT },
            },
          },
        },
      },
    },
  },
} as const;

type IpArtist = {
  slug: string;
  groupLinks: Array<{ group: { slug: string } }>;
};
type HeadlinerArtist = IpArtist & {
  parentArtist?: HeadlinerArtist | null;
};

function rootOf(artist: HeadlinerArtist): IpArtist {
  let current = artist;
  while (current.parentArtist) current = current.parentArtist;
  return current;
}

// The registered franchise key every one of `artists` belongs to, if any.
// For a single Artist that's simply its first registered franchise Group;
// for a joint live it's a franchise shared by all IPs on stage.
function sharedFranchiseKey(artists: IpArtist[]): string | null {
  if (artists.length === 0) return null;
  for (const link of artists[0].groupLinks) {
    const key = link.group.slug;
    if (FRANCHISE_PROMPTS[key] === undefined) continue;
    if (artists.every((a) => a.groupLinks.some((l) => l.group.slug === key))) {
      return key;
    }
  }
  return null;
}

// One IP (from the headliner or a single-slug performer walk) → prompt.
function resolveSingleIp(artist: IpArtist): ResolvedPrompt {
  const slug = artist.slug;
  const registered = IP_PROMPTS[slug];
  if (registered) {
    return {
      prompt: registered,
      ipKey: slug,
      multiIp: false,
      unregisteredSlug: null,
      ipSlugs: [slug],
    };
  }
  const franchise = sharedFranchiseKey([artist]);
  return {
    prompt: franchise ? FRANCHISE_PROMPTS[franchise]! : FALLBACK_PROMPT,
    ipKey: franchise ?? GENERIC_IP_KEY,
    multiIp: false,
    unregisteredSlug: slug,
    ipSlugs: [slug],
  };
}

export async function resolvePromptForImpression(
  impressionId: string,
): Promise<ResolvedPrompt> {
  const hit = cache.get(impressionId);
  if (hit && Date.now() - hit.resolvedAt < TTL_MS) return hit.data;

  const impression = await prisma.eventImpression.findUnique({
    where: { id: impressionId },
    select: {
      eventId: true,
      event: {
        select: {
          artist: HEADLINER_SELECT,
          eventSeries: { select: { artist: HEADLINER_SELECT } },
        },
      },
    },
  });
  if (!impression) {
    const resolved = makeGeneric([]);
    recordInCache(impressionId, resolved);
    return resolved;
  }

  // Event.artistId is documented as mirroring EventSeries.artistId, but in
  // practice series events often leave it null and only the series
  // carries the headliner — so fall through to the series.
  const headliner: HeadlinerArtist | null | undefined =
    impression.event?.artist ?? impression.event?.eventSeries?.artist;
  if (headliner) {
    const resolved = resolveSingleIp(rootOf(headliner));
    recordInCache(impressionId, resolved);
    return resolved;
  }

  // No headliner → multi-artist event. One query fans the joins out;
  // select shape kept narrow to what the top-level filter and the
  // franchise check need.
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
                  groupLinks: GROUP_LINKS_SELECT,
                },
              },
            },
          },
        },
      },
    },
  });

  // Collect top-level group Artists (type=group AND no parent) — the IP
  // identities. Sub-units (type=unit) and solo character Artists are
  // skipped. Multiple performers from the same IP collapse via the Map.
  const ipArtists = new Map<string, IpArtist>();
  for (const performer of performers) {
    for (const artistLink of performer.stageIdentity.artistLinks) {
      const a = artistLink.artist;
      if (a.type === "group" && a.parentArtistId === null) {
        ipArtists.set(a.slug, { slug: a.slug, groupLinks: a.groupLinks ?? [] });
      }
    }
  }

  const artists = Array.from(ipArtists.values());
  let resolved: ResolvedPrompt;

  if (artists.length === 1) {
    resolved = resolveSingleIp(artists[0]);
  } else if (artists.length >= 2) {
    // Joint live. A shared registered franchise (every IP on stage is a
    // Love Live! IP) gets that franchise's composite prompt. Otherwise
    // generic: picking one registered IP prompt would silently apply the
    // wrong glossary to impressions about the other co-headliners.
    const franchise = sharedFranchiseKey(artists);
    const slugs = artists.map((a) => a.slug);
    resolved = franchise
      ? {
          prompt: FRANCHISE_PROMPTS[franchise]!,
          ipKey: franchise,
          multiIp: true,
          unregisteredSlug: null,
          ipSlugs: slugs,
        }
      : makeGeneric(slugs);
  } else {
    resolved = makeGeneric([]);
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
