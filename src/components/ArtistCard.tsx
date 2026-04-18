import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { pickTranslation } from "@/lib/utils";
import type { ArtistForList } from "@/lib/artists";

export async function ArtistCard({
  artist,
  locale,
}: {
  artist: ArtistForList;
  locale: string;
}) {
  const t = await getTranslations("Artist");
  const tr = pickTranslation(artist.translations, locale);
  const name = tr?.name ?? t("unknown");

  return (
    <li
      className="rounded-lg bg-white"
      style={{ border: "0.5px solid #e8e8e8", borderRadius: "8px" }}
    >
      <Link
        href={`/${locale}/artists/${artist.id}/${artist.slug}`}
        className="flex items-center gap-3 px-4 py-3 hover:bg-[#fafafa]"
      >
        <span
          className="font-dm-sans flex-1 truncate text-[13px]"
          style={{ color: "#1a1a1a", fontWeight: 500 }}
        >
          {name}
        </span>
        <span
          className="font-dm-sans shrink-0 rounded-full bg-[#f0f0f0] px-2 py-0.5 text-[11px]"
          style={{ color: "#555555" }}
        >
          {t(`type.${artist.type}`)}
        </span>
      </Link>
    </li>
  );
}
