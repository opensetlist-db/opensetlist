import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
// Every link on this page is a locale-prefixed canonical path from
// `entityPath` / `eventHref`, so the plain `next/link` is the right one
// (the i18n Link would prefix the locale a second time).
import Link from "next/link";
import type { Metadata } from "next";
import {
  entityAlternates,
  entityPath,
  enforceCanonicalSlug,
} from "@/lib/seo/entityUrl";
import { formatDate } from "@/lib/utils";
import {
  displayNameWithFallback,
  displayOriginalName,
  displayOriginalTitle,
  resolveLocalizedField,
} from "@/lib/display";
import { getEventStatus, type ResolvedEventStatus } from "@/lib/eventStatus";
import { eventHref } from "@/lib/eventHref";
import { groupByCity, type SeriesEventInput } from "@/lib/seriesGrouping";
import { getSeriesStats } from "@/lib/seriesStats";
import {
  getScheduleSongCount,
  getSeriesDetail,
  getSeriesUnits,
  getSongAppearances,
  type SongAppearance,
  type SongRowHydrated,
} from "@/lib/seriesDetail";
import { Breadcrumb, type BreadcrumbItem } from "@/components/Breadcrumb";
import {
  SeriesIdentity,
  type LangText,
  type SeriesMeta,
} from "@/components/series/detail/SeriesIdentity";
import { SeriesTabs } from "@/components/series/detail/SeriesTabs";
import { SeriesAside } from "@/components/series/detail/SeriesAside";
import {
  SeriesLegGroup,
  type SeriesLeg,
} from "@/components/series/detail/SeriesLegGroup";
import {
  SeriesSongsPanel,
  type SeriesSongRow,
} from "@/components/series/detail/SeriesSongsPanel";
import { SeriesStatusPill } from "@/components/series/detail/SeriesStatusPill";
import { SeriesBdSection } from "@/components/series/detail/SeriesBdSection";
import {
  SERIES_DATE_FORMAT,
  formatSeriesDateRange,
} from "@/components/series/detail/seriesDate";
import styles from "@/components/series/detail/seriesDetail.module.css";

