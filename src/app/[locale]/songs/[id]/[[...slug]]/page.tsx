import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import {
  serializeBigInt,
  pickLocaleTranslation,
  formatDate,
  HISTORY_ROW_DATE_FORMAT,
} from "@/lib/utils";
import {
  displayNameWithFallback,
  displayOriginalTitle,
} from "@/lib/display";
import { deriveOgPaletteFromSong } from "@/lib/ogPalette";
import { normalizeOgLocale } from "@/lib/ogLabels";
import { getEventStatus, type ResolvedEventStatus } from "@/lib/eventStatus";
import {
  getSongPerformanceCells,
  type SongPerformanceCells,
} from "@/lib/songPerformance";
import { BRAND_GRADIENT } from "@/lib/artistColor";
import { Breadcrumb } from "@/components/Breadcrumb";
import { InfoCard } from "@/components/InfoCard";
import { TabBar } from "@/components/TabBar";
import { SectionLabel } from "@/components/SectionLabel";
import {
  PerformanceGroup,
  type PerformanceSeries,
  type PerformanceEvent,
} from "@/components/PerformanceGroup";
// Layout primitives import directly from the server-safe module — NOT
// from `PerformanceGroup.tsx` (which carries `"use client"`). Crossing
// the RSC boundary for plain values can resolve them to `undefined` at
// SSR, which produces invalid CSS like `padding: 8px 16px 8px undefinedpx`
// — silently rejected by the browser, dropping padding to 0 and
// breaking the column-header strip's alignment with the row tracks.
import {
  PERFORMANCE_ROW_GRID,
  PERFORMANCE_ROW_INDENT_PX,
  PERFORMANCE_ROW_GAP_PX,
} from "@/components/performance-row-layout";
import type { AlbumType } from "@/generated/prisma/enums";
import { colors, radius, shadows } from "@/styles/tokens";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};

const TABS = ["history", "variations"] as const;
type TabKey = (typeof TABS)[number];

function resolveTab(value: string | string[] | undefined): TabKey {
  const v = Array.isArray(value) ? value[0] : value;
  return TABS.includes(v as TabKey) ? (v as TabKey) : "history";
}

async function getSong(id: bigint) {
  const song = await prisma.song.findFirst({
    where: { id, isDeleted: false },
    include: {
      translations: true,
      artists: {
        include: {
          artist: { include: { translations: true } },
        },
      },
      variants: {
        where: { isDeleted: false },
        include: { translations: true },
      },
      baseVersion: {
        include: {
          translations: true,
          variants: {
            where: { isDeleted: false },
            include: { translations: true },
          },
        },
      },
    },
  });
  if (!song) return null;
  return serializeBigInt(song);
}

async function getFirstAlbumTrack(songId: bigint) {
  // Multi-album case: pick the earliest-released album as the
  // canonical "first" — deterministic regardless of insertion order
  // and matches the user's mental model ("the album where this song
  // first appeared"). Disc/track is the secondary key so re-issues
  // and special editions don't overrule the original release.
  const track = await prisma.albumTrack.findFirst({
    where: { songId },
    include: {
      album: { include: { translations: true } },
    },
    orderBy: [
      { album: { releaseDate: "asc" } },
      { discNumber: "asc" },
      { trackNumber: "asc" },
    ],
  });
  return track ? serializeBigInt(track) : null;
}

async function getSongPerformances(songId: bigint) {
  // Limit to 50 for now — Phase 1A songs don't exceed that yet.
  // The total count is fetched separately so the sidebar number is
  // accurate even if the list is truncated.
  const performances = await prisma.setlistItemSong.findMany({
    where: {
      songId,
      setlistItem: { isDeleted: false, event: { isDeleted: false } },
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
        },
      },
    },
    orderBy: { setlistItem: { event: { date: "desc" } } },
    take: 50,
  });
  return serializeBigInt(performances);
}

