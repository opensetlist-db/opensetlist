import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  serializeBigInt,
  formatDate,
} from "@/lib/utils";
import {
  displayNameWithFallback,
  displayOriginalName,
  resolveLocalizedField,
} from "@/lib/display";
import { getEventStatus } from "@/lib/eventStatus";
import { StatusBadge } from "@/components/StatusBadge";
import { Breadcrumb, type BreadcrumbItem } from "@/components/Breadcrumb";
import type { Metadata } from "next";

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

async function getEventSeries(id: bigint, locale: string) {
  const series = await prisma.eventSeries.findFirst({
    where: { id, isDeleted: false },
    include: {
      translations: true,
      artist: { include: { translations: true } },
      parentSeries: { include: { translations: true } },
      childSeries: {
        where: { isDeleted: false },
        include: { translations: true },
        orderBy: { createdAt: "asc" },
      },
      events: {
        where: { isDeleted: false },
        include: { translations: true },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
      },
    },
  });
  if (!series) return null;
  return serializeBigInt(series);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const series = await getEventSeries(BigInt(id), locale);
  if (!series) return { title: "Not Found" };
  const seriesName = displayNameWithFallback(series, series.translations, locale, "full");
  const description = resolveLocalizedField(
    series,
    series.translations,
    locale,
    "description",
    "originalDescription"
  );
  return {
    title: seriesName ? `${seriesName} | OpenSetlist` : "OpenSetlist",
    description: description ?? undefined,
  };
}

export default async function EventSeriesPage({ params }: Props) {
  const { locale, id } = await params;

  let seriesId: bigint;
  try {
    seriesId = BigInt(id);
  } catch {
    notFound();
  }

  const series = await getEventSeries(seriesId, locale);
  if (!series) notFound();

  const t = await getTranslations("EventSeries");
  const ct = await getTranslations("Common");
  const evT = await getTranslations("Event");
  const { main: seriesMain, sub: seriesSub } = displayOriginalName(
    series,
    series.translations,
    locale
  );
  const description = resolveLocalizedField(
    series,
    series.translations,
    locale,
    "description",
    "originalDescription"
  );
  const artistName = series.artist
    ? displayNameWithFallback(series.artist, series.artist.translations, locale)
    : null;
  const parentName = series.parentSeries
    ? displayNameWithFallback(
        series.parentSeries,
        series.parentSeries.translations,
        locale
      )
    : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Breadcrumb
        items={[
          { label: ct("backToHome"), href: "/" },
          ...(series.parentSeries
            ? [
                {
                  label: parentName || t("unknownSeries"),
                  href: `/series/${series.parentSeries.id}/${series.parentSeries.slug}`,
                } satisfies BreadcrumbItem,
              ]
            : []),
        ]}
      />

      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold">
          {seriesMain || t("unknownSeries")}
          {seriesSub && (
            <span className="ml-2 text-xl font-normal text-zinc-500">
              {seriesSub}
            </span>
          )}
        </h1>
        <div className="mt-2 flex flex-wrap gap-3 text-sm text-zinc-500">
          <span>{t(`type.${series.type}`)}</span>
          {artistName && (
            <Link
              href={`/${locale}/artists/${series.artist!.id}/${series.artist!.slug}`}
              className="text-blue-600 hover:underline"
            >
              {artistName}
            </Link>
          )}
          {series.organizerName && (
            <span>
              {t("organizer")}: {series.organizerName}
            </span>
          )}
        </div>
        {description && (
          <p className="mt-4 text-zinc-700">{description}</p>
        )}
      </header>

      {/* Child Series */}
      {series.childSeries.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">{ct("series")}</h2>
          <ul className="space-y-1">
            {series.childSeries.map((child) => {
              const childName = displayNameWithFallback(child, child.translations, locale);
              return (
                <li key={child.id}>
                  <Link
                    href={`/${locale}/series/${child.id}/${child.slug}`}
                    className="text-blue-600 hover:underline"
                  >
                    {childName || t("unknownSeries")}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Events */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold">{t("events")}</h2>
        {series.events.length === 0 ? (
          <p className="text-zinc-500">{t("noEvents")}</p>
        ) : (
          <ul className="space-y-4">
            {series.events.map((event) => {
              const evName = displayNameWithFallback(
                event,
                event.translations,
                locale,
                "full"
              );
              const venue = resolveLocalizedField(
                event,
                event.translations,
                locale,
                "venue",
                "originalVenue"
              );
              const city = resolveLocalizedField(
                event,
                event.translations,
                locale,
                "city",
                "originalCity"
              );
              return (
                <li key={event.id}>
                  <div className="flex items-baseline gap-3">
                    {event.date && (
                      <span className="shrink-0 text-sm text-zinc-400">
                        {formatDate(event.date, locale)}
                      </span>
                    )}
                    <Link
                      href={`/${locale}/events/${event.id}/${event.slug}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {evName || evT("unknownEvent")}
                    </Link>
                    {(() => {
                      const status = getEventStatus(event);
                      return (
                        <StatusBadge
                          status={status}
                          label={evT(`status.${status}`)}
                        />
                      );
                    })()}
                  </div>
                  {(venue || city) && (
                    <p className="ml-9 text-sm text-zinc-500">
                      {[venue, city].filter(Boolean).join(", ")}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
