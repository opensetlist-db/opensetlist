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
import { displayName, displayOriginalTitle } from "@/lib/display";
import type { Metadata } from "next";

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

async function getArtist(id: bigint, locale: string) {
  const artist = await prisma.artist.findFirst({
    where: { id, isDeleted: false },
    include: {
      translations: true,
      subArtists: {
        where: { isDeleted: false },
        include: { translations: true },
      },
      parentArtist: {
        include: { translations: true },
      },
      groupLinks: {
        include: {
          group: { include: { translations: true } },
        },
      },
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
      songCredits: {
        include: {
          song: {
            include: { translations: true },
          },
        },
        take: 50,
      },
    },
  });
  if (!artist) return null;
  return serializeBigInt(artist);
}

async function getArtistEvents(artistId: bigint, locale: string) {
  // Find events where this artist's members performed
  const events = await prisma.event.findMany({
    where: {
      isDeleted: false,
      setlistItems: {
        some: {
          isDeleted: false,
          songs: {
            some: {
              song: {
                artists: { some: { artistId } },
              },
            },
          },
        },
      },
    },
    include: {
      translations: true,
      eventSeries: { include: { translations: true } },
    },
    orderBy: { date: "desc" },
    take: 50,
  });
  return serializeBigInt(events);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const artistId = BigInt(id);
  const artist = await getArtist(artistId, locale);
  if (!artist) return { title: "Not Found" };
  const t = pickTranslation(artist.translations, locale);
  if (!t) return { title: "OpenSetlist" };

  const title = `${displayName(t, "full")} | OpenSetlist`;
  const description = `${displayName(t)} 공연 셋리스트 데이터베이스`;

  const ogImage = `/api/og/artist/${id}`;
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

export default async function ArtistPage({ params }: Props) {
  const { locale, id } = await params;

  let artistId: bigint;
  try {
    artistId = BigInt(id);
  } catch {
    notFound();
  }

  const [artist, events] = await Promise.all([
    getArtist(artistId, locale),
    getArtistEvents(artistId, locale),
  ]);

  if (!artist) notFound();

  const t = await getTranslations("Artist");
  const ct = await getTranslations("Common");
  const tr = pickTranslation(artist.translations, locale);
  const parentTr = artist.parentArtist
    ? pickTranslation(artist.parentArtist.translations, locale)
    : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-4 text-sm text-zinc-500">
        <Link href={`/${locale}`} className="hover:underline">
          {ct("backToHome")}
        </Link>
        {artist.parentArtist && parentTr && (
          <>
            {" / "}
            <Link
              href={`/${locale}/artists/${artist.parentArtist.id}/${slugify(parentTr.name)}`}
              className="hover:underline"
            >
              {parentTr.name}
            </Link>
          </>
        )}
      </nav>

      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold">{tr?.name ?? "Unknown Artist"}</h1>
        <p className="mt-1 text-zinc-500">
          {t(`type.${artist.type}`)}
          {artist.parentArtist && parentTr && (
            <> · {parentTr.name}</>
          )}
        </p>
        {tr?.bio && <p className="mt-4 text-zinc-700">{tr.bio}</p>}
      </header>

      {/* Groups */}
      {artist.groupLinks.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">{t("groups")}</h2>
          <div className="flex flex-wrap gap-2">
            {artist.groupLinks.map((gl) => {
              const gTr = pickTranslation(gl.group.translations, locale);
              return (
                <span
                  key={gl.id}
                  className="rounded-full bg-zinc-100 px-3 py-1 text-sm"
                >
                  {gTr?.name ?? "Unknown"}
                </span>
              );
            })}
          </div>
        </section>
      )}

      {/* Members (Stage Identities) */}
      {artist.stageLinks.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">{t("members")}</h2>
          <ul className="space-y-2">
            {artist.stageLinks.map((sl) => {
              const siTr = pickTranslation(
                sl.stageIdentity.translations,
                locale
              );
              const va = sl.stageIdentity.voicedBy[0];
              const vaTr = va
                ? pickTranslation(va.realPerson.translations, locale)
                : null;
              return (
                <li key={sl.id} className="flex items-center gap-2">
                  {sl.stageIdentity.color && (
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: sl.stageIdentity.color }}
                    />
                  )}
                  <span className="font-medium">
                    {siTr?.name ?? "Unknown"}
                  </span>
                  {vaTr && (
                    <span className="text-sm text-zinc-500">
                      (CV: {vaTr.stageName ?? vaTr.name})
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Sub-units */}
      {artist.subArtists.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">{t("subUnits")}</h2>
          <ul className="space-y-1">
            {artist.subArtists.map((sub) => {
              const subTr = pickTranslation(sub.translations, locale);
              return (
                <li key={sub.id}>
                  <Link
                    href={`/${locale}/artists/${sub.id}/${slugify(subTr?.name ?? "")}`}
                    className="text-blue-600 hover:underline"
                  >
                    {subTr?.name ?? "Unknown"}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Songs */}
      {artist.songCredits.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">{t("songs")}</h2>
          <ul className="space-y-1">
            {artist.songCredits.map((sc) => {
              const songTr = pickTranslation(sc.song.translations, locale);
              const { main, sub } = displayOriginalTitle(sc.song, songTr ?? null, locale);
              return (
                <li key={sc.id}>
                  <Link
                    href={`/${locale}/songs/${sc.song.id}/${slugify(main)}`}
                    className="text-blue-600 hover:underline"
                  >
                    {main}
                  </Link>
                  {sub && (
                    <span className="ml-1 text-sm text-zinc-400">
                      {sub}
                    </span>
                  )}
                  {sc.song.variantLabel && (
                    <span className="ml-1 text-sm text-zinc-500">
                      ({sc.song.variantLabel})
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Event History */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold">{t("eventHistory")}</h2>
        {events.length === 0 ? (
          <p className="text-zinc-500">{t("noEvents")}</p>
        ) : (
          <ul className="space-y-2">
            {events.map((event) => {
              const evTr = pickTranslation(event.translations, locale);
              const seriesTr = event.eventSeries
                ? pickTranslation(event.eventSeries.translations, locale)
                : null;
              return (
                <li key={event.id} className="flex items-baseline gap-3">
                  <span className="shrink-0 text-sm text-zinc-400">
                    {formatDate(event.date, locale)}
                  </span>
                  <Link
                    href={`/${locale}/events/${event.id}/${slugify(evTr?.name ?? "")}`}
                    className="text-blue-600 hover:underline"
                  >
                    {evTr?.name ?? "Unknown Event"}
                  </Link>
                  {seriesTr && (
                    <span className="text-sm text-zinc-500">
                      ({seriesTr.name})
                    </span>
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
