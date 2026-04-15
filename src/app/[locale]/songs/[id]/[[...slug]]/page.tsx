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

async function getSong(id: bigint, locale: string) {
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
        include: { translations: true },
      },
    },
  });
  if (!song) return null;
  return serializeBigInt(song);
}

async function getSongAlbums(songId: bigint) {
  const tracks = await prisma.albumTrack.findMany({
    where: { songId },
    include: {
      album: {
        include: { translations: true },
      },
    },
    orderBy: { album: { releaseDate: "asc" } },
  });
  return serializeBigInt(tracks);
}

async function getSongPerformances(songId: bigint) {
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
          performers: {
            include: {
              stageIdentity: { include: { translations: true } },
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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const song = await getSong(BigInt(id), locale);
  if (!song) return { title: "Not Found" };
  const tr = pickTranslation(song.translations, locale);
  const artistTr = song.artists[0]
    ? pickTranslation(song.artists[0].artist.translations, locale)
    : null;

  const songTitle = tr?.title ?? song.originalTitle;
  const metaVariant = tr?.variantLabel || song.variantLabel;
  const title = `${songTitle}${metaVariant ? ` (${metaVariant})` : ""} | OpenSetlist`;
  const mt = await getTranslations({ locale, namespace: "Meta" });
  const description = artistTr
    ? `${displayName(artistTr)} · ${mt("performanceHistory")}`
    : mt("performanceHistory");

  const ogImage = `/api/og/song/${id}`;
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

export default async function SongPage({ params }: Props) {
  const { locale, id } = await params;

  let songId: bigint;
  try {
    songId = BigInt(id);
  } catch {
    notFound();
  }

  const [song, albumTracks, performances] = await Promise.all([
    getSong(songId, locale),
    getSongAlbums(songId),
    getSongPerformances(songId),
  ]);

  if (!song) notFound();

  const t = await getTranslations("Song");
  const ct = await getTranslations("Common");
  const et = await getTranslations("Event");
  const tr = pickTranslation(song.translations, locale);
  const { main, sub, variant } = displayOriginalTitle(song, tr ?? null, locale);

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
        <h1 className="text-3xl font-bold">
          {main}
          {variant && (
            <span className="ml-2 text-xl font-normal text-zinc-500">
              ({variant})
            </span>
          )}
        </h1>
        {sub && (
          <p className="mt-1 text-lg text-zinc-500">
            {sub}
          </p>
        )}
        {song.releaseDate && (
          <p className="mt-1 text-sm text-zinc-500">
            {t("releaseDate")}: {formatDate(song.releaseDate, locale)}
          </p>
        )}
      </header>

      {/* Artists */}
      {song.artists.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">{t("artists")}</h2>
          <ul className="space-y-1">
            {song.artists.map((sa) => {
              const aTr = pickTranslation(sa.artist.translations, locale);
              return (
                <li key={sa.id} className="flex items-center gap-2">
                  <Link
                    href={`/${locale}/artists/${sa.artist.id}/${slugify(aTr?.name ?? "")}`}
                    className="text-blue-600 hover:underline"
                  >
                    {aTr?.name ?? "Unknown"}
                  </Link>
                  {sa.role !== "primary" && (
                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs">
                      {t(`role.${sa.role}`)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Base version link */}
      {song.baseVersion && (
        <section className="mb-8">
          <p className="text-sm text-zinc-500">
            {t("baseVersion")}:{" "}
            <Link
              href={`/${locale}/songs/${song.baseVersion.id}/${slugify(
                pickTranslation(song.baseVersion.translations, locale)?.title ??
                  song.baseVersion.originalTitle
              )}`}
              className="text-blue-600 hover:underline"
            >
              {pickTranslation(song.baseVersion.translations, locale)?.title ??
                song.baseVersion.originalTitle}
            </Link>
          </p>
        </section>
      )}

      {/* Variants */}
      {song.variants.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">{t("otherVersions")}</h2>
          <ul className="space-y-1">
            {song.variants.map((v) => {
              const vTr = pickTranslation(v.translations, locale);
              const vTitle = vTr?.title ?? v.originalTitle;
              const vVariant = vTr?.variantLabel || v.variantLabel;
              return (
                <li key={v.id}>
                  <Link
                    href={`/${locale}/songs/${v.id}/${slugify(vTitle)}`}
                    className="text-blue-600 hover:underline"
                  >
                    {vTitle}
                    {vVariant && (
                      <span className="ml-1 text-sm text-zinc-500">
                        ({vVariant})
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Album Tracks */}
      {albumTracks.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">{t("albumTracks")}</h2>
          <ul className="space-y-2">
            {albumTracks.map((at) => {
              const album = at.album;
              const albumTr = pickTranslation(album.translations, locale);
              const { main: albumName, sub: albumSub } = displayOriginalTitle(
                album,
                albumTr ?? null,
                locale
              );
              const trackInfo = [
                at.discNumber >= 2 ? t("discN", { disc: at.discNumber }) : null,
                t("trackN", { track: at.trackNumber }),
              ].filter(Boolean).join(" ");
              return (
                <li key={at.id} className="border-b border-zinc-100 pb-2">
                  <div className="flex items-baseline gap-3">
                    <div className="flex-1">
                      <span className="font-medium">{albumName}</span>
                      <span className="mx-1 text-zinc-300">·</span>
                      <span className="text-sm text-zinc-400">{trackInfo}</span>
                    </div>
                    {album.releaseDate && (
                      <span className="shrink-0 text-sm text-zinc-400">
                        {formatDate(album.releaseDate, locale)}
                      </span>
                    )}
                  </div>
                  {albumSub && (
                    <p className="mt-0.5 text-sm text-zinc-500">{albumSub}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Performance History */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold">
          {t("performanceHistory")}
        </h2>
        {performances.length === 0 ? (
          <p className="text-zinc-500">{t("noPerformances")}</p>
        ) : (
          <ul className="space-y-3">
            {performances.map((p) => {
              const event = p.setlistItem.event;
              const evTr = pickTranslation(event.translations, locale);
              const performers = p.setlistItem.performers
                .map(
                  (perf) =>
                    pickTranslation(perf.stageIdentity.translations, locale)
                      ?.name
                )
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
                  {performers.length > 0 && (
                    <p className="mt-1 text-sm text-zinc-500">
                      {et(`stageType.${p.setlistItem.stageType}`)}
                      {" · "}
                      {performers.join(", ")}
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
