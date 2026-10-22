import { cache } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { Metadata } from "next";
import {
  entityAlternates,
  entityPath,
  enforceCanonicalSlug,
} from "@/lib/seo/entityUrl";
import { prisma } from "@/lib/prisma";
import { CACHE_TTL, cachedQuery } from "@/lib/dataCache";
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
import {
  fallbackNameLang,
  firstGrapheme,
  originalLang,
} from "@/components/artists/artistDetail";
import {
  MemberSongRow,
  type MemberSongView,
} from "@/components/members/MemberSongRow";
import {
  MemberEventRow,
  type MemberEventView,
} from "@/components/members/MemberEventRow";
import {
  MEMBER_EVENT_DATE_FORMAT,
  memberColorStyle,
} from "@/components/members/memberDetail";
import styles from "@/components/members/memberDetail.module.css";

type Props = {
  params: Promise<{ locale: string; id: string; slug?: string[] }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};

const TABS = ["overview", "songs", "history"] as const;
type TabKey = (typeof TABS)[number];

function resolveTab(value: string | string[] | undefined): TabKey {
  const v = Array.isArray(value) ? value[0] : value;
  return TABS.includes(v as TabKey) ? (v as TabKey) : "overview";
}

async function fetchMember(id: string) {
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
      //
      // The three-tier `where` chain is REQUIRED for correctness, not
      // a nice-to-have:
      //   - SetlistItemMember has no `isDeleted` of its own (it's a
      //     junction). When the operator soft-deletes a SetlistItem
      //     (or the parent Event), Prisma DOES NOT cascade — the
      //     junction rows + their SetlistItemSong children stay in
      //     the table. Without the filter, the songs-tab aggregation
      //     downstream (`for (sis of perf.setlistItem.songs) { count++ }`)
      //     would credit the member with songs that no longer appear
      //     on any user-facing surface, including songs whose only
      //     `SetlistItemSong` row is on a soft-deleted item.
      //   - The same applies one level deeper: a soft-deleted Song
      //     (Song.isDeleted = true) shouldn't count toward the
      //     member's "songs sung" total even if the surrounding
      //     setlist item is live.
      //   - `event: { isDeleted: false }` belt + suspenders: a
      //     soft-deleted event should already have its setlist items
      //     soft-deleted by the operator workflow, but the filter is
      //     cheap and protects against partial-deletion drift.
      performances: {
        where: {
          setlistItem: {
            isDeleted: false,
            event: { isDeleted: false },
          },
        },
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
              // unit tag name from the song's primary artist.
              songs: {
                where: { song: { isDeleted: false } },
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
              // No SetlistItemArtist include: it only fed a per-event
              // unit chip that the history rows never rendered (the
              // chip was built but dropped when mapping history views,
              // see 30-v1 design-contract), and the 30-v1 history row
              // has no trailing chip column.
            },
          },
        },
      },
      // Event-level "this member was on stage" rows. A full-group default
      // appearance leaves no SetlistItemMember row but DOES leave an
      // EventPerformer row (per schema.prisma:475-488 — `isGuest: false`
      // means counted in the full-group fallback). We use the diff
      // between this set and `performances` to flag 전출연 events.
      //
      // `where: { event: { isDeleted: false } }` mirrors the
      // performance filter above — a soft-deleted event must not
      // surface as a 전출연 row downstream. EventPerformer itself has
      // no `isDeleted` column (it's a junction), so the filter has
      // to live on the parent Event.
      eventPerformers: {
        where: { event: { isDeleted: false } },
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

// `generateMetadata` and the page body both call this; `react.cache`
// collapses them within a request, `cachedQuery` across requests.
const getMember = cache(
  cachedQuery("member-detail", fetchMember, { revalidate: CACHE_TTL.entity }),
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const member = await getMember(id);
  if (!member) return { title: "Not Found" };
  const memberT = await getTranslations({ locale, namespace: "Member" });
  const fullName =
    displayNameWithFallback(member, member.translations, locale, "full") ||
    memberT("unknown");

  // Group for the title: the parent of the first unit link that has
  // one (unit → group), else a direct group affiliation. Cheaper
  // cousin of the page body's primary-unit/breadcrumb derivation —
  // the title only needs *a* group name for disambiguation, not the
  // most-recent-unit ordering the hero badge cares about.
  const group =
    member.artistLinks.find((l) => l.artist.parentArtist)?.artist
      .parentArtist ??
    member.artistLinks.find((l) => l.artist.type === "group")?.artist ??
    null;
  const groupName = group
    ? displayNameWithFallback(group, group.translations, locale)
    : null;
  const mt = await getTranslations({ locale, namespace: "Meta" });
  const title = groupName
    ? mt("memberTitle", { name: fullName, group: groupName })
    : mt("memberTitleNoGroup", { name: fullName });
  const description = `${fullName} ${mt("performanceHistory")}`;
  const alternates = entityAlternates("members", locale, id, member.slug);

  return {
    title,
    description,
    alternates,
    openGraph: {
      title,
      description,
      url: alternates.canonical,
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
  const { locale, id, slug } = await params;
  const sp = await searchParams;
  const activeTab = resolveTab(sp.tab);

  const member = await getMember(id);
  if (!member) notFound();
  enforceCanonicalSlug("members", locale, id, member.slug, slug, sp);

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

  // `lang` for the two name lines: the h1 is the viewer-locale
  // translation when one exists (inherits <html lang>) and the
  // original otherwise; the subtitle is always the original.
  const characterPrimaryLang = fallbackNameLang(
    member,
    member.translations,
    locale,
  );
  const characterOriginalLang = originalLang(member.originalLanguage, locale);

  // Pick the active unit for chrome (unit link, song-tag fallback).
  // Active = `endDate: null`; ties broken by most recent `startDate`.
  // Sub-artist `type === "unit"` only — solos appear in artistLinks too
  // but are not "units" in the chip sense.
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
  const primaryUnitLang = primaryUnit
    ? fallbackNameLang(
        primaryUnit.artist,
        primaryUnit.artist.translations,
        locale,
      )
    : undefined;

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
  // character name: `main` = locale translation, `sub` = original.
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
  // visual noise without conveying new information). Every VA row in
  // the current catalog has null dates, so the line is usually absent;
  // affiliation dates are never substituted (30-v1 contract). The
  // dates are `@db.Date` (UTC midnight), so the format pins
  // `timeZone: "UTC"` — the default options use the process zone and
  // showed 2023-03-29 as March 28 on a US-west server.
  const vaPeriod = currentVa?.startDate
    ? currentVa.endDate
      ? `${formatDate(currentVa.startDate, locale, HISTORY_ROW_DATE_FORMAT)} ~ ${formatDate(currentVa.endDate, locale, HISTORY_ROW_DATE_FORMAT)}`
      : formatDate(currentVa.startDate, locale, HISTORY_ROW_DATE_FORMAT)
    : null;

  // Ongoing badge uses the marketing "LIVE" label (matching the home,
  // event list, series, and song detail surfaces).
  const statusLabels: Record<ResolvedEventStatus, string> = {
    ongoing: evT("live"),
    upcoming: evT("status.upcoming"),
    completed: evT("status.completed"),
    cancelled: evT("status.cancelled"),
  };

  // ─── Event view-model ────────────────────────────────────────────
  // Union of (a) events where the member sang specific songs
  // (`performances`) and (b) non-guest EventPerformer rows (full-group
  // default appearances that leave no SetlistItemMember row), one view
  // per event id.
  type MemberEvent = (typeof member.performances)[number]["setlistItem"]["event"];
  type EventView = MemberEventView & {
    seriesId: number;
    /** Group header label: series name, else the event's own name. */
    groupLabel: string;
    groupLang?: string;
    rawDateMs: number;
  };

  const buildView = (event: MemberEvent): EventView => {
    const series = event.eventSeries;
    const seriesName = series
      ? displayNameWithFallback(series, series.translations, locale) || null
      : null;
    const seriesLang = series
      ? fallbackNameLang(series, series.translations, locale)
      : undefined;
    const name =
      displayNameWithFallback(event, event.translations, locale) ||
      evT("unknownEvent");
    const nameLang = fallbackNameLang(event, event.translations, locale);
    // serializeBigInt's JSON.stringify turns Date columns into ISO
    // strings — runtime is `string` even though the type says Date.
    const isoDate = event.date ? String(event.date).slice(0, 10) : null;
    return {
      id: String(event.id),
      href: entityPath("events", locale, event.id, event.slug),
      status: getEventStatus(
        { status: event.status, startTime: event.startTime },
        referenceNow,
      ),
      statusLabel: "",
      formattedDate: formatDate(event.date, locale, MEMBER_EVENT_DATE_FORMAT),
      isoDate,
      name,
      nameLang,
      seriesName,
      seriesLang,
      seriesId: series ? Number(series.id) : 0,
      groupLabel: seriesName ?? name,
      groupLang: seriesName ? seriesLang : nameLang,
      rawDateMs: isoDate ? new Date(isoDate).getTime() : 0,
    };
  };

  const eventViewsById = new Map<number, EventView>();
  for (const perf of member.performances) {
    const event = perf.setlistItem.event;
    const eid = Number(event.id);
    if (!eventViewsById.has(eid)) eventViewsById.set(eid, buildView(event));
  }
  for (const ep of member.eventPerformers) {
    if (ep.isGuest) continue; // guest appearances ≠ full-group default
    const eid = Number(ep.event.id);
    if (!eventViewsById.has(eid)) eventViewsById.set(eid, buildView(ep.event));
  }
  for (const view of eventViewsById.values()) {
    view.statusLabel = statusLabels[view.status];
  }

  const totalEvents = eventViewsById.size;
  const totalCompleted = [...eventViewsById.values()].filter(
    (e) => e.status === "completed",
  ).length;

  // ─── Series-grouped views (history tab) ──────────────────────────
  // Group by seriesId (0 = standalone events, which share one group
  // labelled by the first event's name, as before). Within a group sort
  // by date desc; groups sort ongoing-first, then most-recent date desc.
  type SeriesGroup = {
    id: number;
    label: string;
    labelLang?: string;
    events: EventView[];
    hasOngoing: boolean;
    sortKey: number;
  };
  const groupMap = new Map<number, EventView[]>();
  for (const view of eventViewsById.values()) {
    const list = groupMap.get(view.seriesId);
    if (list) list.push(view);
    else groupMap.set(view.seriesId, [view]);
  }
  const seriesGroups: SeriesGroup[] = [...groupMap.entries()]
    .map(([sid, list]) => {
      const events = [...list].sort((a, b) => b.rawDateMs - a.rawDateMs);
      const hasOngoing = events.some((e) => e.status === "ongoing");
      const mostRecentMs = events.reduce(
        (m, e) => (e.rawDateMs > m ? e.rawDateMs : m),
        0,
      );
      return {
        id: sid,
        // Every event in a series resolves to the same series label;
        // for the standalone bucket the first-inserted event's name
        // labels the group (the previous page's behaviour).
        label: list[0].groupLabel,
        labelLang: list[0].groupLang,
        events,
        hasOngoing,
        sortKey: hasOngoing ? Number.MAX_SAFE_INTEGER : mostRecentMs,
      };
    })
    .sort((a, b) => b.sortKey - a.sortKey);

  // Recent-3 across all series for the overview tab, newest first
  // (future scheduled dates included). The series name shows as a
  // subtitle only when it adds something beyond the event name.
  const recentEvents: EventView[] = [...eventViewsById.values()]
    .sort((a, b) => b.rawDateMs - a.rawDateMs)
    .slice(0, 3);

  // ─── Songs aggregation ───────────────────────────────────────────
  // Walk performances → setlistItem.songs. Count occurrences per song.
  // Each SetlistItemMember row is "this character sang this song-row";
  // a medley with N songs counts as N appearances for that character
  // in that event, which matches the operator's intent ("8회 공연" =
  // 8 song-row appearances, not 8 distinct events).
  const songMap = new Map<number, MemberSongView>();
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
        // Unit tag: the song's primary artist (else its first credited
        // artist); with no credit at all, the member's primary unit so
        // the row still has a readable label.
        const primaryArtist =
          song.artists.find((sa) => sa.role === "primary")?.artist ??
          song.artists[0]?.artist ??
          null;
        const artistName = primaryArtist
          ? displayNameWithFallback(
              primaryArtist,
              primaryArtist.translations,
              locale,
            )
          : "";
        entry = {
          id: sid,
          // `song.slug` is the canonical DB slug — never slugify the
          // display title (the song page 308s every other slug).
          href: entityPath("songs", locale, song.id, song.slug),
          title: main || song.originalTitle,
          titleLang: originalLang(song.originalLanguage, locale),
          titleSub: sub,
          unitName: artistName || primaryUnitName,
          unitLang:
            primaryArtist && artistName
              ? fallbackNameLang(
                  primaryArtist,
                  primaryArtist.translations,
                  locale,
                )
              : primaryUnitLang,
          timesPerformed: 0,
        };
        songMap.set(sid, entry);
      }
      entry.timesPerformed += 1;
    }
  }
  // Count desc; equal counts keep query encounter order (30-v1 contract
  // allows tie order to differ from the standalone snapshot).
  const songsAll: MemberSongView[] = [...songMap.values()].sort(
    (a, b) => b.timesPerformed - a.timesPerformed,
  );
  const songsTop3 = songsAll.slice(0, 3);
  const totalSongs = songsAll.length;

  const memberHref = entityPath("members", locale, id, member.slug);
  const tabs = [
    { key: "overview", label: t("tabOverview") },
    { key: "songs", label: t("tabSongs", { count: totalSongs }) },
    { key: "history", label: t("tabHistory", { count: totalEvents }) },
  ];
  const title = characterPrimary || t("unknown");
  const showSubtitle =
    Boolean(characterSecondary) && characterSecondary !== title;

  const songList = (songs: MemberSongView[]) =>
    songs.length === 0 ? (
      <p className={styles.empty}>{t("noSongs")}</p>
    ) : (
      <ul className={styles.list}>
        {songs.map((song) => (
          <MemberSongRow
            key={song.id}
            song={song}
            countUnit={t("songCountUnit", { count: song.timesPerformed })}
          />
        ))}
      </ul>
    );

  // Body is a flex column: `<main>` takes the remaining height
  // (`flex-1`) and `.page` pins `width: 100%` next to its max-width so
  // the column tracks the viewport, not its content.
  return (
    <main className="flex-1">
      <div className={styles.page}>
        <div className={styles.breadcrumb}>
          <Breadcrumb
            ariaLabel={ct("breadcrumb")}
            items={[
              { label: ct("home"), href: `/${locale}` },
              ...(parentArtist && parentName
                ? [
                    {
                      label: parentName,
                      href: entityPath(
                        "artists",
                        locale,
                        parentArtist.id,
                        parentArtist.slug,
                      ),
                    } satisfies BreadcrumbItem,
                  ]
                : []),
              { label: breadcrumbLeafName },
            ]}
          />
        </div>

        {/* Identity card (30-v1): full-width, replacing the old 280px
            sticky sidebar. Initial + names + unit link on the left, the
            VA credit on the right, three metrics across the bottom. No
            portrait — members have no managed photos. */}
        <section
          className={styles.identity}
          style={memberColorStyle(member.color)}
          data-voice={currentVa && vaPrimary ? undefined : "none"}
          aria-labelledby="member-title"
        >
          <div className={styles.heading}>
            {/* Original-language short name's first character (e.g. 璃
                for 璃乃) — see `characterAvatarLabel` above. */}
            <span className={styles.avatar} aria-hidden="true">
              {firstGrapheme(characterAvatarLabel)}
            </span>
            <div className={styles.nameBlock}>
              <span className={styles.eyebrow}>{t("eyebrow")}</span>
              <h1
                id="member-title"
                className={styles.title}
                lang={characterPrimary ? characterPrimaryLang : undefined}
              >
                {title}
              </h1>
              {showSubtitle && (
                <p className={styles.subtitle} lang={characterOriginalLang}>
                  {characterSecondary}
                </p>
              )}
              {primaryUnit && primaryUnitName && (
                <Link
                  href={entityPath(
                    "artists",
                    locale,
                    primaryUnit.artist.id,
                    primaryUnit.artist.slug,
                  )}
                  className={styles.unitLink}
                  lang={primaryUnitLang}
                >
                  {primaryUnitName}
                  <span aria-hidden="true">›</span>
                </Link>
              )}
            </div>
          </div>

          {/* VA: a non-link supporting credit (RealPerson has no page). */}
          {currentVa && vaPrimary && (
            <div className={styles.voice}>
              <h2 className={styles.voiceLabel}>{t("voiceActor")}</h2>
              <div className={styles.voicePerson}>
                {/* Full original name's first character — see
                    `vaOriginal` for why it differs from the character
                    initial. */}
                <span
                  className={`${styles.avatar} ${styles.avatarSmall}`}
                  aria-hidden="true"
                >
                  {firstGrapheme(vaOriginal || "?")}
                </span>
                <div>
                  <span
                    className={styles.voiceName}
                    lang={fallbackNameLang(
                      currentVa.realPerson,
                      currentVa.realPerson.translations,
                      locale,
                    )}
                  >
                    {vaPrimary}
                  </span>
                  {vaSecondary && (
                    <span
                      className={styles.voiceOriginal}
                      lang={originalLang(
                        currentVa.realPerson.originalLanguage,
                        locale,
                      )}
                    >
                      {vaSecondary}
                    </span>
                  )}
                  {vaPeriod && <p className={styles.period}>{vaPeriod}</p>}
                </div>
              </div>
            </div>
          )}

          <dl className={styles.metrics}>
            <div>
              <dt>{t("statsTotalEvents")}</dt>
              <dd>{totalEvents}</dd>
            </div>
            <div>
              <dt>{t("statsCompleted")}</dt>
              <dd>{totalCompleted}</dd>
            </div>
            <div>
              <dt>{t("statsSongs")}</dt>
              <dd>{totalSongs}</dd>
            </div>
          </dl>
        </section>

        {/* Server-routed `?tab=` links, not ARIA tabs: each tab is a
            fresh server render, so the WAI-ARIA tab pattern would
            misdescribe the interaction. `aria-current` marks the
            active one. */}
        <nav className={styles.tabs} aria-label={ct("tabsAriaLabel")}>
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={`${memberHref}?tab=${tab.key}`}
              scroll={false}
              className={styles.tab}
              aria-current={tab.key === activeTab ? "page" : undefined}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        {activeTab === "overview" && (
          <div className={styles.overview}>
            <section
              className={styles.panel}
              aria-labelledby="member-top-songs"
            >
              <div className={styles.panelHead}>
                <h2 id="member-top-songs" className={styles.panelTitle}>
                  {t("topSongs")}
                </h2>
                {totalSongs > songsTop3.length && (
                  <Link
                    href={`${memberHref}?tab=songs`}
                    scroll={false}
                    className={styles.more}
                  >
                    {t("viewAll")}
                  </Link>
                )}
              </div>
              {songList(songsTop3)}
            </section>

            <section
              className={styles.panel}
              aria-labelledby="member-recent-events"
            >
              <div className={styles.panelHead}>
                <h2 id="member-recent-events" className={styles.panelTitle}>
                  {t("recentEvents")}
                </h2>
                {totalEvents > recentEvents.length && (
                  <Link
                    href={`${memberHref}?tab=history`}
                    scroll={false}
                    className={styles.more}
                  >
                    {t("viewAll")}
                  </Link>
                )}
              </div>
              {recentEvents.length === 0 ? (
                <p className={styles.empty}>{t("noEvents")}</p>
              ) : (
                recentEvents.map((event) => (
                  <MemberEventRow
                    key={event.id}
                    event={event}
                    showSeries={event.seriesName !== event.name}
                  />
                ))
              )}
            </section>
          </div>
        )}

        {activeTab === "songs" && (
          <section className={styles.panel} aria-labelledby="member-songs">
            <div className={styles.panelHead}>
              <h2 id="member-songs" className={styles.panelTitle}>
                {t("songsHeader", { count: totalSongs })}
              </h2>
            </div>
            {songList(songsAll)}
          </section>
        )}

        {activeTab === "history" && (
          <>
            <h2 className={styles.historyTitle}>
              {t("historyHeader", { count: totalEvents })}
            </h2>
            {seriesGroups.length === 0 ? (
              <section className={styles.panel}>
                <p className={styles.empty}>{t("noEvents")}</p>
              </section>
            ) : (
              // Native <details>: groups start open, toggle with
              // Enter/Space and need no client JS. The heading inside
              // <summary> is allowed content and keeps the series names
              // in the page outline.
              seriesGroups.map((group) => (
                <details
                  key={group.id}
                  className={`${styles.panel} ${styles.historyGroup}`}
                  open
                >
                  <summary className={styles.groupSummary}>
                    <h3 className={styles.groupName} lang={group.labelLang}>
                      {group.label}
                    </h3>
                    {group.hasOngoing && (
                      <span className={styles.status} data-status="ongoing">
                        {evT("live")}
                      </span>
                    )}
                    <span className={styles.groupCount}>
                      <span aria-hidden="true">{group.events.length}</span>
                      <span className="sr-only">
                        {at("eventCount", { count: group.events.length })}
                      </span>
                    </span>
                    <span className={styles.chevron} aria-hidden="true">
                      ⌄
                    </span>
                  </summary>
                  {group.events.map((event) => (
                    <MemberEventRow
                      key={event.id}
                      event={event}
                      showSeries={false}
                    />
                  ))}
                </details>
              ))
            )}
          </>
        )}
      </div>
    </main>
  );
}
