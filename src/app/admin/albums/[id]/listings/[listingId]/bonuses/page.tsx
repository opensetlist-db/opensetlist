import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import BonusesClient, { type BonusRow } from "./BonusesClient";

type Props = { params: Promise<{ id: string; listingId: string }> };

export default async function AlbumBonusesPage({ params }: Props) {
  const { id, listingId } = await params;
  const albumId = BigInt(id);

  const listing = await prisma.albumStoreListing.findFirst({
    where: { id: listingId, albumId },
    select: {
      id: true,
      originalStoreName: true,
      originalEditionLabel: true,
    },
  });
  if (!listing) notFound();

  const bonuses = await prisma.albumStoreBonus.findMany({
    where: { listingId },
    include: { translations: true },
    orderBy: { createdAt: "asc" },
  });

  const rows: BonusRow[] = serializeBigInt(bonuses).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b: any) => ({
      id: b.id,
      originalBonusType: b.originalBonusType,
      originalLanguage: b.originalLanguage,
      // Strip out the per-locale `bonusDescription` column — the admin
      // form intentionally surfaces only `bonusType` per the b03-b05
      // simplification handoff. Existing description values stay in
      // the DB but the UI doesn't render or edit them.
      translations: b.translations.map(
        (tr: { locale: string; bonusType: string | null }) => ({
          locale: tr.locale,
          bonusType: tr.bonusType,
        }),
      ),
    }),
  );

  const label = listing.originalEditionLabel
    ? `${listing.originalStoreName} · ${listing.originalEditionLabel}`
    : listing.originalStoreName;

  return (
    <div>
      <div className="mb-2 text-sm">
        <Link
          href={`/admin/albums/${id}/listings`}
          className="text-blue-600 hover:underline"
        >
          ← {label}
        </Link>
      </div>
      <BonusesClient listingId={listing.id} bonuses={rows} />
    </div>
  );
}
