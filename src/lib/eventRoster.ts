import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { CACHE_TTL, cachedQuery, eventTag } from "@/lib/dataCache";
import { FALLBACK_LOCALE } from "@/i18n/routing";
import type { EventRosterEntry } from "@/lib/types/setlist";

// Event roster with each stage identity's artist memberships — the
// input for the pre-show lineup (`deriveLineupFromRoster`) and the
// JSON-LD `performer` groups. Kept OUT of the wide `fetchEvent` read on
// purpose: that query is `relationJoins`-aggregated, so nesting
// `artistLinks.artist` (+ translations) under every performer there
// would inline each artist once per member link on every event fetch,
// including the uncached live path. A separate narrow, cached read
// costs one extra round-trip per TTL instead.
//
// Order: stage-identity creation order (= seed order, i.e. canonical
// member order), id as the deterministic tiebreak. `artistLinks` by
// artist id so a member's home group (created before later collab
// groups) is listed first — only a tiebreak; the lineup picks the home
// group by roster headcount.
export async function fetchEventRoster(
  id: bigint,
  locale: string,
): Promise<EventRosterEntry[]> {
  const localeFilter = { locale: { in: [locale, FALLBACK_LOCALE] } };
  const translationSelect = {
    where: localeFilter,
    select: { locale: true, name: true, shortName: true },
  } as const;
  const rows = await prisma.eventPerformer.findMany({
    where: { eventId: id },
    orderBy: [
      { stageIdentity: { createdAt: "asc" } },
      { stageIdentityId: "asc" },
    ],
    select: {
      isGuest: true,
      stageIdentity: {
        select: {
          id: true,
          slug: true,
          originalName: true,
          originalShortName: true,
          originalLanguage: true,
          translations: translationSelect,
          artistLinks: {
            orderBy: { artistId: "asc" },
            select: {
              artist: {
                select: {
                  id: true,
                  slug: true,
                  type: true,
                  color: true,
                  parentArtistId: true,
                  isMainUnit: true,
                  isDeleted: true,
                  originalName: true,
                  originalShortName: true,
                  originalLanguage: true,
                  translations: translationSelect,
                },
              },
            },
          },
        },
      },
    },
  });
  // serializeBigInt keeps the input's TS types while turning BigInt ids
  // into numbers at runtime; `EventRosterEntry` describes the runtime
  // (number) shape — same boundary cast as `LiveSetlistItem` below.
  return serializeBigInt(rows) as unknown as EventRosterEntry[];
}

// Operators fill the roster well before a show and don't touch it
// during one, so even the live path takes the cached copy.
export const getEventRoster = cachedQuery(
  "event-roster",
  (id: bigint, locale: string) => fetchEventRoster(id, locale),
  { revalidate: CACHE_TTL.event, tags: (id) => [eventTag(id)] },
);
