import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  serializeBigInt,
  pickLocaleTranslation,
  formatDate,
} from "@/lib/utils";
import {
  displayNameWithFallback,
  displayOriginalName,
  displayOriginalTitle,
} from "@/lib/display";
import type { Metadata } from "next";

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

async function getMember(id: string) {
  const member = await prisma.stageIdentity.findUnique({
    where: { id },
    include: {
      translations: true,
      voicedBy: {
        include: {
          realPerson: { include: { translations: true } },
        },
      },
      artistLinks: {
        include: {
          artist: { include: { translations: true } },
        },
        orderBy: { startDate: "asc" },
      },
    },
  });
  if (!member) return null;
  return serializeBigInt(member);
}

async function getMemberPerformances(stageIdentityId: string) {
  const performances = await prisma.setlistItemMember.findMany({
    where: {
      stageIdentityId,
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
          songs: {
            include: {
              song: { include: { translations: true } },
            },
          },
        },
      },
    },
    orderBy: { setlistItem: { event: { date: "desc" } } },
    take: 100,
  });
  return serializeBigInt(performances);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const member = await getMember(id);
  if (!member) return { title: "Not Found" };
  const name =
    displayNameWithFallback(member, member.translations, locale, "full") ||
    "Unknown";

  const title = `${name} | OpenSetlist`;
  const mt = await getTranslations({ locale, namespace: "Meta" });
  const description = `${name} ${mt("performanceHistory")}`;
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

export default async function MemberPage({ params }: Props) {
  const { locale, id } = await params;

  const [member, performances] = await Promise.all([
    getMember(id),
    getMemberPerformances(id),
  ]);

  if (!member) notFound();

  const t = await getTranslations("Member");
  const ct = await getTranslations("Common");
  const et = await getTranslations("Event");
  const { main: name, sub: subName, shortName } = displayOriginalName(
    member,
    member.translations,
    locale
  );

  // CV info
  const va = member.voicedBy[0];
  const vaTr = va
    ? pickLocaleTranslation(va.realPerson.translations, locale)
    : null;
  const vaName = va
    ? vaTr?.stageName ||
      vaTr?.name ||
      va.realPerson.originalStageName ||
      va.realPerson.originalName ||
      null
    : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-4 text-sm text-zinc-500">
        <Link href={`/${locale}`} className="hover:underline">
          {ct("backToHome")}
        </Link>
      </nav>

      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-3">
          {member.color && (
            <span
              className="inline-block h-4 w-4 rounded-full"
              style={{ backgroundColor: member.color }}
            />
          )}
          <h1 className="text-3xl font-bold">{name || "Unknown"}</h1>
          {shortName && shortName !== name && (
            <span className="text-xl text-zinc-500">({shortName})</span>
          )}
        </div>
        {subName && (
          <p className="mt-1 text-lg text-zinc-500">{subName}</p>
        )}
        {vaName && (
          <p className="mt-2 text-sm text-zinc-500">
            CV: {vaName}
          </p>
        )}
      </header>

      {/* Artist affiliations — units */}
      {member.artistLinks.filter((l) => l.artist.type === "unit").length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">{t("units")}</h2>
          <ul className="space-y-2">
            {member.artistLinks
              .filter((l) => l.artist.type === "unit")
              .map((link) => {
                const aName = displayNameWithFallback(
                  link.artist,
                  link.artist.translations,
                  locale
                );
                const period = [
                  link.startDate ? formatDate(link.startDate, locale) : null,
                  link.endDate ? formatDate(link.endDate, locale) : t("present"),
                ];
                const periodStr = link.startDate
                  ? `${period[0]} ~ ${period[1]}`
                  : null;
                return (
                  <li key={link.id} className="flex items-baseline gap-2">
                    <Link
                      href={`/${locale}/artists/${link.artist.id}/${link.artist.slug}`}
                      className="text-blue-600 hover:underline"
                    >
                      {aName || "Unknown"}
                    </Link>
                    {periodStr && (
                      <span className="text-sm text-zinc-400">{periodStr}</span>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      )}

      {/* Artist affiliations — solos */}
      {member.artistLinks.filter((l) => l.artist.type === "solo").length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">{t("solos")}</h2>
          <ul className="space-y-2">
            {member.artistLinks
              .filter((l) => l.artist.type === "solo")
              .map((link) => {
                const aName = displayNameWithFallback(
                  link.artist,
                  link.artist.translations,
                  locale
                );
                return (
                  <li key={link.id}>
                    <Link
                      href={`/${locale}/artists/${link.artist.id}/${link.artist.slug}`}
                      className="text-blue-600 hover:underline"
                    >
                      {aName || "Unknown"}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </section>
      )}

      {/* Performance History */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold">{t("performanceHistory")}</h2>
        {performances.length === 0 ? (
          <p className="text-zinc-500">{t("noPerformances")}</p>
        ) : (
          <ul className="space-y-3">
            {performances.map((p) => {
              const event = p.setlistItem.event;
              const evName = displayNameWithFallback(
                event,
                event.translations,
                locale
              );
              const seriesName = event.eventSeries
                ? displayNameWithFallback(
                    event.eventSeries,
                    event.eventSeries.translations,
                    locale
                  )
                : null;
              const linkLabel = seriesName || evName || et("unknownEvent");
              const songNames = p.setlistItem.songs
                .map((s) => {
                  const { main } = displayOriginalTitle(s.song, s.song.translations, locale);
                  return main;
                })
                .filter(Boolean);
              return (
                <li key={p.id} className="border-b border-zinc-100 pb-2">
                  <div className="flex items-baseline gap-3">
                    <span className="shrink-0 text-sm text-zinc-400">
                      {formatDate(event.date, locale)}
                    </span>
                    <Link
                      href={`/${locale}/events/${event.id}/${event.slug}`}
                      className="text-blue-600 hover:underline"
                    >
                      {linkLabel}
                    </Link>
                    {seriesName && evName && seriesName !== evName && (
                      <span className="text-sm text-zinc-500">
                        ({evName})
                      </span>
                    )}
                  </div>
                  {songNames.length > 0 && (
                    <p className="mt-1 text-sm text-zinc-500">
                      {songNames.join(", ")}
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
