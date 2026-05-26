import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, pickLocaleTranslation } from "@/lib/utils";
import ListingsClient, { type ListingRow } from "./ListingsClient";

type Props = { params: Promise<{ id: string }> };

export default async function AlbumListingsPage({ params }: Props) {
  const { id } = await params;
  const album = await prisma.album.findUnique({
    where: { id: BigInt(id) },
    select: {
      id: true,
      originalTitle: true,
      translations: { select: { locale: true, title: true } },
    },
  });
  if (!album) notFound();

  const listings = await prisma.albumStoreListing.findMany({
    where: { albumId: BigInt(id) },
    include: {
      translations: true,
      _count: { select: { bonuses: true } },
    },
    orderBy: [{ originalStoreName: "asc" }, { createdAt: "asc" }],
  });

  // Datalist suggestions — distinct store names already used anywhere
  // in the DB. Saves the operator from re-typing "amazon_jp" on every
  // new album while still allowing free-text for brand-new stores.
  const distinctStores = await prisma.albumStoreListing.findMany({
    distinct: ["originalStoreName"],
    select: { originalStoreName: true },
    orderBy: { originalStoreName: "asc" },
  });
  const storeNameSuggestions = distinctStores.map((d) => d.originalStoreName);

  const rows: ListingRow[] = serializeBigInt(listings).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l: any) => ({
      id: l.id,
      originalStoreName: l.originalStoreName,
      originalEditionLabel: l.originalEditionLabel,
      originalLanguage: l.originalLanguage,
      productUrl: l.productUrl,
      status: l.status,
      startsAt: l.startsAt,
      endsAt: l.endsAt,
      lastVerifiedAt: l.lastVerifiedAt,
      sourceUrl: l.sourceUrl,
      translations: l.translations,
      bonusCount: l._count.bonuses,
    }),
  );

  const tr = pickLocaleTranslation(album.translations, "ko");
  const albumTitle = tr?.title ?? album.originalTitle;

  return (
    <div>
      <div className="mb-2 text-sm">
        <Link
          href={`/admin/albums/${album.id}/edit`}
          className="text-blue-600 hover:underline"
        >
          ← {albumTitle}
        </Link>
      </div>
      <ListingsClient
        albumId={String(album.id)}
        listings={rows}
        storeNameSuggestions={storeNameSuggestions}
      />
    </div>
  );
}