type Props = {
  params: Promise<{ locale: string; id: string; slug?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const TABS = ["schedule", "songs"] as const;
type TabKey = (typeof TABS)[number];

function resolveTab(value: string | string[] | undefined): TabKey {
  const v = Array.isArray(value) ? value[0] : value;
  return TABS.includes(v as TabKey) ? (v as TabKey) : "schedule";
}

type NamedTranslation = {
  locale: string;
  name: string;
  shortName?: string | null;
};

/**
 * The `lang` of a name picked by `displayNameWithFallback` /
 * `displayOriginalName`'s `main`: the viewer's locale when that
 * locale's row supplied it, otherwise the entity's original language
 * (the strict fallback never borrows a third locale). Screen readers
 * and the JP font fallback both key off it.
 */
function nameLang(
  item: { originalLanguage: string },
  translations: readonly NamedTranslation[],
  locale: string,
  mode: "short" | "full" = "full",
): string {
  const row = translations.find((t) => t.locale === locale);
  const fromRow = mode === "short" ? row?.shortName || row?.name : row?.name;
  return fromRow ? locale : item.originalLanguage;
}

/** Same rule for a secondary field (city, venue, description, …). */
function fieldLang(
  item: { originalLanguage: string },
  translations: readonly ({ locale: string } & Record<string, unknown>)[],
  locale: string,
  field: string,
): string {
  const value = translations.find((t) => t.locale === locale)?.[field];
  return typeof value === "string" && value.length > 0
    ? locale
    : item.originalLanguage;
}

export async function generateMetadata({
  params,
}: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const metaT = await getTranslations({ locale, namespace: "Meta" });
  if (!/^\d+$/.test(id)) return { title: metaT("notFound") };
  const detail = await getSeriesDetail(BigInt(id));
  if (!detail) return { title: metaT("notFound") };
  const { series } = detail;
  const seriesName = displayNameWithFallback(
    series,
    series.translations,
    locale,
    "full",
  );
  const description = resolveLocalizedField(
    series,
    series.translations,
    locale,
    "description",
    "originalDescription",
  );
  const title = seriesName
    ? metaT("seriesTitle", { name: seriesName })
    : "OpenSetlist";
  const alternates = entityAlternates("series", locale, id, series.slug);
  return {
    title,
    description:
      description ??
      (seriesName ? metaT("seriesDescription", { name: seriesName }) : undefined),
    alternates,
    openGraph: {
      title,
      url: alternates.canonical,
      siteName: "OpenSetlist",
      locale,
      type: "website",
    },
  };
}

export default async function EventSeriesPage({
  params,
  searchParams,
}: Props) {
  const { locale, id, slug } = await params;
  const sp = await searchParams;
  const activeTab = resolveTab(sp.tab);

  if (!/^\d+$/.test(id)) notFound();
  const detail = await getSeriesDetail(BigInt(id));
  if (!detail) notFound();
  const { series, logo } = detail;
  // Bare id, wrong / renamed slug or extra segments → 308 to the
  // canonical `/series/<id>/<db slug>`, query preserved.
  enforceCanonicalSlug("series", locale, id, series.slug, slug, sp);

  const t = await getTranslations({ locale, namespace: "EventSeries" });
  const ct = await getTranslations({ locale, namespace: "Common" });
  const evT = await getTranslations({ locale, namespace: "Event" });
  const aT = await getTranslations({ locale, namespace: "Artist" });

  // One reference instant for every getEventStatus() call in this
  // render, so an event near a boundary can't be classified differently
  // between the banner, the stats and the city groups.
  const referenceNow = new Date();

  // `series` is the RAW Prisma row (bigint ids, Date timestamps).
  // `SeriesEventInput` unions the raw and serialized shapes, so the
  // cast only widens; one cast site keeps the rest clean.
  const events = series.events as unknown as SeriesEventInput[];
  const stats = getSeriesStats(events, locale, referenceNow);
  const legs = groupByCity(events, locale, referenceNow);

  const completedEventIds = events
    .filter((e) => getEventStatus(e, referenceNow) === "completed")
    .map((e) => BigInt(e.id));
  const allEventIds = events.map((e) => BigInt(e.id));

  // All three reads run in parallel. The songs tab hydrates the full
  // rows and counts them; the schedule tab only needs the cheap distinct
  // count for the tab label and the metric.
  const [songAppearances, units, scheduleSongCount] = await Promise.all([
    activeTab === "songs"
      ? getSongAppearances(completedEventIds)
      : Promise.resolve([] as SongAppearance[]),
    getSeriesUnits(allEventIds),
    activeTab === "songs"
      ? Promise.resolve(0)
      : getScheduleSongCount(completedEventIds),
  ]);

  // Drop rows whose song was soft-deleted between the groupBy and the
  // hydrate query (rare race), so the count and the list agree.
  const visibleSongs = songAppearances.filter(
    (row): row is SongAppearance & { song: SongRowHydrated } =>
      row.song !== null,
  );
  const uniqueSongCount =
    activeTab === "songs" ? visibleSongs.length : scheduleSongCount;

  const statusLabels: Record<ResolvedEventStatus, string> = {
    ongoing: evT("live"),
    upcoming: evT("status.upcoming"),
    completed: evT("status.completed"),
    cancelled: evT("status.cancelled"),
  };

  // ── Identity ────────────────────────────────────────────
  const { main: seriesMain, sub: seriesSub } = displayOriginalName(
    series,
    series.translations,
    locale,
  );
  const title: LangText = seriesMain
    ? { text: seriesMain, lang: nameLang(series, series.translations, locale) }
    : { text: t("unknownSeries"), lang: locale };
  const subtitle: LangText | null = seriesSub
    ? { text: seriesSub, lang: series.originalLanguage }
    : null;
  const descriptionText = resolveLocalizedField(
    series,
    series.translations,
    locale,
    "description",
    "originalDescription",
  );
  const description: LangText | null = descriptionText
    ? {
        text: descriptionText,
        lang: fieldLang(series, series.translations, locale, "description"),
      }
    : null;

  // Representative artist (canonical link) or, for a multi-artist
  // series (artistId null), the localized organizer as plain text.
  let meta: SeriesMeta | null = null;
  if (series.artist) {
    meta = {
      kind: "artist",
      label: t("artistLabel"),
      href: entityPath(
        "artists",
        locale,
        series.artist.id,
        series.artist.slug,
      ),
      name: {
        text:
          displayNameWithFallback(
            series.artist,
            series.artist.translations,
            locale,
          ) || aT("unknown"),
        lang: nameLang(series.artist, series.artist.translations, locale),
      },
    };
  } else {
    const organizer = resolveLocalizedField(
      series,
      series.translations,
      locale,
      "organizerName",
      "organizerName",
    );
    if (organizer) {
      meta = {
        kind: "organizer",
        label: t("organizer"),
        name: {
          text: organizer,
          lang: fieldLang(series, series.translations, locale, "organizerName"),
        },
      };
    }
  }

  const metrics = [
    {
      label: t("statsTotalEvents"),
      value: t("statsTotalEventsValue", { count: stats.total }),
    },
    {
      label: t("statsTotalCities"),
      value: t("statsTotalCitiesValue", { count: stats.totalCities }),
    },
    {
      label: t("statsSongs"),
      value: t("statsSongsValue", { count: uniqueSongCount }),
    },
    {
      label: t("statsUnits"),
      value: t("statsUnitsValue", { count: units.length }),
    },
  ];

  // ── Breadcrumb: home / optional parent / current (short names) ──
  const breadcrumbItems: BreadcrumbItem[] = [
    { label: ct("home"), href: `/${locale}` },
  ];
  if (series.parentSeries) {
    breadcrumbItems.push({
      label:
        displayNameWithFallback(
          series.parentSeries,
          series.parentSeries.translations,
          locale,
          "short",
        ) || t("unknownSeries"),
      href: entityPath(
        "series",
        locale,
        series.parentSeries.id,
        series.parentSeries.slug,
      ),
    });
  }
  breadcrumbItems.push({
    label:
      displayNameWithFallback(series, series.translations, locale, "short") ||
      t("unknownSeries"),
  });

  // ── City groups ──────────────────────────────────────────
  const preparedLegs: SeriesLeg[] = legs.map((leg, i) => {
    const first = leg.events[0];
    const legEvents = leg.events.map((ev) => {
      const status = getEventStatus(ev, referenceNow);
      // Row date prefers the calendar `date`; the group's range below
      // uses startTime (existing behaviour, kept by 32-v1 even where
      // the two disagree in real data — dev series 1, event 3).
      const rowDate = ev.date ?? ev.startTime;
      const name = displayNameWithFallback(
        ev,
        ev.translations,
        locale,
        "short",
      );
      return {
        id: String(ev.id),
        href: eventHref(locale, ev.id, ev.slug),
        status,
        statusLabel: statusLabels[status],
        dateTime: new Date(rowDate).toISOString(),
        formattedDate: formatDate(rowDate, locale, SERIES_DATE_FORMAT),
        name: name
          ? { text: name, lang: nameLang(ev, ev.translations, locale, "short") }
          : { text: evT("unknownEvent"), lang: locale },
      };
    });
    // Roll-up: ongoing > upcoming > completed; an all-cancelled group
    // shows no header pill (each row still carries "취소").
    const rollup = (["ongoing", "upcoming", "completed"] as const).find((s) =>
      legEvents.some((e) => e.status === s),
    );
    return {
      key: `${leg.city}-${i}`,
      city: leg.city
        ? { text: leg.city, lang: fieldLang(first, first.translations, locale, "city") }
        : { text: t("unknownCity"), lang: locale },
      venue: leg.venue
        ? {
            text: leg.venue,
            lang: fieldLang(first, first.translations, locale, "venue"),
          }
        : null,
      dateRangeLabel: formatSeriesDateRange(
        leg.dateRange.start,
        leg.dateRange.end,
        locale,
      ),
      status: rollup ? { status: rollup, label: statusLabels[rollup] } : null,
      countLabel: t("eventCountInLeg", { count: leg.events.length }),
      events: legEvents,
    };
  });

  // ── LIVE banner: first ongoing event in query (date) order ──
  const firstOngoing =
    events.find((e) => getEventStatus(e, referenceNow) === "ongoing") ?? null;

  // ── Songs tab rows ───────────────────────────────────────
  const songRows: SeriesSongRow[] = visibleSongs.map((row) => {
    const song = row.song;
    const display = displayOriginalTitle(song, song.translations, locale);
    const variantFromLocale = song.translations.find(
      (tr) => tr.locale === locale,
    )?.variantLabel;
    const primary = song.artists[0]?.artist;
    const artistName = primary
      ? displayNameWithFallback(primary, primary.translations, locale)
      : "";
    return {
      key: row.songId,
      href: entityPath("songs", locale, row.songId, song.slug),
      title: { text: display.main, lang: song.originalLanguage },
      variant: display.variant
        ? {
            text: display.variant,
            lang: variantFromLocale ? locale : song.originalLanguage,
          }
        : null,
      translated: display.sub ? { text: display.sub, lang: locale } : null,
      artist:
        primary && artistName
          ? {
              text: artistName,
              lang: nameLang(primary, primary.translations, locale),
            }
          : null,
      count: row.count,
      countUnit: t("songAppearancesUnit", { count: row.count }),
    };
  });

  const tabs = [
    { key: "schedule" as const, label: t("tabSchedule") },
    {
      key: "songs" as const,
      label: t("tabSongs", { count: uniqueSongCount }),
    },
  ];

  return (
    // `<main>` is the skip-link target. `.page` pins width: 100% next to
    // max-width + auto margins (body is a flex column; see the album
    // page's note on the same wrapper).
    <main className={styles.page}>
      <div className={styles.breadcrumb}>
        <Breadcrumb ariaLabel={ct("breadcrumb")} items={breadcrumbItems} />
      </div>

      <SeriesIdentity
        logo={logo}
        typeLabel={t(`type.${series.type}`)}
        title={title}
        subtitle={subtitle}
        meta={meta}
        description={description}
        metrics={metrics}
      />

      <SeriesTabs
        tabs={tabs}
        active={activeTab}
        basePath={entityPath("series", locale, series.id, series.slug)}
        searchParams={sp}
        ariaLabel={ct("tabsAriaLabel")}
      />

      <div className={styles.layout}>
        <div className={styles.main}>
          {activeTab === "schedule" ? (
            <>
              {firstOngoing ? (
                <Link
                  href={eventHref(locale, firstOngoing.id, firstOngoing.slug)}
                  className={styles.liveBanner}
                >
                  <SeriesStatusPill
                    status="ongoing"
                    label={statusLabels.ongoing}
                  />
                  <span>
                    <strong>{t("liveBannerTitle")}</strong>
                    <small>{t("liveBannerCta")}</small>
                  </span>
                </Link>
              ) : null}

              {series.childSeries.length > 0 ? (
                <section
                  className={`${styles.panel} ${styles.children}`}
                  aria-labelledby="series-children-title"
                >
                  <h2 id="series-children-title">{t("childSeriesLabel")}</h2>
                  <ul>
                    {series.childSeries.map((child) => (
                      <li key={String(child.id)}>
                        <Link
                          href={entityPath(
                            "series",
                            locale,
                            child.id,
                            child.slug,
                          )}
                          lang={nameLang(child, child.translations, locale)}
                        >
                          {displayNameWithFallback(
                            child,
                            child.translations,
                            locale,
                          ) || t("unknownSeries")}{" "}
                          <span aria-hidden="true">›</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <SeriesBdSection seriesId={series.id} locale={locale} />

              {preparedLegs.length === 0 ? (
                <div className={`${styles.panel} ${styles.empty}`}>
                  {t("noEvents")}
                </div>
              ) : (
                preparedLegs.map((leg) => (
                  <SeriesLegGroup key={leg.key} leg={leg} />
                ))
              )}
            </>
          ) : (
            <SeriesSongsPanel
              basisLabel={t("songsBasisLabel", { count: stats.completed })}
              rows={songRows}
              footer={t("songsFooter")}
              emptyLabel={t("songsEmpty")}
            />
          )}
        </div>

        <SeriesAside
          progress={
            stats.total > 0
              ? {
                  title: t("tourProgressLabel"),
                  value: t("tourProgress", {
                    completed: stats.completed,
                    total: stats.total,
                  }),
                  completed: stats.completed,
                  total: stats.total,
                  completedLabel: t("tourCompletedLabel", {
                    count: stats.completed,
                  }),
                  upcomingLabel: t("tourUpcomingLabel", {
                    count: stats.upcoming,
                  }),
                  ongoing:
                    stats.ongoing > 0
                      ? { pill: statusLabels.ongoing, label: t("tourOngoingLabel") }
                      : null,
                }
              : null
          }
          units={
            units.length > 0
              ? {
                  title: t("unitsLabel"),
                  names: units.map((u) => ({
                    key: String(u.id),
                    text:
                      displayNameWithFallback(u, u.translations, locale) ||
                      aT("unknown"),
                    lang: nameLang(u, u.translations, locale),
                  })),
                }
              : null
          }
        />
      </div>
    </main>
  );
}
