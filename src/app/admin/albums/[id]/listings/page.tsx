import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { pickLocaleTranslation } from "@/lib/utils";
import ListingsClient, { type ListingRow } from "./ListingsClient";

type Props = { params: Promise<{ id: string }> };

export default async function AlbumListingsPage({ params }: Props) {
  const { id } = await params;
  let albumId: bigint;
  try {
    albumId = BigInt(id);
  } catch {
    notFound();
  }
  const album = await prisma.album.findUnique({
    where: { id: albumId },
    select: {
      id: true,
      originalTitle: true,
      translations: { select: { locale: true, title: true } },
    },
  });
  if (!album) notFound();

  // Two independent reads — kick both off in parallel rather than
  // pay the round-trip latency twice in series. `listings` is the
  // table body; `distinctStores` feeds the datalist autocomplete.
  const [listings, distinctStores] = await Promise.all([
    prisma.albumStoreListing.findMany({
      where: { albumId },
      include: {
        translations: true,
        _count: { select: { bonuses: true } },
      },
      orderBy: [{ originalStoreName: "asc" }, { createdAt: "asc" }],
    }),
    prisma.albumStoreListing.findMany({
      distinct: ["originalStoreName"],
      select: { originalStoreName: true },
      orderBy: { originalStoreName: "asc" },
    }),
  ]);
  const storeNameSuggestions = distinctStores.map((d) => d.originalStoreName);

  const rows: ListingRow[] = listings.map(({ _count, albumId, ...listing }) => ({
    ...listing,
    albumId: String(albumId),
    startsAt: listing.startsAt?.toISOString() ?? null,
    endsAt: listing.endsAt?.toISOString() ?? null,
    bonusCount: _count.bonuses,
  }));

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
