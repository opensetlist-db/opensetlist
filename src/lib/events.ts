import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { displayNameWithFallback, resolveLocalizedField } from "@/lib/display";
import { getEventStatus } from "@/lib/eventStatus";
import { SONG_COUNT_WHERE } from "@/lib/setlistCounts";
import {
  LOGO_EVENT_SELECT,
  resolveEventLogo,
  type PublicLogo,
} from "@/lib/logoResolution";
import { getLogoSeriesGraph } from "@/lib/logoSeriesGraph";
import type { EventSeriesType } from "@/generated/prisma/enums";

type SeriesTranslation = {
  locale: string;
  name: string;
  shortName: string | null;
};

type SeriesAncestor = {
  id: number;
  parentSeriesId: number | null;
  type: EventSeriesType;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  translations: SeriesTranslation[];
  artist: {
    originalName: string | null;
    originalShortName: string | null;
    originalLanguage: string;
    translations: {
      locale: string;
      name: string;
      shortName: string | null;
    }[];
  } | null;
};

type ArtistForGroup = {
  id: number;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  translations: {
    locale: string;
    name: string;
    shortName: string | null;
  }[];
};

type EventTranslation = {
  locale: string;
  name: string;
  shortName: string | null;
  city: string | null;
  venue: string | null;
  organizerName: string | null;
};

export type EventForList = {
  id: number;
  // DB slug — the canonical URL segment (`eventHref`). Never derive a
  // slug from the display name; see `src/lib/seo/entityUrl.ts`.
  slug: string;
  eventSeriesId: number | null;
  // Primary artist for series-less events. Populated explicitly via the
  // admin form, or backfilled by prisma/post-deploy.sql when the
  // performer roster resolves to exactly one top-level artist.
  // Ignored when eventSeriesId is set (series grouping wins).
  artistId: number | null;
  // Display name for multi-artist standalone events. Only consulted
  // when eventSeriesId AND artistId are both null. Original-language
  // value — the group KEY is derived from it (stable across locales);
  // the group TITLE resolves through `translations[].organizerName`.
  organizerName: string | null;
  status: "scheduled" | "ongoing" | "completed" | "cancelled";
  date: string | null;
  startTime: string;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  originalCity: string | null;
  originalVenue: string | null;
  translations: EventTranslation[];
  // Relational count of the event's setlist items. Cheap at launch
  // catalog scale (~60 events). Used by the events list page to render
  // "🎵 N" on completed events; profile before introducing a denormal
  // `Event.setlistItemCount` field.
  _count: { setlistItems: number };
  /**
   * Resolved public logo (07's `resolveEventLogo`): the managed image,
   * if the event or a series up its chain has one, plus the typography
   * tint colour. Computed server-side from the cached series graph; the
   * private asset/graph fields never ride along.
   */
  logo: PublicLogo;
  /**
   * Short text for the card's typography art, locale-resolved: the
   * event's OWN series short name (a sub-series like "Day 1 leg" keeps
   * its own identity even though the group header shows the root),
   * then the standalone artist's short name, then the event's short
   * name. Null only when every layer is blank — the page falls back to
   * the event name.
   */
  artTitle: string | null;
};

