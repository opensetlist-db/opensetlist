import Link from "next/link";
import { notFound } from "next/navigation";
import { verifyAdmin } from "@/lib/admin-auth";
import BonusLifecyclePanel from "@/app/admin/albums/[id]/listings/[listingId]/bonuses/BonusLifecyclePanel";
import { prisma } from "@/lib/prisma";
import { entityPath } from "@/lib/seo/entityUrl";

export default async function BonusCheckPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ listingId?: string | string[] }>;
}) {
  await verifyAdmin();
  const [{ id }, { listingId }] = await Promise.all([params, searchParams]);
  if (typeof listingId !== "string" || !listingId || listingId.length > 128) notFound();
  const target = await prisma.albumStoreBonus.findUnique({
    where: { id, listingId },
    select: { listing: { select: { albumId: true, album: { select: { slug: true } } } } },
  });
  if (!target) notFound();
  const { albumId, album } = target.listing;
  return (
    <div className="space-y-4">
      <Link href={`/admin/album-bonuses/checks?albumId=${albumId}`} className="text-blue-600 underline">
        ← 이 앨범의 특전 점검 목록
      </Link>
      <h1 className="text-xl font-bold">개별 특전 점검</h1>
      <BonusLifecyclePanel id={id} listingId={listingId}
        purchaseHref={`${entityPath("albums", "ko", albumId, album.slug)}?tab=bonus`} checking />
    </div>
  );
}
