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

  const data = serializeBigInt(album);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">앨범 편집</h1>
        <div className="space-x-3 text-sm">
          <Link
            href={`/admin/albums/${data.id}/listings`}
            className="text-blue-600 hover:underline"
          >
            매장별 구매처 관리 →
          </Link>
          <Link
            href={`/admin/albums/${data.id}/tracks`}
            className="text-blue-600 hover:underline"
          >
            수록곡 관리 →
          </Link>
        </div>
      </div>
      <AlbumForm
        initialData={{
          id: String(data.id),
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
          // serializeBigInt JSON-roundtrips bigints to numbers, but the
          // generated Prisma model type still describes the original
          // `artistId: bigint` shape — cast through here so TS sees the
          // runtime number that survives JSON.parse.
          artistIds: data.artists.map(
            (aa: { artistId: number | bigint }) => Number(aa.artistId),
          ),
        }}
      />
    </div>
  );
}
