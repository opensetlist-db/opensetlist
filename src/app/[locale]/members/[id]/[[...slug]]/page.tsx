import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import {
  serializeBigInt,
  formatDate,
  HISTORY_ROW_DATE_FORMAT,
} from "@/lib/utils";
import {
  displayNameWithFallback,
  displayOriginalName,
  displayOriginalTitle,
  resolveOriginalShortLabel,
} from "@/lib/display";
import { getEventStatus, type ResolvedEventStatus } from "@/lib/eventStatus";
import { Breadcrumb, type BreadcrumbItem } from "@/components/Breadcrumb";
import { TabBar } from "@/components/TabBar";
import { SectionLabel } from "@/components/SectionLabel";
import { StatsSubLabel } from "@/components/StatsSubLabel";
import { InitialAvatar } from "@/components/InitialAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import { CountCell } from "@/components/CountCell";
import {
  PerformanceGroup,
  type PerformanceSeries,
  type PerformanceEvent,
} from "@/components/PerformanceGroup";
// Layout primitives import directly from the server-safe module —
// NOT from `PerformanceGroup.tsx` (which carries `"use client"`).
// See `src/components/performance-row-layout.ts` header for the
// boundary-corruption rationale.
import {
  PERFORMANCE_ROW_GRID,
  PERFORMANCE_ROW_INDENT_PX,
  PERFORMANCE_ROW_GAP_PX,
  STATUS_BADGE_INDENT_PX,
  STATUS_COL_IDX,
  TRAILING_COL_IDX,
} from "@/components/performance-row-layout";
import { colors, radius, shadows } from "@/styles/tokens";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};

const TABS = ["overview", "songs", "history"] as const;
type TabKey = (typeof TABS)[number];

function resolveTab(value: string | string[] | undefined): TabKey {
  const v = Array.isArray(value) ? value[0] : value;
  return TABS.includes(v as TabKey) ? (v as TabKey) : "overview";
}

