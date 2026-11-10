import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { byStageIdentityOrderBy } from "@/lib/memberOrder";
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
// Preserve the source order for prediction/board consumers and home-group ties.
export function eventRosterSelect(locale?: string) {
  const translationSelect = {
    ...(locale ? { where: { locale: { in: [locale, FALLBACK_LOCALE] } } } : {}),
    select: { locale: true, name: true, shortName: true },
  } as const;
  return {
    isGuest: true,
    stageIdentity: {
      select: {
        id: true,
        slug: true,
        sortOrder: true,
        createdAt: true,
        originalName: true,
        originalShortName: true,
        originalLanguage: true,
        translations: translationSelect,
        artistLinks: {
          orderBy: { artistId: "asc" },
          select: {
            sortOrder: true,
            artist: {
              select: {
                id: true,
                slug: true,
                type: true,
                sortOrder: true,
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
  } as const;
}

export function serializeEventRoster(rows: Prisma.EventPerformerGetPayload<{ select: ReturnType<typeof eventRosterSelect> }>[]): EventRosterEntry[] {
  // serializeBigInt keeps the input's TS types while turning BigInt ids
  // into numbers at runtime; `EventRosterEntry` describes the runtime
  // (number) shape — the same boundary cast the event page applies to
  // `LiveSetlistItem`.
  return serializeBigInt(rows.map((row) => ({ ...row, stageIdentity: {
    ...row.stageIdentity,
    artistLinks: row.stageIdentity.artistLinks.map((link) => ({ ...link, artist: {
      ...link.artist, orderId: String(link.artist.id), orderParentId: link.artist.parentArtistId?.toString() ?? null,
    } })),
  } }))) as unknown as EventRosterEntry[];
}

export async function fetchEventRoster(id: bigint, locale: string): Promise<EventRosterEntry[]> {
  const rows = await prisma.eventPerformer.findMany({
    where: { eventId: id },
    orderBy: byStageIdentityOrderBy(),
    select: eventRosterSelect(locale),
  });
  return serializeEventRoster(rows);
}

// Operators fill the roster well before a show and don't touch it
// during one, so even the live path takes the cached copy.
export const getEventRoster = cachedQuery(
  "event-roster",
  (id: bigint, locale: string) => fetchEventRoster(id, locale),
  { revalidate: CACHE_TTL.event, tags: (id) => [eventTag(id)] },
);