export type EventsListGroup = {
  /**
   * What classifies this group:
   *   - "series"    — events share a (root) EventSeries
   *   - "artist"    — series-less events share an Event.artistId
   *                   (e.g. "Hasunosora 단독 공연" bucket)
   *   - "organizer" — series-less events share an Event.organizerName
   *                   (multi-artist standalone shows)
   *   - "ungrouped" — series-less, no artistId, no organizerName
   *                   (genuine catchall — empty in well-curated data)
   */
  kind: "series" | "artist" | "organizer" | "ungrouped";
  /**
   * Stable group key — used for React keys and pagination identifiers.
   * Encodes the kind so different kinds with the same identifier (rare
   * but possible, e.g. seriesId="7" vs artistId="7") never collide.
   */
  id: string;
  /**
   * Display title resolved for the requested locale:
   *   - kind=series    → root series's name (locale-resolved)
   *   - kind=artist    → artist's name (locale-resolved). The page wraps
   *                      this in a "{artist} — 단독 공연" template.
   *   - kind=organizer → organizerName, locale-resolved from the first
   *                      event's translation row (falls back to the
   *                      stored original-language value)
   *   - kind=ungrouped → null (page renders the locale "기타 이벤트")
   */
  title: string | null;
  /**
   * Resolved short name of the artist that owns this group, for the
   * requested locale. Drives the small artist pill at the start of
   * each series-header badge row. Null when:
   *   - kind=series and the series has no artistId (multi-artist
   *     festival series — pill is hidden)
   *   - kind=artist|organizer|ungrouped (the title itself already
   *     carries the artist/organizer identity; rendering a parallel
   *     pill would be redundant)
   *   - the fallback chain in `displayNameWithFallback` exhausts
   *     without finding a non-empty value
   */
  artistShortName: string | null;
  /**
   * The root series's DB `type`, for the header's "Tour / Festival"
   * tag. Display metadata only — it never feeds grouping, ordering or
   * filtering. Null for non-series groups (and a missing root).
   */
  seriesType: EventSeriesType | null;
  events: EventForList[];
  earliestStart: number;
  latestStart: number;
  /**
   * True when at least one event in the group resolves to "ongoing"
   * status. Drives the LIVE pill + always-expanded behavior on the
   * list's `ConcertGroup` header.
   */
  hasOngoing: boolean;
};

export type EventsListData = {
  /**
   * Groups with at least one active event (ongoing, upcoming, or a
   * future-dated cancelled show). All events of the group are kept
   * here so the user sees the full tour together — including
   * already-completed earlier days alongside today's ongoing show.
   */
  activeGroups: EventsListGroup[];
  /**
   * Groups whose events have all already happened (completed or
   * past-dated cancellations). Group sort: most recent tour first.
   */
  pastGroups: EventsListGroup[];
};

const MAX_SERIES_DEPTH = 32;

function getRootSeriesId(
  startId: number,
  ancestry: Map<number, SeriesAncestor>,
): number {
  let cur = startId;
  for (let i = 0; i < MAX_SERIES_DEPTH; i++) {
    const node = ancestry.get(cur);
    if (!node || node.parentSeriesId == null) return cur;
    cur = node.parentSeriesId;
  }
  return cur;
}

const UNGROUPED_KEY = "ungrouped";

/**
 * Group-key derivation for a single event. Precedence:
 *   1. eventSeriesId → series:{rootSeriesId}  (multi-day tour wins)
 *   2. artistId      → artist:{artistId}      (artist's standalone shows)
 *   3. organizerName → org:{normalized}       (multi-artist standalone)
 *   4. ungrouped catchall
 *
 * organizerName is normalized via trim — operator typos like
 * "Bandai Namco" vs " Bandai Namco " collapse to one bucket.
 * Empty/whitespace-only organizerName falls through to ungrouped.
 */
function groupKeyForEvent(
  ev: EventForList,
  ancestry: Map<number, SeriesAncestor>,
): { kind: EventsListGroup["kind"]; key: string; ref: string | null } {
  if (ev.eventSeriesId != null) {
    const rootId = getRootSeriesId(ev.eventSeriesId, ancestry);
    return { kind: "series", key: `series:${rootId}`, ref: String(rootId) };
  }
  if (ev.artistId != null) {
    return { kind: "artist", key: `artist:${ev.artistId}`, ref: String(ev.artistId) };
  }
  const org = ev.organizerName?.trim();
  if (org) {
    return { kind: "organizer", key: `org:${org}`, ref: org };
  }
  return { kind: "ungrouped", key: UNGROUPED_KEY, ref: null };
}

