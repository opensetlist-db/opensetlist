import { getTranslations } from "next-intl/server";
import { getTopLevelArtists } from "@/lib/artists";
import { ArtistCard } from "@/components/ArtistCard";

export default async function ArtistsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("Artist");
  const artists = await getTopLevelArtists();

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">{t("title")}</h1>

      {artists.length === 0 ? (
        <p className="text-sm text-zinc-500">{t("noArtists")}</p>
      ) : (
        <ul className="space-y-2">
          {artists.map((artist) => (
            <ArtistCard key={artist.id} artist={artist} locale={locale} />
          ))}
        </ul>
      )}
    </main>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Artist" });
  return { title: t("title") };
}
