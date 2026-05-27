import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import AlbumForm from "../../AlbumForm";

type Props = { params: Promise<{ id: string }> };

export default async function EditAlbumPage({ params }: Props) {
  const { id } = await params;
  // A non-numeric URL segment (e.g. /admin/albums/abc/edit) would
  // throw inside BigInt(); render the standard 404 instead of letting
  // the server crash with a SyntaxError.
  let albumId: bigint;
  try {
    albumId = BigInt(id);
  } catch {
    notFound();
  }
  const album = await prisma.album.findUnique({
    where: { id: albumId },
    include: {
      translations: true,
      artists: { select: { artistId: true } },
    },
  });
  if (!album) notFound();

  // ID-bearing fields (album.id, album.artists[*].artistId) go to the
  // form as strings — read directly from the raw bigint via
  // `.toString()` so the precision survives. serializeBigInt is still
  // useful for the non-id payload (translations array, the date and
  // string columns) where its JSON.parse round-trip just smooths
  // Prisma's Date / Decimal / etc. into plain shapes. The id fields
  // bypass it.
  const data = serializeBigInt(album);
  const albumIdStr = album.id.toString();
  const artistIdStrs = album.artists.map((aa) => aa.artistId.toString());

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">앨범 편집</h1>
        <div className="space-x-3 text-sm">
          <Link
            href={`/admin/albums/${albumIdStr}/listings`}
            className="text-blue-600 hover:underline"
          >
            매장별 구매처 관리 →
          </Link>
          <Link
            href={`/admin/albums/${albumIdStr}/tracks`}
            className="text-blue-600 hover:underline"
          >
            수록곡 관리 →
          </Link>
        </div>
      </div>
      <AlbumForm
        initialData={{
          id: albumIdStr,
          slug: data.slug,
          type: data.type,
          originalTitle: data.originalTitle,
          originalLanguage: data.originalLanguage,
          releaseDate: data.releaseDate
            ? new Date(data.releaseDate).toISOString().slice(0, 10)
            : null,
          labelName: data.labelName,
          imageUrl: data.imageUrl,
          translations: data.translations.map((t) => ({
            locale: t.locale,
            title: t.title,
          })),
          artistIds: artistIdStrs,
        }}
      />
    </div>
  );
}
