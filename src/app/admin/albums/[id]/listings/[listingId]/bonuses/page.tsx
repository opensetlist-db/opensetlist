import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import BonusesClient, { type BonusRow } from "./BonusesClient";

type Props = { params: Promise<{ id: string; listingId: string }> };

export default async function AlbumBonusesPage({ params }: Props) {
  const { id, listingId } = await params;
  let albumId: bigint;
  try {
    albumId = BigInt(id);
  } catch {
    notFound();
  }

  // Both queries key off the URL params (listingId for bonuses,
  // listingId+albumId for the listing lookup) — independent reads,
  // so fan them out. The notFound() guard runs after destructuring;
  // the bonuses query result is discarded in the not-found path,
  // which is the cheaper trade for the latency-saving in the happy
  // path. Matches the Promise.all pattern in listings/page.tsx.
  const [listing, bonuses] = await Promise.all([
    prisma.albumStoreListing.findFirst({
      where: { id: listingId, albumId },
      select: {
        id: true,
        originalStoreName: true,
        originalEditionLabel: true,
      },
    }),
    prisma.albumStoreBonus.findMany({
      where: { listingId },
      include: { translations: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!listing) notFound();

  type SerializedBonus = {
    id: string;
    originalBonusType: string;
    originalLanguage: string;
    // Schema also has bonusDescription per locale; admin form drops
    // it per the simplification handoff, so we narrow at the type
    // boundary and ignore the extra column on the way through.
    translations: {
      locale: string;
      bonusType: string | null;
      bonusDescription: string | null;
    }[];
  };

  const rows: BonusRow[] = (
    serializeBigInt(bonuses) as SerializedBonus[]
  ).map((b) => ({
    id: b.id,
    originalBonusType: b.originalBonusType,
    originalLanguage: b.originalLanguage,
    translations: b.translations.map((tr) => ({
      locale: tr.locale,
      bonusType: tr.bonusType,
    })),
  }));

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