export async function getEventsListGrouped(
  locale: string,
  referenceNow: Date,
): Promise<EventsListData> {
  const [eventsRaw, seriesRaw, logoGraph] = await Promise.all([
    prisma.event.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        slug: true,
        // eventSeriesId comes with LOGO_EVENT_SELECT below.
        artistId: true,
        organizerName: true,
        status: true,
        date: true,
        startTime: true,
        originalName: true,
        originalShortName: true,
        originalLanguage: true,
        originalCity: true,
        originalVenue: true,
        translations: {
          select: {
            locale: true,
            name: true,
            shortName: true,
            city: true,
            venue: true,
            organizerName: true,
          },
        },
        // See `src/lib/setlistCounts.ts` for what `SONG_COUNT_WHERE`
        // includes / excludes and why. Without a filter, `_count`
        // returns every row, so the events-list "🎵 N" badge would
        // disagree with the event-detail header on the same event.
        _count: { select: { setlistItems: { where: SONG_COUNT_WHERE } } },
        // Logo inputs for 07's resolver (event mode/asset + the event
        // artist's colour). Resolved below while ids are still bigint,
        // then dropped — only the public projection leaves this module.
        ...LOGO_EVENT_SELECT,
      },
      orderBy: { startTime: "asc" },
    }),
    prisma.eventSeries.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        parentSeriesId: true,
        type: true,
        originalName: true,
        originalShortName: true,
        originalLanguage: true,
        translations: {
          select: { locale: true, name: true, shortName: true },
        },
        // The artist pill in each series header reads the locale-resolved
        // shortName. `artistId` is nullable for multi-artist festivals —
        // the relation falls through to null and the pill is hidden.
        artist: {
          select: {
            originalName: true,
            originalShortName: true,
            originalLanguage: true,
            translations: {
              select: { locale: true, name: true, shortName: true },
            },
          },
        },
      },
    }),
    // Cached (PUBLIC_DATA_TAG) whole-series graph — every logo writer
    // calls revalidatePublicData(), so this uncached page picks up a
    // logo change on the next request without its own tag.
    getLogoSeriesGraph(),
  ]);

  const seriesList = serializeBigInt(seriesRaw) as unknown as SeriesAncestor[];
  const ancestry = new Map(seriesList.map((s) => [s.id, s]));
  const events: EventForList[] = eventsRaw.map((raw) => {
    const ev = serializeBigInt(raw) as unknown as EventForList &
      Partial<Record<"logoMode" | "logoAsset" | "artist", unknown>>;
    // Resolver inputs stay server-internal: only `logo` is public.
    delete ev.logoMode;
    delete ev.logoAsset;
    delete ev.artist;
    ev.logo = resolveEventLogo(raw, logoGraph);
    ev.artTitle = null;
    return ev;
  });

  // Second-pass fetch: artists referenced by series-less events. Done
  // after the events query so we know which artistIds to look up
  // (typically a small set — Hasunosora, Nijigasaki, ... — even at
  // scale). A separate query keeps the main `findMany` lean and lets
  // us skip the join entirely when no event uses Event.artistId yet.
  const standaloneArtistIds = new Set<string>();
  for (const ev of events) {
    if (ev.eventSeriesId == null && ev.artistId != null) {
      standaloneArtistIds.add(String(ev.artistId));
    }
  }
  const artistMap = new Map<string, ArtistForGroup>();
  if (standaloneArtistIds.size > 0) {
    const artistsRaw = await prisma.artist.findMany({
      where: {
        id: { in: Array.from(standaloneArtistIds).map((id) => BigInt(id)) },
      },
      select: {
        id: true,
        originalName: true,
        originalShortName: true,
        originalLanguage: true,
        translations: {
          select: { locale: true, name: true, shortName: true },
        },
      },
    });
    for (const a of serializeBigInt(artistsRaw) as unknown as ArtistForGroup[]) {
      artistMap.set(String(a.id), a);
    }
  }

  // Typography-art text (see `EventForList.artTitle`). The artist layer
  // only applies to series-less events — exactly the ones whose artists
  // were fetched above; a series event with no usable series names
  // falls through to its own short name.
  for (const ev of events) {
    const ownSeries =
      ev.eventSeriesId != null ? ancestry.get(ev.eventSeriesId) : undefined;
    const standaloneArtist =
      ev.eventSeriesId == null && ev.artistId != null
        ? artistMap.get(String(ev.artistId))
        : undefined;
    ev.artTitle =
      (ownSeries &&
        displayNameWithFallback(ownSeries, ownSeries.translations, locale, "short")) ||
      (standaloneArtist &&
        displayNameWithFallback(
          standaloneArtist,
          standaloneArtist.translations,
          locale,
          "short",
        )) ||
      displayNameWithFallback(ev, ev.translations, locale, "short") ||
      null;
  }

  // Group all events by their derived key. The mockup shows
  // mixed-status events from the same tour together — a user looking
  // at "Hasunosora 6th Live" wants to see today's ongoing show next
  // to yesterday's completed Day.1 and tomorrow's upcoming Day.2, all
  // in chronological order. Same intuition for the per-artist
  // "단독 공연" bucket: a user looking at "하스노소라 단독 공연"
  // wants the full chronology in one place.
  const groupsMap = new Map<string, EventsListGroup>();

  for (const ev of events) {
    const { kind, key, ref } = groupKeyForEvent(ev, ancestry);
    const existing = groupsMap.get(key);
    if (existing) {
      existing.events.push(ev);
      continue;
    }

    let title: string | null = null;
    let artistShortName: string | null = null;
    let seriesType: EventSeriesType | null = null;

    if (kind === "series" && ref != null) {
      const root = ancestry.get(Number(ref));
      seriesType = root?.type ?? null;
      title = root
        ? displayNameWithFallback(root, root.translations, locale) || null
        : null;
      // Coerce empty-string returns from displayNameWithFallback to null
      // so consuming components can branch on a single nullish check.
      // The fallback chain (locale shortName → locale name →
      // originalShortName → originalName → "") only yields "" when
      // every layer is missing.
      artistShortName = root?.artist
        ? displayNameWithFallback(
            root.artist,
            root.artist.translations,
            locale,
            "short",
          ) || null
        : null;
    } else if (kind === "artist" && ref != null) {
      const a = artistMap.get(ref);
      title = a ? displayNameWithFallback(a, a.translations, locale) || null : null;
      // No parallel pill for artist groups — the title is the artist.
    } else if (kind === "organizer" && ref != null) {
      // Key stays on the original-language value so the bucket is the
      // same in every locale; only the label is localized. Taken from
      // the group's first event — events sharing an organizer share its
      // translations in well-curated data, and a missing locale row
      // falls back to the trimmed original (`ref`).
      title =
        resolveLocalizedField(
          ev,
          ev.translations,
          locale,
          "organizerName",
          "organizerName",
        )?.trim() || ref;
    }

    groupsMap.set(key, {
      kind,
      id: key,
      title,
      artistShortName,
      seriesType,
      events: [ev],
      earliestStart: 0,
      latestStart: 0,
      hasOngoing: false,
    });
  }

  const activeGroups: EventsListGroup[] = [];
  const pastGroups: EventsListGroup[] = [];
  const nowMs = referenceNow.getTime();

  for (const g of groupsMap.values()) {
    // Parse each startTime once. Sort + earliest/latest + the
    // cancelled-future check all reuse the cached numeric value.
    const dated = g.events.map((ev) => ({
      ev,
      ts: new Date(ev.startTime).getTime(),
    }));
    dated.sort((a, b) => a.ts - b.ts);
    g.events = dated.map((d) => d.ev);
    g.earliestStart = dated[0]?.ts ?? 0;
    g.latestStart = dated[dated.length - 1]?.ts ?? 0;

    let hasOngoing = false;
    let hasActive = false;
    for (const { ev, ts } of dated) {
      const resolved = getEventStatus(ev, referenceNow);
      if (resolved === "ongoing") {
        hasOngoing = true;
        hasActive = true;
      } else if (resolved === "upcoming") {
        hasActive = true;
      } else if (resolved === "cancelled") {
        // A cancelled-but-future show stays "active" so it appears in
        // the upcoming-aware section with its cancelled badge, matching
        // the per-event routing the previous helper used.
        if (ts >= nowMs) hasActive = true;
      }
    }
    g.hasOngoing = hasOngoing;

    if (hasActive) activeGroups.push(g);
    else pastGroups.push(g);
  }

  activeGroups.sort((a, b) => a.earliestStart - b.earliestStart);
  pastGroups.sort((a, b) => b.latestStart - a.latestStart);

  return { activeGroups, pastGroups };
}
