import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, formatDate } from "@/lib/utils";
import {
  displayNameWithFallback,
  displayOriginalName,
  resolveLocalizedField,
} from "@/lib/display";
import { deriveOgPaletteFromArtist } from "@/lib/ogPalette";
import { normalizeOgLocale } from "@/lib/ogLabels";
import { getEventStatus, type ResolvedEventStatus } from "@/lib/eventStatus";
import { Breadcrumb, type BreadcrumbItem } from "@/components/Breadcrumb";
import { InfoCard } from "@/components/InfoCard";
import { TabBar } from "@/components/TabBar";
import { SectionLabel } from "@/components/SectionLabel";
import { InitialAvatar } from "@/components/InitialAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import {
  PerformanceGroup,
  type PerformanceSeries,
  type PerformanceEvent,
} from "@/components/PerformanceGroup";
import { colors, radius, shadows } from "@/styles/tokens";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};

const TABS = ["overview", "history"] as const;
type TabKey = (typeof TABS)[number];

function resolveTab(value: string | string[] | undefined): TabKey {
  const v = Array.isArray(value) ? value[0] : value;
  return TABS.includes(v as TabKey) ? (v as TabKey) : "overview";
}

async function getArtist(id: bigint) {
  const artist = await prisma.artist.findFirst({
    where: { id, isDeleted: false },
    include: {
      translations: true,
      parentArtist: { include: { translations: true } },
      // Sub-units render as cards on the overview tab. `stageLinks`
      // on each sub-unit is what powers the per-unit member grouping
      // (members are linked to their unit via StageIdentityArtist).
      subArtists: {
        where: { isDeleted: false },
        include: {
          translations: true,
          stageLinks: {
            include: {
              stageIdentity: { include: { translations: true } },
            },
          },
        },
        orderBy: { id: "asc" },
      },
      // Direct stage-identity members (graduated + current). Each
      // links to a sub-unit via the subArtists.stageLinks join above —
      // resolved client-side after fetch.
      stageLinks: {
        include: {
          stageIdentity: {
            include: {
              translations: true,
              voicedBy: {
                where: { endDate: null },
                include: {
                  realPerson: { include: { translations: true } },
                },
              },
            },
          },
        },
      },
      // Performance history grouped by series. Each event includes
      // status + startTime so getEventStatus() can resolve the
      // ongoing/upcoming/completed/cancelled bucket without an extra
      // round trip.
      eventSeries: {
        where: { isDeleted: false },
        include: {
          translations: true,
          events: {
            where: { isDeleted: false },
            include: { translations: true },
            orderBy: { date: "desc" },
          },
        },
        orderBy: { id: "desc" },
      },
    },
  });
  if (!artist) return null;
  return serializeBigInt(artist);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const metaT = await getTranslations({ locale, namespace: "Meta" });
  if (!/^\d+$/.test(id)) return { title: metaT("notFound") };
  const artistId = BigInt(id);
  const [artist, palette] = await Promise.all([
    getArtist(artistId),
    deriveOgPaletteFromArtist(artistId),
  ]);
  if (!artist) return { title: metaT("notFound") };
  const fullName = displayNameWithFallback(
    artist,
    artist.translations,
    locale,
    "full",
  );
  const shortName = displayNameWithFallback(artist, artist.translations, locale);
  if (!fullName) return { title: "OpenSetlist" };

  const title = `${fullName} | OpenSetlist`;
  const description = `${shortName} ${metaT("setlistDb")}`;

  const ogImage = `/api/og/artist/${id}?lang=${normalizeOgLocale(locale)}&v=${palette.fingerprint}`;
  const pageUrl = `/${locale}/artists/${id}/${artist.slug}`;

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

export default async function ArtistPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const activeTab = resolveTab(sp.tab);

  let artistId: bigint;
  try {
    artistId = BigInt(id);
  } catch {
    notFound();
  }

  const artist = await getArtist(artistId);
  if (!artist) notFound();

  const [t, ct, evT] = await Promise.all([
    getTranslations("Artist"),
    getTranslations("Common"),
    getTranslations("Event"),
  ]);

  // Reference instant pinned at the top of the request so every event
  // status downstream resolves against the same `now` (per CLAUDE.md
  // UTC-only rule + matches the artists-list-redesign pattern).
  const referenceNow = new Date();

  const { main: artistMain, sub: artistSub } = displayOriginalName(
    artist,
    artist.translations,
    locale,
  );
  const bio = resolveLocalizedField(
    artist,
    artist.translations,
    locale,
    "bio",
    "originalBio",
  );
  const parentName = artist.parentArtist
    ? displayNameWithFallback(
        artist.parentArtist,
        artist.parentArtist.translations,
        locale,
      )
    : null;

  // Map: stageIdentityId → owning sub-unit. Powers the per-member
  // unit-color treatment without a second pass over subArtists at
  // render time. Members not in any sub-unit (group-level
  // stage-link only) get a `null` unit and render in muted gray.
  type Unit = (typeof artist.subArtists)[number];
  const memberToUnit = new Map<string, Unit>();
  for (const sub of artist.subArtists) {
    for (const sl of sub.stageLinks) {
      memberToUnit.set(sl.stageIdentity.id, sub);
    }
  }

  // Sub-unit list (units only — solos rendered separately if/when
  // we add a Songs tab). Empty for unit-type artists themselves.
  const subUnits = artist.subArtists.filter((s) => s.type === "unit");

  // Stats: total events + completed events across all eventSeries.
  // `getEventStatus()` resolves the displayed status from raw status
  // + startTime — never trust raw `event.status === "completed"`,
  // which is wrong for events whose DB status is `scheduled` but
  // whose startTime is in the past (auto-resolved to `ongoing` /
  // `completed` per the 12h window in eventStatus.ts).
  let totalEvents = 0;
  let totalCompleted = 0;
  for (const series of artist.eventSeries) {
    for (const event of series.events) {
      totalEvents += 1;
      if (
        getEventStatus(
          { status: event.status, startTime: event.startTime },
          referenceNow,
        ) === "completed"
      ) {
        totalCompleted += 1;
      }
    }
  }

  const tabs = [
    { key: "overview", label: t("tabOverview") },
    { key: "history", label: t("tabHistory", { count: totalEvents }) },
  ];

  // Resolved status labels passed to <PerformanceGroup>; the component
  // itself is locale-free so the label dictionary lives here.
  const statusLabels: Record<ResolvedEventStatus, string> = {
    ongoing: evT("status.ongoing"),
    upcoming: evT("status.upcoming"),
    completed: evT("status.completed"),
    cancelled: evT("status.cancelled"),
  };

  // Build a flat per-event view-model first, then group by series.
  // Doing it this way means the recent-3 list (Overview tab) and the
  // per-series collapsible groups (History tab) read from the same
  // source — no duplicated date-formatting / status-resolving logic.
  type EventView = PerformanceEvent & {
    seriesId: number;
    rawDateMs: number;
  };
  const eventViews: EventView[] = [];
  for (const series of artist.eventSeries) {
    for (const event of series.events) {
      const status = getEventStatus(
        { status: event.status, startTime: event.startTime },
        referenceNow,
      );
      eventViews.push({
        // serializeBigInt coerces every id to number at runtime; the
        // String() cast satisfies PerformanceEvent's id contract
        // without leaking the bigint type out of the JSON shape.
        id: String(event.id),
        seriesId: Number(series.id),
        status,
        formattedDate: formatDate(event.date, locale),
        name:
          displayNameWithFallback(event, event.translations, locale) ||
          evT("unknownEvent"),
        href: `/${locale}/events/${event.id}/${event.slug}`,
        // serializeBigInt also runs JSON.stringify, which converts
        // Date columns to ISO strings — so the runtime value is a
        // string here even though Prisma's type still says Date.
        // String() coerces uniformly without an `as` cast.
        rawDateMs: new Date(String(event.date)).getTime(),
      });
    }
  }

  // Group by series for the History tab. Pin any series with an
  // ongoing event to the top; remainder by most-recent event date
  // desc.
  const seriesViews: PerformanceSeries[] = artist.eventSeries
    .map((series) => {
      const seriesEvents = eventViews.filter(
        (ev) => ev.seriesId === Number(series.id),
      );
      // Within a series, keep the operator-specified date-desc order.
      seriesEvents.sort((a, b) => b.rawDateMs - a.rawDateMs);
      const hasOngoing = seriesEvents.some((e) => e.status === "ongoing");
      const mostRecentMs = seriesEvents.reduce(
        (m, e) => (e.rawDateMs > m ? e.rawDateMs : m),
        0,
      );
      return {
        seriesId: String(series.id),
        seriesShort:
          displayNameWithFallback(series, series.translations, locale) ||
          evT("unknownEvent"),
        hasOngoing,
        events: seriesEvents,
        sortKey: hasOngoing ? Number.MAX_SAFE_INTEGER : mostRecentMs,
      };
    })
    .sort(
      (a, b) =>
        (b as { sortKey: number }).sortKey -
        (a as { sortKey: number }).sortKey,
    )
    // Strip the temporary sortKey to honor the declared
    // PerformanceSeries shape — explicit field-by-field copy avoids
    // the unused `_` discard binding that no-unused-vars warns on.
    .map((s) => ({
      seriesId: s.seriesId,
      seriesShort: s.seriesShort,
      hasOngoing: s.hasOngoing,
      events: s.events,
    }));

  // Recent-3 preview for the Overview tab — newest events across the
  // entire artist, regardless of series.
  // Strip the temporary `rawDateMs` and `seriesId` fields back to the
  // declared PerformanceEvent shape — explicit field copy avoids the
  // unused `_` discard pattern that triggers no-unused-vars.
  const recentEvents: PerformanceEvent[] = [...eventViews]
    .sort((a, b) => b.rawDateMs - a.rawDateMs)
    .slice(0, 3)
    .map((e) => ({
      id: e.id,
      status: e.status,
      formattedDate: e.formattedDate,
      name: e.name,
      href: e.href,
    }));

  return (
    <main
      style={{
        minHeight: "100vh",
        background: colors.bgPage,
      }}
    >
      <div className="mx-auto" style={{ maxWidth: 1100, padding: "0 16px" }}>
        <Breadcrumb
          ariaLabel={ct("breadcrumb")}
          items={[
            { label: ct("backToHome"), href: "/" },
            ...(artist.parentArtist && parentName
              ? [
                  {
                    label: parentName,
                    href: `/artists/${artist.parentArtist.id}/${artist.parentArtist.slug}`,
                  } satisfies BreadcrumbItem,
                ]
              : []),
            { label: artistMain || t("unknown") },
          ]}
        />

        <div className="grid lg:grid-cols-[280px_1fr] lg:gap-7" style={{ alignItems: "start", paddingBottom: 60 }}>
          {/* Sidebar (mobile: stacked above tabs; desktop: sticky 280px column) */}
          <div className="lg:sticky lg:top-[72px]" style={{ marginBottom: 12 }}>
            <InfoCard artist={artist}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  color: colors.primary,
                  background: colors.primaryBg,
                  borderRadius: 10,
                  padding: "2px 8px",
                  textTransform: "uppercase",
                }}
              >
                {t(`type.${artist.type}`)}
              </span>
              <h1
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: colors.textPrimary,
                  lineHeight: 1.35,
                  marginTop: 10,
                  marginBottom: artistSub ? 6 : 14,
                }}
              >
                {artistMain || t("unknown")}
              </h1>
              {artistSub && (
                <div
                  style={{
                    fontSize: 12,
                    color: colors.textMuted,
                    marginBottom: 14,
                  }}
                >
                  {artistSub}
                </div>
              )}
              {bio && (
                <p
                  style={{
                    fontSize: 13,
                    color: colors.textSecondary,
                    lineHeight: 1.7,
                    marginBottom: 18,
                  }}
                >
                  {bio}
                </p>
              )}
              <div style={{ display: "flex", gap: 20 }}>
                <div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: colors.textPrimary,
                    }}
                  >
                    {totalEvents}
                  </div>
                  <div style={{ fontSize: 11, color: colors.textMuted }}>
                    {t("statsTotalEvents")}
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: colors.textPrimary,
                    }}
                  >
                    {totalCompleted}
                  </div>
                  <div style={{ fontSize: 11, color: colors.textMuted }}>
                    {t("statsCompleted")}
                  </div>
                </div>
                {subUnits.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: colors.textPrimary,
                      }}
                    >
                      {subUnits.length}
                    </div>
                    <div style={{ fontSize: 11, color: colors.textMuted }}>
                      {t("statsSubUnits")}
                    </div>
                  </div>
                )}
              </div>
            </InfoCard>
          </div>

          {/* Main content */}
          <div>
            <TabBar
              tabs={tabs}
              active={activeTab}
              ariaLabel={ct("tabsAriaLabel")}
            />

            {activeTab === "overview" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {subUnits.length > 0 && (
                  <section
                    style={{
                      background: colors.bgCard,
                      borderRadius: radius.card,
                      padding: "18px 20px",
                      boxShadow: shadows.card,
                    }}
                  >
                    <SectionLabel>{t("subUnits")}</SectionLabel>
                    <div
                      style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
                    >
                      {subUnits.map((unit) => {
                        const unitName =
                          displayNameWithFallback(
                            unit,
                            unit.translations,
                            locale,
                          ) || t("unknown");
                        const unitColor = unit.color ?? colors.textMuted;
                        const unitMembers = unit.stageLinks.map((sl) => {
                          const memberName =
                            displayNameWithFallback(
                              sl.stageIdentity,
                              sl.stageIdentity.translations,
                              locale,
                            ) || t("unknownMember");
                          return memberName;
                        });
                        return (
                          <Link
                            key={unit.id}
                            href={`/${locale}/artists/${unit.id}/${unit.slug}`}
                            style={{
                              display: "block",
                              textDecoration: "none",
                              color: "inherit",
                              border: `1.5px solid ${colors.border}`,
                              borderRadius: 14,
                              padding: "14px 16px",
                              background: colors.bgCard,
                              flex: "1 1 140px",
                              minWidth: 0,
                              transition: "border-color 0.12s ease",
                            }}
                          >
                            <div
                              style={{
                                width: 4,
                                height: 18,
                                borderRadius: 2,
                                background: unitColor,
                                marginBottom: 10,
                              }}
                            />
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 700,
                                color: unitColor,
                                marginBottom: 6,
                              }}
                            >
                              {unitName}
                            </div>
                            <div
                              style={{
                                display: "flex",
                                gap: 4,
                                flexWrap: "wrap",
                              }}
                            >
                              {unitMembers.map((m, i) => (
                                <span
                                  key={i}
                                  style={{
                                    fontSize: 11,
                                    color: colors.textSecondary,
                                    background: colors.bgSubtle,
                                    borderRadius: radius.chip,
                                    padding: "2px 7px",
                                  }}
                                >
                                  {m}
                                </span>
                              ))}
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                )}

                {artist.stageLinks.length > 0 && (
                  <section
                    style={{
                      background: colors.bgCard,
                      borderRadius: radius.card,
                      padding: "18px 20px",
                      boxShadow: shadows.card,
                    }}
                  >
                    <SectionLabel>
                      {t("membersWithCount", {
                        count: artist.stageLinks.length,
                      })}
                    </SectionLabel>
                    <div
                      style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                    >
                      {artist.stageLinks.map((sl) => {
                        const owningUnit = memberToUnit.get(
                          sl.stageIdentity.id,
                        );
                        const unitColor =
                          owningUnit?.color ??
                          sl.stageIdentity.color ??
                          colors.textMuted;
                        const unitName = owningUnit
                          ? displayNameWithFallback(
                              owningUnit,
                              owningUnit.translations,
                              locale,
                            )
                          : null;
                        const memberName =
                          displayNameWithFallback(
                            sl.stageIdentity,
                            sl.stageIdentity.translations,
                            locale,
                          ) || t("unknownMember");
                        return (
                          <Link
                            key={sl.id}
                            href={`/${locale}/members/${sl.stageIdentity.id}/${sl.stageIdentity.slug}`}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              background: colors.bgSubtle,
                              border: `1px solid ${colors.borderLight}`,
                              borderRadius: 12,
                              padding: "8px 12px",
                              flex: "1 1 140px",
                              minWidth: 0,
                              textDecoration: "none",
                              color: "inherit",
                              transition: "all 0.12s ease",
                            }}
                          >
                            <InitialAvatar
                              label={memberName}
                              color={unitColor}
                              size={32}
                            />
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 700,
                                  color: colors.textPrimary,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {memberName}
                              </div>
                              {unitName && (
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: unitColor,
                                  }}
                                >
                                  {unitName}
                                </div>
                              )}
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                )}

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
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: colors.textMuted,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                      }}
                    >
                      {t("recentEvents")}
                    </span>
                    {totalEvents > recentEvents.length && (
                      <Link
                        href={`/${locale}/artists/${artist.id}/${artist.slug}?tab=history`}
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
                            width: 52,
                            flexShrink: 0,
                          }}
                        >
                          {event.formattedDate}
                        </span>
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: colors.primary,
                            flex: 1,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {event.name}
                        </span>
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
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: colors.textMuted,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    {t("historyHeader", { count: totalEvents })}
                  </span>
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
                  seriesViews.map((sv) => (
                    <PerformanceGroup
                      key={sv.seriesId}
                      series={sv}
                      statusLabels={statusLabels}
                      eventCountLabel={t("eventCount", {
                        count: sv.events.length,
                      })}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