async function getMember(id: string) {
  // StageIdentity has no `isDeleted` column (per schema.prisma:277-293) —
  // the model is a soft reference target; deletes happen at the parent
  // (Artist) level. So a plain findFirst by id is the right call.
  const member = await prisma.stageIdentity.findFirst({
    where: { id },
    include: {
      translations: true,
      // Affiliations: every (current + past) unit/solo this stage identity
      // is linked to. Used for the unit badge in the hero, the per-event
      // trailing cell, and (eventually) a graduated-vs-current split.
      // We pull `parentArtist` so the breadcrumb can include the group.
      artistLinks: {
        include: {
          artist: {
            include: {
              translations: true,
              parentArtist: { include: { translations: true } },
            },
          },
        },
        orderBy: { startDate: "asc" },
      },
      // Voice actors (anime/game characters); a character can have
      // multiple VAs over time (recasts). `endDate: null` is the active
      // VA. Sort newest first so the active row is index 0 when present.
      voicedBy: {
        include: { realPerson: { include: { translations: true } } },
        orderBy: { startDate: "desc" },
      },
      // Specific song-level appearances (drives the songs tab + the
      // per-event "did the member sing specific songs" check). Each
      // SetlistItemMember row points at one setlist item; an event with
      // many member songs has many rows here for the same event.
      performances: {
        include: {
          setlistItem: {
            include: {
              event: {
                include: {
                  translations: true,
                  eventSeries: { include: { translations: true } },
                },
              },
              // SongArtist included so the songs-tab row can resolve a
              // unit chip color/name from the song's primary artist.
              songs: {
                include: {
                  song: {
                    include: {
                      translations: true,
                      artists: {
                        include: {
                          artist: { include: { translations: true } },
                        },
                      },
                    },
                  },
                },
              },
              // SetlistItemArtist on the row itself — drives the
              // history-tab trailing chip's per-event unit label.
              // Without this, the chip falls back to the member's
              // CURRENT primary unit name even when the member
              // performed under a different unit on that specific
              // event (e.g. a member who moved between sub-units, or
              // appeared in a one-time configuration).
              //
              // `orderBy: artistId asc` pins a deterministic row
              // order so the consumer's `.find((a) => a.artist.type
              // === "unit")` (line ~473) returns the same chip label
              // across requests when a setlist item carries multiple
              // unit credits (e.g. a collab between two sub-units).
              // Without an explicit ORDER BY, Postgres is free to
              // return rows in any order and the trailing chip could
              // flip between renders. ascending by `artistId` is
              // arbitrary but stable — the SetlistItemArtist row has
              // no operator-curated order column.
              artists: {
                include: {
                  artist: { include: { translations: true } },
                },
                orderBy: { artistId: "asc" },
              },
            },
          },
        },
      },
      // Event-level "this member was on stage" rows. A full-group default
      // appearance leaves no SetlistItemMember row but DOES leave an
      // EventPerformer row (per schema.prisma:475-488 — `isGuest: false`
      // means counted in the full-group fallback). We use the diff
      // between this set and `performances` to flag 전출연 events.
      eventPerformers: {
        include: {
          event: {
            include: {
              translations: true,
              eventSeries: { include: { translations: true } },
            },
          },
        },
      },
    },
  });
  if (!member) return null;
  return serializeBigInt(member);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const member = await getMember(id);
  if (!member) return { title: "Not Found" };
  const memberT = await getTranslations({ locale, namespace: "Member" });
  const fullName =
    displayNameWithFallback(member, member.translations, locale, "full") ||
    memberT("unknown");

  const title = `${fullName} | OpenSetlist`;
  const mt = await getTranslations({ locale, namespace: "Meta" });
  const description = `${fullName} ${mt("performanceHistory")}`;
  const pageUrl = `/${locale}/members/${id}/${member.slug}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: "OpenSetlist",
      locale,
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
      site: "@opensetlistdb",
    },
  };
}

export default async function MemberPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const activeTab = resolveTab(sp.tab);

  const member = await getMember(id);
  if (!member) notFound();

  const [t, ct, evT, at] = await Promise.all([
    getTranslations("Member"),
    getTranslations("Common"),
    getTranslations("Event"),
    getTranslations("Artist"),
  ]);

  // Reference instant pinned at the top of the request so every event
  // status downstream resolves against the same `now` (per CLAUDE.md
  // UTC-only rule + matches the artist-page pattern).
  const referenceNow = new Date();

  // `displayOriginalName` is now translation-primary at the helper
  // level (since the refactor on `src/lib/display.ts`) — `main`
  // holds the viewer's locale translation, `sub` holds the original-
  // language name (or null when locale matches origin / no
  // translation row exists). So the page renders `main` as the h1
  // and `sub` as the secondary line, no call-site swap needed.
  // The avatar still wants the original-language first character to
  // match the mockup (canonical script regardless of viewer locale)
  // — `sub` is that string when present, otherwise `main` (which
  // already IS the original when there's no translation to flip).
  const { main: characterPrimary, sub: characterSecondary } =
    displayOriginalName(member, member.translations, locale);
  const characterOriginal = characterSecondary ?? characterPrimary;
  // Avatar initial sources the *original-language short name* first
  // (e.g. 瑠 for 瑠璃乃 rather than 大 for 大沢瑠璃乃) so the round
  // chip reads as the character's curated handle, not the surname-
  // first first-character of a Japanese-style full name. The
  // resolution chain (parent shortName → original-language
  // translation shortName → full original → "?") lives in
  // `resolveOriginalShortLabel` so the order is testable and a future
  // canonical-script avatar surface can reuse it without re-inlining.
  const characterAvatarLabel = resolveOriginalShortLabel(
    member,
    member.translations,
    characterOriginal,
  );

  // Color resolution. `member.color` is the personal color; falls back
  // to the muted text token when null so the gradient still has shape
  // (matches how <InitialAvatar> handles missing color internally).
  const memberColor = member.color ?? colors.textMuted;

  // Pick the active unit for chrome (hero badge, song-row chips, full-
  // group fallback). Active = `endDate: null`; ties broken by most
  // recent `startDate`. Sub-artist `type === "unit"` only — solos
  // appear in artistLinks too but are not "units" in the chip sense.
  type ArtistLink = (typeof member.artistLinks)[number];
  const unitLinks: ArtistLink[] = member.artistLinks.filter(
    (l) => l.artist.type === "unit",
  );
  const primaryUnit: ArtistLink | null = (() => {
    const active = unitLinks.filter((l) => l.endDate === null);
    if (active.length > 0) {
      // Most recent start wins. Compare ISO date strings safely (string
      // ordering matches chronological for `YYYY-MM-DD`).
      return [...active].sort((a, b) => {
        const sa = a.startDate ? String(a.startDate) : "";
        const sb = b.startDate ? String(b.startDate) : "";
        return sb.localeCompare(sa);
      })[0];
    }
    if (unitLinks.length > 0) {
      return [...unitLinks].sort((a, b) => {
        const sa = a.endDate ? String(a.endDate) : "";
        const sb = b.endDate ? String(b.endDate) : "";
        return sb.localeCompare(sa);
      })[0];
    }
    return null;
  })();
  const primaryUnitName = primaryUnit
    ? displayNameWithFallback(
        primaryUnit.artist,
        primaryUnit.artist.translations,
        locale,
      )
    : null;
  const unitColor = primaryUnit?.artist.color ?? memberColor;

  // Parent artist (group) for the breadcrumb. Pick from primaryUnit's
  // parent first (most relevant), else any artistLink with a
  // parentArtist. This is the entity whose detail page sits between
  // "Home" and the member name in the breadcrumb trail.
  type Parent = NonNullable<ArtistLink["artist"]["parentArtist"]>;
  const parentArtist: Parent | null = (() => {
    if (primaryUnit?.artist.parentArtist) {
      return primaryUnit.artist.parentArtist;
    }
    for (const link of member.artistLinks) {
      if (link.artist.parentArtist) return link.artist.parentArtist;
    }
    return null;
  })();
  // Breadcrumb crumbs always render the short variant — the page
  // header already shows the full member name, so the crumb staying
  // compact keeps the ribbon tidy.
  const parentName = parentArtist
    ? displayNameWithFallback(
        parentArtist,
        parentArtist.translations,
        locale,
        "short",
      )
    : null;
  const breadcrumbLeafName =
    displayNameWithFallback(member, member.translations, locale, "short") ||
    t("unknown");

  // Voice actor (active first, else most recent ended). `voicedBy`
  // is already sorted desc by startDate in the query.
  const currentVa =
    member.voicedBy.find((v) => v.endDate === null) ?? member.voicedBy[0];
  // VA name follows the same translation-primary rule as the
  // character name. Helper now returns `main` = locale translation
  // and `sub` = original; consume directly.
  const vaDisplay = currentVa
    ? displayOriginalName(
        currentVa.realPerson,
        currentVa.realPerson.translations,
        locale,
      )
    : null;
  const vaPrimary = vaDisplay?.main ?? null;
  const vaSecondary = vaDisplay?.sub ?? null;
  // Original-language string for the VA avatar initial; same
  // `sub ?? main` rule the character avatar above uses. Note: the VA
  // intentionally keeps the *full* original-language first character
  // even though the character avatar (above) prefers the short-name
  // first character — operator preference. A real-person VA name is
  // typically rendered in full anyway (e.g. 楡井希実 → 楡), and the
  // surname's first character is the canonical reading; switching to
  // a short-name initial would yield the given-name's first character,
  // which is too informal a handle for a credited performer's chip.
  const vaOriginal = vaDisplay ? (vaDisplay.sub ?? vaDisplay.main) : null;
  // Activity period: full range when ended, just the start date when
  // still active (per user feedback — no `~ 현재` / `~ Present` suffix
  // when the VA is currently active, since the trailing label adds
  // visual noise without conveying new information).
  const vaPeriod = currentVa
    ? currentVa.endDate
      ? `${formatDate(currentVa.startDate, locale)} ~ ${formatDate(currentVa.endDate, locale)}`
      : formatDate(currentVa.startDate, locale)
    : null;

  // Pre-translated status labels passed to <PerformanceGroup>; the
  // component itself stays out of next-intl.
  // Ongoing badge uses the marketing "LIVE" label (matching the home,
  // event list, series, and song detail surfaces).
  const statusLabels: Record<ResolvedEventStatus, string> = {
    ongoing: evT("live"),
    upcoming: evT("status.upcoming"),
    completed: evT("status.completed"),
    cancelled: evT("status.cancelled"),
  };

  // ─── Event view-model ────────────────────────────────────────────
  // Walk `performances` first (events where the member sang specific
  // songs). For each event we keep one row keyed by event.id — multiple
  // SetlistItemMember rows in the same event collapse into a single
  // EventView.
  type EventInfo = {
    seriesId: number;
    seriesShort: string;
    /** Standalone variant of `seriesShort`: null when event has no
     *  series (so the recent-events block can show series subtitle
     *  only when it differs from the event name). */
    seriesNameOrNull: string | null;
    rawDateMs: number;
    formattedDate: string;
    name: string;
    status: ResolvedEventStatus;
    href: string;
  };
  type EventView = PerformanceEvent & {
    seriesId: number;
    /** Pre-resolved series translated name. Used by the recent-events
     *  subtitle (overview tab) — null for standalone events so the
     *  subtitle line is suppressed. The history-tab grouping reads
     *  `seriesShort` (which falls back to event name) instead. */
    seriesName: string | null;
    rawDateMs: number;
    isFullGroup: boolean;
  };

  const buildInfo = (
    event: (typeof member.performances)[number]["setlistItem"]["event"],
  ): EventInfo => {
    const seriesNameOrNull = event.eventSeries
      ? displayNameWithFallback(
          event.eventSeries,
          event.eventSeries.translations,
          locale,
        ) || null
      : null;
    const seriesShort =
      seriesNameOrNull ??
      displayNameWithFallback(event, event.translations, locale) ??
      evT("unknownEvent");
    return {
      seriesId: event.eventSeries ? Number(event.eventSeries.id) : 0,
      seriesShort,
      seriesNameOrNull,
      // serializeBigInt's JSON.stringify converts Date columns to ISO
      // strings — runtime is `string` even though the type still says
      // Date. Wrap in String() before parseing.
      rawDateMs: new Date(String(event.date)).getTime(),
      formattedDate: formatDate(event.date, locale, HISTORY_ROW_DATE_FORMAT),
      name:
        displayNameWithFallback(event, event.translations, locale) ||
        evT("unknownEvent"),
      status: getEventStatus(
        { status: event.status, startTime: event.startTime },
        referenceNow,
      ),
      href: `/${locale}/events/${event.id}/${event.slug}`,
    };
  };

  // Trailing cell for a member-page event row: 전출연 pill (full-group
  // default) or unit-name pill (specific song-level appearance).
  // Pre-built per event because PerformanceGroup is a client component
  // and React refuses to serialize a function prop across the RSC
  // boundary; ReactNode trees serialize fine, so the JSX lives here.
  //
  // Per-event unit resolution: when the row is a specific song-level
  // appearance (`isFullGroup=false`), the caller passes
  // `perEventUnitName` derived from THIS setlist item's
  // SetlistItemArtist credit. Without it, the chip would fall back
  // to `primaryUnitName` (the member's CURRENT primary unit) for
  // every event — wrong for members who moved between sub-units or
  // appeared in one-time configurations. `primaryUnitName` is still
  // the last-resort fallback when the setlist item has no unit
  // credit at all.
  const buildTrailing = (
    isFullGroup: boolean,
    perEventUnitName?: string | null,
  ): React.ReactNode => {
    const labelText = isFullGroup
      ? t("fullGroupBadge")
      : (perEventUnitName ?? primaryUnitName ?? "");
    if (!labelText) return null;
    return (
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          flexShrink: 0,
          color: isFullGroup ? unitColor : colors.textMuted,
          background: isFullGroup
            ? `${unitColor}1f` // ~12% alpha; matches mockup hex+15
            : colors.bgSubtle,
          border: isFullGroup ? `1px solid ${unitColor}33` : "none",
          borderRadius: radius.chip,
          padding: "1px 6px",
        }}
      >
        {labelText}
      </span>
    );
  };

  const eventViewsById = new Map<number, EventView>();
  for (const perf of member.performances) {
    const event = perf.setlistItem.event;
    const eid = Number(event.id);
    if (!eventViewsById.has(eid)) {
      // Resolve the per-event unit chip label from THIS setlist item's
      // SetlistItemArtist credit (first unit-type artist; other types
      // skipped — solo/group don't fit a "unit" chip). First-seen
      // performance wins when the member sang multiple unit-stage
      // songs at the same event; that matches the existing "first
      // performance per event" iteration order. Falls back to
      // `primaryUnitName` inside `buildTrailing` when the setlist
      // item has no unit credit (e.g. solo song with no unit
      // attribution).
      const itemUnit = perf.setlistItem.artists.find(
        (a) => a.artist.type === "unit",
      )?.artist;
      const perEventUnitName = itemUnit
        ? displayNameWithFallback(itemUnit, itemUnit.translations, locale)
        : null;
      const info = buildInfo(event);
      eventViewsById.set(eid, {
        id: String(event.id),
        seriesId: info.seriesId,
        seriesName: info.seriesNameOrNull,
        rawDateMs: info.rawDateMs,
        formattedDate: info.formattedDate,
        name: info.name,
        status: info.status,
        href: info.href,
        // Default `false` — the member sang specific songs, so this is
        // not a full-group default appearance. Flipped below if the
        // EventPerformer-only check overrides it (it doesn't, but the
        // explicit default makes the rule readable).
        isFullGroup: false,
        trailing: buildTrailing(false, perEventUnitName),
      });
    }
  }

  // Add events where the member only appears as an EventPerformer
  // (full-group default). These are events where the member was on
  // stage but didn't have any specific song slot — the trailing cell
  // shows 전출연 instead of a unit name.
  for (const ep of member.eventPerformers) {
    if (ep.isGuest) continue; // guest appearances ≠ full-group default
    const eid = Number(ep.event.id);
    if (eventViewsById.has(eid)) continue;
    const info = buildInfo(ep.event);
    eventViewsById.set(eid, {
      id: String(ep.event.id),
      seriesId: info.seriesId,
      seriesName: info.seriesNameOrNull,
      rawDateMs: info.rawDateMs,
      formattedDate: info.formattedDate,
      name: info.name,
      status: info.status,
      href: info.href,
      isFullGroup: true,
      trailing: buildTrailing(true),
    });
  }

  const totalEvents = eventViewsById.size;
  const totalCompleted = [...eventViewsById.values()].filter(
    (e) => e.status === "completed",
  ).length;

  // ─── Series-grouped views (history tab) ──────────────────────────
  // Group EventView[] by seriesId. Within a series sort by date desc;
  // sort series by ongoing-first then most-recent-event-date desc.
  // Mirrors the artist-page sort key pattern.
  type SeriesEntry = { id: number; short: string; events: EventView[] };
  const seriesMap = new Map<number, SeriesEntry>();
  for (const view of eventViewsById.values()) {
    let entry = seriesMap.get(view.seriesId);
    if (!entry) {
      entry = {
        id: view.seriesId,
        // First view's seriesShort wins — every event in a series
        // resolves to the same label, so collisions are no-ops.
        short: "",
        events: [],
      };
      seriesMap.set(view.seriesId, entry);
    }
    entry.events.push(view);
  }
  // Walk performances + eventPerformers once more for the series-short
  // label (eventViewsById doesn't carry it). Cheaper than threading
  // `seriesShort` through EventView for one render-time lookup.
  const seriesShortById = new Map<number, string>();
  for (const perf of member.performances) {
    const event = perf.setlistItem.event;
    const sid = event.eventSeries ? Number(event.eventSeries.id) : 0;
    if (!seriesShortById.has(sid)) {
      const label = event.eventSeries
        ? displayNameWithFallback(
            event.eventSeries,
            event.eventSeries.translations,
            locale,
          )
        : displayNameWithFallback(event, event.translations, locale);
      seriesShortById.set(sid, label || evT("unknownEvent"));
    }
  }
  for (const ep of member.eventPerformers) {
    if (ep.isGuest) continue;
    const sid = ep.event.eventSeries ? Number(ep.event.eventSeries.id) : 0;
    if (!seriesShortById.has(sid)) {
      const label = ep.event.eventSeries
        ? displayNameWithFallback(
            ep.event.eventSeries,
            ep.event.eventSeries.translations,
            locale,
          )
        : displayNameWithFallback(
            ep.event,
            ep.event.translations,
            locale,
          );
      seriesShortById.set(sid, label || evT("unknownEvent"));
    }
  }

  const seriesViews: PerformanceSeries[] = [...seriesMap.values()]
    .map((entry) => {
      const events = [...entry.events].sort(
        (a, b) => b.rawDateMs - a.rawDateMs,
      );
      const hasOngoing = events.some((e) => e.status === "ongoing");
      const mostRecentMs = events.reduce(
        (m, e) => (e.rawDateMs > m ? e.rawDateMs : m),
        0,
      );
      return {
        seriesId: String(entry.id),
        seriesShort: seriesShortById.get(entry.id) ?? evT("unknownEvent"),
        hasOngoing,
        events: events.map((e) => ({
          id: e.id,
          status: e.status,
          formattedDate: e.formattedDate,
          name: e.name,
          href: e.href,
        })),
        sortKey: hasOngoing ? Number.MAX_SAFE_INTEGER : mostRecentMs,
      };
    })
    .sort(
      (a, b) =>
        (b as { sortKey: number }).sortKey -
        (a as { sortKey: number }).sortKey,
    )
    .map((s) => ({
      seriesId: s.seriesId,
      seriesShort: s.seriesShort,
      hasOngoing: s.hasOngoing,
      events: s.events,
    }));

  // Recent-3 across all series for the overview tab. Carries
  // `seriesName` as a subtitle line below the event name (operator
  // feedback 2026-04-29 — the flat list lost the series context that
  // history-tab grouping conveys via group headers).
  type RecentEventRow = PerformanceEvent & { seriesName: string | null };
  const recentEvents: RecentEventRow[] = [...eventViewsById.values()]
    .sort((a, b) => b.rawDateMs - a.rawDateMs)
    .slice(0, 3)
    .map((e) => ({
      id: e.id,
      status: e.status,
      formattedDate: e.formattedDate,
      name: e.name,
      href: e.href,
      seriesName: e.seriesName,
    }));

  // ─── Songs aggregation ───────────────────────────────────────────
  // Walk performances → setlistItem.songs. Count occurrences per song.
  // Each SetlistItemMember row is "this character sang this song-row";
  // a medley with N songs counts as N appearances for that character
  // in that event, which matches the operator's intent ("8회 공연" =
  // 8 song-row appearances, not 8 distinct events).
  type SongView = {
    id: number;
    href: string;
    titleMain: string;
    titleSub: string | null;
    unitName: string | null;
    unitColor: string;
    timesPerformed: number;
  };
  const songMap = new Map<number, SongView>();
  for (const perf of member.performances) {
    for (const sis of perf.setlistItem.songs) {
      const song = sis.song;
      const sid = Number(song.id);
      let entry = songMap.get(sid);
      if (!entry) {
        const { main, sub } = displayOriginalTitle(
          song,
          song.translations,
          locale,
        );
        // Pick the song's primary artist for the unit chip. If primary
        // is a unit/solo with a color set, use its color + name; else
        // fall back to the member's primaryUnit so the chip still has
        // a readable label.
        const primaryArtist =
          song.artists.find((sa) => sa.role === "primary")?.artist ??
          song.artists[0]?.artist ??
          null;
        const chipName = primaryArtist
          ? displayNameWithFallback(
              primaryArtist,
              primaryArtist.translations,
              locale,
            ) || (primaryUnitName ?? "")
          : primaryUnitName;
        const chipColor = primaryArtist?.color ?? unitColor;
        entry = {
          id: sid,
          // `song.slug` is the canonical, already-stable slug from the
          // DB. Don't recompute via slugify(main) — that would diverge
          // for locales whose translated title slugifies differently
          // and produce a 404 round-trip via the slug-redirect handler.
          href: `/${locale}/songs/${sid}/${song.slug}`,
          titleMain: main || song.originalTitle,
          titleSub: sub,
          unitName: chipName,
          unitColor: chipColor,
          timesPerformed: 0,
        };
        songMap.set(sid, entry);
      }
      entry.timesPerformed += 1;
    }
  }
  const songsAll: SongView[] = [...songMap.values()].sort(
    (a, b) => b.timesPerformed - a.timesPerformed,
  );
  const songsTop3 = songsAll.slice(0, 3);
  const totalSongs = songsAll.length;

  const tabs = [
    { key: "overview", label: t("tabOverview") },
    { key: "songs", label: t("tabSongs", { count: totalSongs }) },
    { key: "history", label: t("tabHistory", { count: totalEvents }) },
  ];

  const heroGradient = `linear-gradient(135deg, ${memberColor}30 0%, ${memberColor}08 100%)`;

  return (
    <main style={{ minHeight: "100vh", background: colors.bgPage }}>
      <div className="mx-auto" style={{ maxWidth: 1100, padding: "0 16px" }}>
        <Breadcrumb
          ariaLabel={ct("breadcrumb")}
          items={[
            { label: ct("home"), href: `/${locale}` },
            ...(parentArtist && parentName
              ? [
                  {
                    label: parentName,
                    href: `/${locale}/artists/${parentArtist.id}/${parentArtist.slug}`,
                  } satisfies BreadcrumbItem,
                ]
              : []),
            { label: breadcrumbLeafName },
          ]}
        />

        <div
          className="grid lg:grid-cols-[280px_1fr] lg:gap-7"
          style={{ alignItems: "start", paddingBottom: 60 }}
        >
          {/* Sidebar — inline (NOT <InfoCard>) because the personal-color
              gradient hero diverges from the standard white wash. The
              <InfoCard>'s <ColorStripe> would be redundant here. */}
          <div
            className="lg:sticky lg:top-[72px]"
            style={{ marginBottom: 12 }}
          >
            <section
              style={{
                background: colors.bgCard,
                borderRadius: radius.card,
                boxShadow: shadows.card,
                overflow: "hidden",
              }}
            >
              {/* Personal-color hero block */}
              <div
                style={{
                  background: heroGradient,
                  padding: "28px 20px 20px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <InitialAvatar
                  // Original-language short name's first character —
                  // shows the curated handle's lead glyph (e.g. 瑠 for
                  // 瑠璃乃) instead of the full-name lead (which would
                  // surface a Japanese surname's first kanji). See
                  // `characterAvatarLabel` resolution above for the
                  // shortName → fullName fallback chain.
                  label={characterAvatarLabel}
                  color={memberColor}
                  size={72}
                />
                <h1
                  style={{
                    marginTop: 12,
                    marginBottom: characterSecondary ? 3 : 10,
                    fontSize: 18,
                    fontWeight: 700,
                    color: colors.textPrimary,
                    textAlign: "center",
                    lineHeight: 1.35,
                  }}
                >
                  {characterPrimary || t("unknown")}
                </h1>
                {characterSecondary && (
                  <div
                    style={{
                      marginBottom: 10,
                      fontSize: 12,
                      color: colors.textSubtle,
                      textAlign: "center",
                    }}
                  >
                    {characterSecondary}
                  </div>
                )}
                {primaryUnit && primaryUnitName && (
                  <Link
                    href={`/${locale}/artists/${primaryUnit.artist.id}/${primaryUnit.artist.slug}`}
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: unitColor,
                      background: `${unitColor}1f`,
                      border: `1px solid ${unitColor}40`,
                      borderRadius: radius.badge,
                      padding: "4px 12px",
                      textDecoration: "none",
                    }}
                  >
                    {primaryUnitName}
                  </Link>
                )}
              </div>

              {/* Body: voice actor + stats. (StageIdentityTranslation
                  has no description column today — when one is added,
                  render a `<p>` block here above the VA section.) */}
              <div style={{ padding: "16px 20px" }}>
                {currentVa && vaPrimary && (
                  <div style={{ marginBottom: 14 }}>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: colors.textMuted,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        marginBottom: 8,
                      }}
                    >
                      {t("voiceActor")}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <InitialAvatar
                        // Original-language full-name first character
                        // — intentionally distinct from the character
                        // avatar above (which uses the short name's
                        // first character). See `vaOriginal` for
                        // rationale.
                        label={vaOriginal || "?"}
                        color={memberColor}
                        size={36}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: colors.textPrimary,
                          }}
                        >
                          {vaPrimary}
                        </div>
                        {vaSecondary && (
                          <div
                            style={{
                              fontSize: 11,
                              color: colors.textMuted,
                            }}
                          >
                            {vaSecondary}
                          </div>
                        )}
                        {vaPeriod && (
                          <div
                            style={{
                              fontSize: 10,
                              color: colors.textMuted,
                              marginTop: 1,
                            }}
                          >
                            {vaPeriod}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Stats row */}
                <div
                  style={{
                    display: "flex",
                    borderTop: currentVa
                      ? `1px solid ${colors.borderLight}`
                      : "none",
                    paddingTop: currentVa ? 14 : 0,
                  }}
                >
                  {[
                    { label: t("statsTotalEvents"), value: totalEvents },
                    { label: t("statsCompleted"), value: totalCompleted },
                    { label: t("statsSongs"), value: totalSongs },
                  ].map((stat, i) => (
                    <div
                      key={stat.label}
                      style={{
                        flex: 1,
                        textAlign: "center",
                        borderRight:
                          i < 2 ? `1px solid ${colors.borderLight}` : "none",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 18,
                          fontWeight: 700,
                          color: colors.textPrimary,
                        }}
                      >
                        {stat.value}
                      </div>
                      <StatsSubLabel>{stat.label}</StatsSubLabel>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          {/* Main content */}
          <div>
            <TabBar
              tabs={tabs}
              active={activeTab}
              ariaLabel={ct("tabsAriaLabel")}
            />

            {activeTab === "overview" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
                {/* Top songs preview */}
                <section
                  style={{
                    background: colors.bgCard,
                    borderRadius: radius.card,
                    overflow: "hidden",
                    boxShadow: shadows.card,
                  }}
                >
                  <div
                    style={{
                      padding: "16px 20px 12px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      borderBottom: `1px solid ${colors.borderLight}`,
                    }}
                  >
                    <SectionLabel noBorder style={{ marginBottom: 0 }}>
                      {t("topSongs")}
                    </SectionLabel>
                    {totalSongs > songsTop3.length && (
                      <Link
                        href={`/${locale}/members/${id}/${member.slug}?tab=songs`}
                        style={{
                          fontSize: 12,
                          color: colors.primary,
                          fontWeight: 600,
                          textDecoration: "none",
                        }}
                      >
                        {t("viewAll")}
                      </Link>
                    )}
                  </div>
                  {songsTop3.length === 0 ? (
                    <p
                      style={{
                        padding: "32px 16px",
                        fontSize: 14,
                        color: colors.textMuted,
                        textAlign: "center",
                      }}
                    >
                      {t("noSongs")}
                    </p>
                  ) : (
                    songsTop3.map((song, i) => (
                      <SongRow
                        key={song.id}
                        song={song}
                        isLast={i === songsTop3.length - 1}
                        countUnit={t("songCountUnit", {
                          count: song.timesPerformed,
                        })}
                      />
                    ))
                  )}
                </section>

                {/* Recent events */}
                <section
                  style={{
                    background: colors.bgCard,
                    borderRadius: radius.card,
                    overflow: "hidden",
                    boxShadow: shadows.card,
                  }}
                >
                  <div
                    style={{
                      padding: "16px 20px 12px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      borderBottom: `1px solid ${colors.borderLight}`,
                    }}
                  >
                    <SectionLabel noBorder style={{ marginBottom: 0 }}>
                      {t("recentEvents")}
                    </SectionLabel>
                    {totalEvents > recentEvents.length && (
                      <Link
                        href={`/${locale}/members/${id}/${member.slug}?tab=history`}
                        style={{
                          fontSize: 12,
                          color: colors.primary,
                          fontWeight: 600,
                          textDecoration: "none",
                        }}
                      >
                        {t("viewAll")}
                      </Link>
                    )}
                  </div>
                  {recentEvents.length === 0 ? (
                    <p
                      style={{
                        padding: "32px 16px",
                        fontSize: 14,
                        color: colors.textMuted,
                        textAlign: "center",
                      }}
                    >
                      {t("noEvents")}
                    </p>
                  ) : (
                    recentEvents.map((event, i) => (
                      <Link
                        key={event.id}
                        href={event.href}
                        className="row-hover-bg"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 20px",
                          borderBottom:
                            i < recentEvents.length - 1
                              ? `1px solid ${colors.borderFaint}`
                              : "none",
                          textDecoration: "none",
                          color: "inherit",
                        }}
                      >
                        <StatusBadge
                          status={event.status}
                          size="sm"
                          label={statusLabels[event.status]}
                        />
                        <span
                          style={{
                            fontSize: 12,
                            color: colors.textMuted,
                            // 100px to fit `HISTORY_ROW_DATE_FORMAT`
                            // year-included strings ("2026년 4월 25일")
                            // — matches the artist page recent-events
                            // and PerformanceGroup history rows.
                            width: 100,
                            flexShrink: 0,
                          }}
                        >
                          {event.formattedDate}
                        </span>
                        <div
                          style={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            flexDirection: "column",
                            gap: 1,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: colors.primary,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {event.name}
                          </span>
                          {event.seriesName && (
                            <span
                              style={{
                                fontSize: 11,
                                color: colors.textMuted,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {event.seriesName}
                            </span>
                          )}
                        </div>
                        <span
                          aria-hidden="true"
                          style={{
                            fontSize: 13,
                            color: colors.borderSubtle,
                          }}
                        >
                          ›
                        </span>
                      </Link>
                    ))
                  )}
                </section>
              </div>
            )}

            {activeTab === "songs" && (
              <section
                style={{
                  background: colors.bgCard,
                  borderRadius: radius.card,
                  overflow: "hidden",
                  boxShadow: shadows.card,
                }}
              >
                <div
                  style={{
                    padding: "16px 20px 12px",
                    borderBottom: `1px solid ${colors.borderLight}`,
                  }}
                >
                  <SectionLabel>
                    {t("songsHeader", { count: totalSongs })}
                  </SectionLabel>
                </div>
                {songsAll.length === 0 ? (
                  <p
                    style={{
                      padding: "32px 16px",
                      fontSize: 14,
                      color: colors.textMuted,
                      textAlign: "center",
                    }}
                  >
                    {t("noSongs")}
                  </p>
                ) : (
                  songsAll.map((song, i) => (
                    <SongRow
                      key={song.id}
                      song={song}
                      isLast={i === songsAll.length - 1}
                      countUnit={t("songCountUnit", {
                        count: song.timesPerformed,
                      })}
                    />
                  ))
                )}
              </section>
            )}

            {activeTab === "history" && (
              <div
                style={{
                  background: colors.bgCard,
                  borderRadius: radius.card,
                  overflow: "hidden",
                  boxShadow: shadows.card,
                }}
              >
                <div
                  style={{
                    padding: "16px 20px 12px",
                    borderBottom: `1px solid ${colors.borderLight}`,
                  }}
                >
                  <SectionLabel>
                    {t("historyHeader", { count: totalEvents })}
                  </SectionLabel>
                </div>
                {seriesViews.length === 0 ? (
                  <p
                    style={{
                      padding: "32px 16px",
                      fontSize: 14,
                      color: colors.textMuted,
                      textAlign: "center",
                    }}
                  >
                    {t("noEvents")}
                  </p>
                ) : (
                  <>
                    {/* Desktop-only column-header strip — same grid
                        template as the rows below so headers line up
                        with row tracks. Mirrors the artist + song
                        detail history tabs (operator feedback
                        2026-04-29: "member page history has no column
                        title, which is inconsistent with artist
                        history"). Hidden on mobile via `hidden lg:grid`
                        — mobile rows carry no column header. */}
                    <div
                      className="hidden lg:grid"
                      style={{
                        gridTemplateColumns: PERFORMANCE_ROW_GRID,
                        gap: PERFORMANCE_ROW_GAP_PX,
                        padding: `8px 16px 8px ${PERFORMANCE_ROW_INDENT_PX}px`,
                        background: colors.bgFaint,
                        borderBottom: `1px solid ${colors.border}`,
                      }}
                    >
                      {[
                        evT("tableHeader.status"),
                        evT("tableHeader.date"),
                        evT("tableHeader.name"),
                        // Trailing column on member page shows either
                        // a 전출연 pill or a unit-name pill — no clean
                        // single label captures both. Leave empty;
                        // reads as a "chip column" by visual context
                        // alone (artist + song history use a real
                        // label because their column has stable
                        // semantics — `🎵 N` and #position).
                        "",
                        "",
                      ].map((label, i) => (
                        <span
                          key={i}
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: colors.textMuted,
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                            // Anchor trailing column with row chips
                            // (right-aligned), and pad STATUS by the
                            // badge's internal padding so the header
                            // text aligns with the badge text. See
                            // performance-row-layout.ts for the
                            // detailed rationale.
                            textAlign:
                              i === TRAILING_COL_IDX ? "right" : "left",
                            paddingLeft:
                              i === STATUS_COL_IDX ? STATUS_BADGE_INDENT_PX : 0,
                          }}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                    {seriesViews.map((sv) => (
                      <PerformanceGroup
                        key={sv.seriesId}
                        series={sv}
                        statusLabels={statusLabels}
                        eventCountLabel={at("eventCount", {
                          count: sv.events.length,
                        })}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

interface SongRowProps {
  song: {
    id: number;
    href: string;
    titleMain: string;
    titleSub: string | null;
    unitName: string | null;
    unitColor: string;
    timesPerformed: number;
  };
  isLast: boolean;
  /** Unit-only label (e.g. "회 공연" / "performances") — the count
   *  goes in the bare-number slot of `<CountCell>`. Don't pass an
   *  already-formatted "{count}회 공연" string here; that double-
   *  rendered the number prior to 2026-04-29. */
  countUnit: string;
}

function SongRow({ song, isLast, countUnit }: SongRowProps) {
  return (
    <Link
      href={song.href}
      className="row-hover-bg"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 20px",
        borderBottom: isLast ? "none" : `1px solid ${colors.borderFaint}`,
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: colors.primary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {song.titleMain}
          </span>
          {song.titleSub && (
            <span
              style={{
                fontSize: 11,
                color: colors.textMuted,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {song.titleSub}
            </span>
          )}
        </div>
        {song.unitName && (
          <span
            style={{
              fontSize: 11,
              color: song.unitColor,
              background: `${song.unitColor}1f`,
              borderRadius: radius.chip,
              padding: "1px 7px",
              fontWeight: 600,
              display: "inline-block",
              marginTop: 3,
            }}
          >
            {song.unitName}
          </span>
        )}
      </div>
      <div style={{ marginRight: 4 }}>
        <CountCell count={song.timesPerformed} unit={countUnit} />
      </div>
      <span
        aria-hidden="true"
        style={{ fontSize: 13, color: colors.borderSubtle }}
      >
        ›
      </span>
    </Link>
  );
}