async function getPerformanceCount(songId: bigint) {
  return prisma.setlistItemSong.count({
    where: {
      songId,
      setlistItem: { isDeleted: false, event: { isDeleted: false } },
    },
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const metaT = await getTranslations({ locale, namespace: "Meta" });
  if (!/^\d+$/.test(id)) return { title: metaT("notFound") };
  const songId = BigInt(id);
  const [song, palette] = await Promise.all([
    getSong(songId),
    deriveOgPaletteFromSong(songId),
  ]);
  if (!song) return { title: metaT("notFound") };
  const tr = pickLocaleTranslation(song.translations, locale);
  const firstArtist = song.artists[0]?.artist ?? null;
  const artistName = firstArtist
    ? displayNameWithFallback(firstArtist, firstArtist.translations, locale)
    : null;

  const songTitle = tr?.title ?? song.originalTitle;
  const metaVariant = tr?.variantLabel || song.variantLabel;
  const title = `${songTitle}${metaVariant ? ` (${metaVariant})` : ""} | OpenSetlist`;
  const description = artistName
    ? `${artistName} · ${metaT("performanceHistory")}`
    : metaT("performanceHistory");

  const ogImage = `/api/og/song/${id}?lang=${normalizeOgLocale(locale)}&v=${palette.fingerprint}`;
  const pageUrl = `/${locale}/songs/${id}/${song.slug}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: "OpenSetlist",
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
      locale,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
      site: "@opensetlistdb",
    },
  };
}

export default async function SongPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const activeTab = resolveTab(sp.tab);

  let songId: bigint;
  try {
    songId = BigInt(id);
  } catch {
    notFound();
  }

  const [song, albumTrack, performances, performanceCount] = await Promise.all([
    getSong(songId),
    getFirstAlbumTrack(songId),
    getSongPerformances(songId),
    getPerformanceCount(songId),
  ]);

  if (!song) notFound();

  const [t, ct, et, at] = await Promise.all([
    getTranslations("Song"),
    getTranslations("Common"),
    getTranslations("Event"),
    getTranslations("Artist"),
  ]);

  // Reference instant pinned at the top of the request — every event
  // status downstream resolves against the same `now` (CLAUDE.md UTC
  // rule + matches the artist-page pattern).
  const referenceNow = new Date();

  const { main, sub, variant } = displayOriginalTitle(
    song,
    song.translations,
    locale,
  );

  // Primary artist drives the sidebar `<ColorStripe>` + the artist
  // badge. Falls back to first artist by index if no `primary` role
  // is set, then null (which makes ColorStripe use BRAND_GRADIENT).
  const primaryArtist =
    song.artists.find((sa) => sa.role === "primary")?.artist ??
    song.artists[0]?.artist ??
    null;
  const primaryArtistName = primaryArtist
    ? displayNameWithFallback(
        primaryArtist,
        primaryArtist.translations,
        locale,
      ) || at("unknown")
    : null;

  // Album info for the sidebar stats. Only the first album is shown
  // (mockup intent — Phase 1A songs are single-album in practice;
  // multi-album list is a Phase 2 concern).
  const albumInfo = albumTrack
    ? (() => {
        const tr = pickLocaleTranslation(albumTrack.album.translations, locale);
        const albumName = tr?.title ?? albumTrack.album.originalTitle;
        return { name: albumName, type: albumTrack.album.type };
      })()
    : null;

  // Build a flat per-performance view-model first, then group by
  // series for `<PerformanceGroup>`. Same shape as the artist page —
  // each entry carries enough data to render the row + sort.
  // `trailing` is pre-rendered server-side: PerformanceGroup is a
  // client component, and React refuses to serialize a function prop
  // (e.g. a `renderTrailing` callback) across the RSC boundary.
  // ReactNode trees do serialize, so the trailing JSX lives here.
  type PerformanceView = PerformanceEvent & {
    seriesId: number | null;
    seriesName: string | null;
    rawDateMs: number;
  };

  const performanceViews: PerformanceView[] = [];
  const tourSeriesIds = new Set<number>();
  for (const p of performances) {
    const event = p.setlistItem.event;
    const status = getEventStatus(
      { status: event.status, startTime: event.startTime },
      referenceNow,
    );
    const seriesId = event.eventSeries
      ? Number(event.eventSeries.id)
      : null;
    if (seriesId !== null) tourSeriesIds.add(seriesId);
    const seriesName = event.eventSeries
      ? displayNameWithFallback(
          event.eventSeries,
          event.eventSeries.translations,
          locale,
        ) || null
      : null;
    const eventName =
      displayNameWithFallback(event, event.translations, locale) ||
      et("unknownEvent");
    const cells = getSongPerformanceCells(p.setlistItem);
    performanceViews.push({
      id: String(event.id),
      seriesId,
      seriesName,
      status,
      formattedDate: formatDate(event.date, locale, HISTORY_ROW_DATE_FORMAT),
      name: eventName,
      href: `/${locale}/events/${event.id}/${event.slug}`,
      rawDateMs: new Date(String(event.date)).getTime(),
      trailing: (
        <SongRowTrailing cells={cells} encoreLabel={t("encoreBadge")} />
      ),
    });
  }

  // Group by series. Performances with no series go into a synthetic
  // "Other performances" bucket at the end — keeps standalone events
  // (festivals, one-offs) discoverable instead of dropping them.
  const seriesBuckets = new Map<string, PerformanceView[]>();
  const ungrouped: PerformanceView[] = [];
  for (const view of performanceViews) {
    if (view.seriesId === null) {
      ungrouped.push(view);
    } else {
      const key = String(view.seriesId);
      const bucket = seriesBuckets.get(key);
      if (bucket) bucket.push(view);
      else seriesBuckets.set(key, [view]);
    }
  }

  type SongSeriesView = PerformanceSeries & { sortKey: number };
  const seriesViews: SongSeriesView[] = [];
  for (const bucket of seriesBuckets.values()) {
    // Within a series, keep the desc-by-date order produced by the
    // top-level Prisma orderBy.
    bucket.sort((a, b) => b.rawDateMs - a.rawDateMs);
    const hasOngoing = bucket.some((v) => v.status === "ongoing");
    const mostRecentMs = bucket.reduce(
      (m, v) => (v.rawDateMs > m ? v.rawDateMs : m),
      0,
    );
    seriesViews.push({
      seriesId: String(bucket[0].seriesId),
      seriesShort: bucket[0].seriesName ?? et("unknownEvent"),
      hasOngoing,
      events: bucket,
      sortKey: hasOngoing ? Number.MAX_SAFE_INTEGER : mostRecentMs,
    });
  }
  seriesViews.sort((a, b) => b.sortKey - a.sortKey);

  if (ungrouped.length > 0) {
    ungrouped.sort((a, b) => b.rawDateMs - a.rawDateMs);
    seriesViews.push({
      seriesId: "ungrouped",
      seriesShort: et("ungrouped"),
      hasOngoing: ungrouped.some((v) => v.status === "ongoing"),
      events: ungrouped,
      sortKey: 0,
    });
  }

  // Variations: include the current song so the user sees the
  // "현재" highlight. `baseVersion?.variants ?? variants` keeps the
  // two-level pattern (song-of-base, base-of-variant) without
  // recursing further.
  type VariantSong = (typeof song)["variants"][number];
  const variantSiblings: VariantSong[] = song.baseVersion?.variants ?? song.variants;
  const variationList: Array<{
    id: number;
    slug: string;
    title: string;
    variantLabel: string | null;
    isCurrent: boolean;
    isBase: boolean;
  }> = [];
  if (song.baseVersion) {
    // Current song is itself a variant — list base + siblings.
    const baseTr = pickLocaleTranslation(song.baseVersion.translations, locale);
    variationList.push({
      id: Number(song.baseVersion.id),
      slug: song.baseVersion.slug,
      title: baseTr?.title ?? song.baseVersion.originalTitle,
      variantLabel:
        baseTr?.variantLabel || song.baseVersion.variantLabel || null,
      isCurrent: false,
      isBase: true,
    });
  }
  for (const v of variantSiblings) {
    const vTr = pickLocaleTranslation(v.translations, locale);
    variationList.push({
      id: Number(v.id),
      slug: v.slug,
      title: vTr?.title ?? v.originalTitle,
      variantLabel: vTr?.variantLabel || v.variantLabel || null,
      isCurrent: Number(v.id) === Number(song.id),
      isBase: false,
    });
  }
  // If the current song is itself a base (no `baseVersion`) and we
  // already pushed its variants above, add the base itself at the
  // top with `isCurrent: true`.
  if (!song.baseVersion && variationList.length > 0) {
    variationList.unshift({
      id: Number(song.id),
      slug: song.slug,
      title: main,
      variantLabel: variant ?? null,
      isCurrent: true,
      isBase: true,
    });
  }

  // Per-variant active-performance counts. Mirrors the filter from
  // getPerformanceCount() (excludes deleted setlist items + deleted
  // events), but batched into a single round-trip via groupBy so
  // each variant row can show "{N}회 공연" without N extra queries.
  const variantSongIds = variationList.map((v) => BigInt(v.id));
  const variantCountRows =
    variantSongIds.length === 0
      ? []
      : await prisma.setlistItemSong.groupBy({
          by: ["songId"],
          where: {
            songId: { in: variantSongIds },
            setlistItem: {
              isDeleted: false,
              event: { isDeleted: false },
            },
          },
          _count: { _all: true },
        });
  const variantCountBySongId = new Map<string, number>(
    variantCountRows.map((row) => [String(row.songId), row._count._all]),
  );
  const variationListWithCounts = variationList.map((v) => ({
    ...v,
    timesPerformed: variantCountBySongId.get(String(v.id)) ?? 0,
  }));

  const hasVariations = variationList.length > 1;

  const tabs = [
    {
      key: "history",
      label: t("tabHistory", { count: performanceCount }),
    },
    ...(hasVariations
      ? [
          {
            key: "variations",
            label: t("tabVariations", { count: variationList.length }),
          },
        ]
      : []),
  ];

  // Exhaustive AlbumType → label map. Using a Record keyed on the
  // Prisma enum (rather than a dynamic `t(\`albumType.${type}\`)`
  // template) means a future enum addition (e.g. `compilation`) is a
  // TypeScript error here, not a silent missing-key fallback in the
  // info-card render.
  const albumTypeLabels: Record<AlbumType, string> = {
    single: t("albumType.single"),
    album: t("albumType.album"),
    ep: t("albumType.ep"),
    live_album: t("albumType.live_album"),
    soundtrack: t("albumType.soundtrack"),
  };

  const statusLabels: Record<ResolvedEventStatus, string> = {
    // Mirror events list / home hero — the ongoing pill on row-shaped
    // surfaces reads "LIVE" rather than the locale "진행중" /
    // "開催中" / "Live now". Same `Event.live` key used by both.
    ongoing: et("live"),
    upcoming: et("status.upcoming"),
    completed: et("status.completed"),
    cancelled: et("status.cancelled"),
  };

  return (
    <main style={{ minHeight: "100vh", background: colors.bgPage }}>
      <div className="mx-auto" style={{ maxWidth: 1100, padding: "0 16px" }}>
        <Breadcrumb
          ariaLabel={ct("breadcrumb")}
          items={[
            { label: ct("backToHome"), href: `/${locale}` },
            { label: main },
          ]}
        />

        <div
          className="grid lg:grid-cols-[280px_1fr] lg:gap-7"
          style={{ alignItems: "start", paddingBottom: 60 }}
        >
          {/* Sidebar */}
          <div
            // `min-w-0` overrides the grid-item default `min-width: auto`
            // so the sidebar (and its children) can shrink to the column
            // track instead of expanding the column to fit min-content.
            // Mirrored on the Main grid item below — without this the
            // history-tab row's grid-intrinsic width pushes the page
            // wider than the mobile viewport (horizontal scroll bar).
            className="lg:sticky lg:top-[72px] min-w-0"
            style={{ marginBottom: 12 }}
          >
            <InfoCard artist={primaryArtist}>
              {primaryArtist && primaryArtistName && (
                <Link
                  href={`/${locale}/artists/${primaryArtist.id}/${primaryArtist.slug}`}
                  style={{ textDecoration: "none" }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      color: primaryArtist.color ?? colors.primary,
                      background: primaryArtist.color
                        ? `${primaryArtist.color}15`
                        : colors.primaryBg,
                      borderRadius: 10,
                      padding: "2px 8px",
                      textTransform: "uppercase",
                    }}
                  >
                    {primaryArtistName}
                  </span>
                </Link>
              )}
              <h1
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: colors.textPrimary,
                  lineHeight: 1.35,
                  marginTop: 10,
                  marginBottom: sub || variant ? 4 : 14,
                }}
              >
                {main}
              </h1>
              {sub && (
                <div
                  style={{
                    fontSize: 13,
                    color: colors.textSecondary,
                    marginBottom: 4,
                  }}
                >
                  {sub}
                </div>
              )}
              {variant && (
                <span
                  style={{
                    display: "inline-block",
                    color: colors.variant,
                    background: colors.variantBg,
                    borderRadius: 10,
                    padding: "2px 9px",
                    fontSize: 11,
                    fontWeight: 600,
                    marginTop: 6,
                    marginBottom: 14,
                  }}
                >
                  {variant}
                </span>
              )}

              {(albumInfo || song.releaseDate) && (
                <dl
                  style={{
                    margin: 0,
                    marginBottom: 18,
                    display: "grid",
                    gridTemplateColumns: "auto 1fr",
                    rowGap: 6,
                    columnGap: 12,
                    fontSize: 12,
                  }}
                >
                  {song.releaseDate && (
                    <>
                      <dt
                        style={{
                          color: colors.textMuted,
                          fontWeight: 600,
                          fontSize: 11,
                        }}
                      >
                        {t("releaseYearLabel")}
                      </dt>
                      <dd
                        style={{
                          color: colors.textPrimary,
                          margin: 0,
                        }}
                      >
                        {new Date(String(song.releaseDate)).getUTCFullYear()}
                      </dd>
                    </>
                  )}
                  {albumInfo && (
                    <>
                      <dt
                        style={{
                          color: colors.textMuted,
                          fontWeight: 600,
                          fontSize: 11,
                        }}
                      >
                        {t("albumLabel")}
                      </dt>
                      <dd
                        style={{
                          color: colors.textPrimary,
                          margin: 0,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {albumInfo.name}
                      </dd>
                      <dt
                        style={{
                          color: colors.textMuted,
                          fontWeight: 600,
                          fontSize: 11,
                        }}
                      >
                        {t("albumTypeLabel")}
                      </dt>
                      <dd
                        style={{
                          color: colors.textPrimary,
                          margin: 0,
                        }}
                      >
                        {albumTypeLabels[albumInfo.type]}
                      </dd>
                    </>
                  )}
                </dl>
              )}

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: BRAND_GRADIENT,
                    color: "white",
                    fontSize: 18,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {performanceCount}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: colors.textPrimary,
                    }}
                  >
                    {t("performanceCount", { count: performanceCount })}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: colors.textMuted,
                    }}
                  >
                    {tourSeriesIds.size} {t("statsTours")}
                  </div>
                </div>
              </div>
            </InfoCard>
          </div>

          {/* Main */}
          <div className="min-w-0">
            <TabBar
              tabs={tabs}
              active={activeTab}
              ariaLabel={ct("tabsAriaLabel")}
            />

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
                  <SectionLabel noBorder style={{ marginBottom: 0 }}>
                    {t("recentPerformances")}
                  </SectionLabel>
                </div>
                {/* Desktop column-header strip — uses the exact same
                    grid template as the row beneath, so the header
                    labels line up with their respective columns.
                    Mobile keeps the existing layout (no strip) — the
                    column header is desktop-only per the mockup. */}
                {seriesViews.length > 0 && (
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
                      t("tableHeader.status"),
                      t("tableHeader.date"),
                      t("tableHeader.event"),
                      t("tableHeader.position"),
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
                        }}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                )}
                {seriesViews.length === 0 ? (
                  <p
                    style={{
                      padding: "32px 16px",
                      fontSize: 14,
                      color: colors.textMuted,
                      textAlign: "center",
                    }}
                  >
                    {t("noPerformances")}
                  </p>
                ) : (
                  seriesViews.map((sv) => (
                    <PerformanceGroup
                      key={sv.seriesId}
                      series={sv}
                      statusLabels={statusLabels}
                      eventCountLabel={at("eventCount", {
                        count: sv.events.length,
                      })}
                    />
                  ))
                )}
              </div>
            )}

            {activeTab === "variations" && hasVariations && (
              <div
                style={{
                  background: colors.bgCard,
                  borderRadius: radius.card,
                  overflow: "hidden",
                  boxShadow: shadows.card,
                }}
              >
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {variationListWithCounts.map((v, i) => {
                    const isLast = i === variationListWithCounts.length - 1;
                    const rowStyle = {
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "12px 20px",
                      borderBottom: isLast
                        ? "none"
                        : `1px solid ${colors.borderFaint}`,
                      background: v.isCurrent
                        ? colors.primaryHoverBg
                        : "transparent",
                    } as const;
                    // Wrap title + pills in a single flex:1 container
                    // so the pills hug the title on the left instead
                    // of being pushed to the row's right edge by the
                    // title's own flex:1. The right-side count then
                    // sits on its own column at the row's end.
                    const inner = (
                      <>
                        <div
                          style={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            overflow: "hidden",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 700,
                              color: v.isCurrent
                                ? colors.primary
                                : colors.textPrimary,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {v.title}
                          </span>
                          {v.variantLabel ? (
                            <span
                              style={{
                                color: colors.variant,
                                background: colors.variantBg,
                                borderRadius: 10,
                                padding: "2px 8px",
                                fontSize: 10,
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {v.variantLabel}
                            </span>
                          ) : v.isBase ? (
                            <span
                              style={{
                                color: colors.primary,
                                background: colors.primaryBg,
                                borderRadius: 10,
                                padding: "2px 8px",
                                fontSize: 10,
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {t("baseVariant")}
                            </span>
                          ) : null}
                          {v.isCurrent && (
                            <span
                              style={{
                                color: colors.primary,
                                background: colors.primaryBg,
                                borderRadius: 10,
                                padding: "2px 8px",
                                fontSize: 10,
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {t("currentVariant")}
                            </span>
                          )}
                        </div>
                        <span
                          style={{
                            fontSize: 12,
                            color: colors.textMuted,
                            flexShrink: 0,
                          }}
                        >
                          {t("performanceCount", { count: v.timesPerformed })}
                        </span>
                        {!v.isCurrent && (
                          <span
                            aria-hidden="true"
                            style={{
                              fontSize: 13,
                              color: colors.borderSubtle,
                              flexShrink: 0,
                            }}
                          >
                            ›
                          </span>
                        )}
                      </>
                    );
                    return (
                      <li key={v.id}>
                        {v.isCurrent ? (
                          <div style={{ ...rowStyle, cursor: "default" }}>
                            {inner}
                          </div>
                        ) : (
                          <Link
                            href={`/${locale}/songs/${v.id}/${v.slug}`}
                            className="row-hover-bg"
                            style={{
                              ...rowStyle,
                              textDecoration: "none",
                              color: "inherit",
                            }}
                          >
                            {inner}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

interface SongRowTrailingProps {
  cells: SongPerformanceCells;
  encoreLabel: string;
}

function SongRowTrailing({ cells, encoreLabel }: SongRowTrailingProps) {
  return (
    <>
      {cells.isEncore && (
        <span
          style={{
            color: colors.variant,
            background: colors.variantBg,
            borderRadius: radius.chip,
            padding: "2px 8px",
            fontSize: 10,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {encoreLabel}
        </span>
      )}
      <span
        style={{
          color: colors.textSubtle,
          background: colors.borderLight,
          borderRadius: radius.chip,
          padding: "2px 8px",
          fontSize: 10,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        #{cells.position}
      </span>
      {cells.note && (
        <span
          style={{
            color: colors.textMuted,
            fontSize: 11,
            fontStyle: "italic",
            flexShrink: 0,
          }}
        >
          {cells.note}
        </span>
      )}
    </>
  );
}
