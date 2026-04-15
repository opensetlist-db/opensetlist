import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  serializeBigInt,
  pickTranslation,
  slugify,
  formatDate,
} from "@/lib/utils";
import { displayOriginalTitle } from "@/lib/display";
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
          event: { include: { translations: true } },
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
  const tr = pickTranslation(member.translations, locale);
  const name = tr?.name ?? "Unknown";

  const title = `${name} | OpenSetlist`;
  const mt = await getTranslations("Meta");
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
  const tr = pickTranslation(member.translations, locale);
  const name = tr?.name ?? "Unknown";
  const shortName = tr?.shortName ?? null;

  // Sub line: show original language name if different from display
  const jaTr = pickTranslation(member.translations, "ja");
  const showJaSub = locale !== "ja" && jaTr && jaTr.name !== name;

  // CV info
  const va = member.voicedBy[0];
  const vaTr = va
    ? pickTranslation(va.realPerson.translations, locale)
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
          <h1 className="text-3xl font-bold">{name}</h1>
          {shortName && shortName !== name && (
            <span className="text-xl text-zinc-500">({shortName})</span>
          )}
        </div>
        {showJaSub && (
          <p className="mt-1 text-lg text-zinc-500">{jaTr!.name}</p>
        )}
        {vaTr && (
          <p className="mt-2 text-sm text-zinc-500">
            CV: {vaTr.stageName ?? vaTr.name}
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
                const aTr = pickTranslation(link.artist.translations, locale);
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
                      href={`/${locale}/artists/${link.artist.id}/${slugify(aTr?.name ?? "")}`}
                      className="text-blue-600 hover:underline"
                    >
                      {aTr?.name ?? "Unknown"}
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
                const aTr = pickTranslation(link.artist.translations, locale);
                return (
                  <li key={link.id}>
                    <Link
                      href={`/${locale}/artists/${link.artist.id}/${slugify(aTr?.name ?? "")}`}
                      className="text-blue-600 hover:underline"
                    >
                      {aTr?.name ?? "Unknown"}
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
              const evTr = pickTranslation(event.translations, locale);
              const songNames = p.setlistItem.songs
                .map((s) => {
                  const sTr = pickTranslation(s.song.translations, locale);
                  const { main } = displayOriginalTitle(s.song, sTr ?? null, locale);
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
                      href={`/${locale}/events/${event.id}/${slugify(evTr?.name ?? "")}`}
                      className="text-blue-600 hover:underline"
                    >
                      {evTr?.name ?? "Unknown Event"}
                    </Link>
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
