import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import AlbumForm from "../../AlbumForm";
import {
  isUploadStorageConfigured,
  r2PublicHost,
  readCoverState,
} from "@/lib/albumCover";

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

  // Cover: the stored value verbatim (it is the editor's expected value
  // for compare-and-set) plus admin-only provenance found by exact
  // publicUrl match. Read separately from the row above; a cover that
  // changed in between is caught by the editor's CAS on save.
  const coverState = await readCoverState(album.id);
  // Calendar date (`@db.Date`), shown in UTC so it never shifts a day.
  const releaseLabel = album.releaseDate
    ? album.releaseDate.toISOString().slice(0, 10).replace(/-/g, ".")
    : null;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">앨범 편집</h1>
          <p className="mt-1 text-sm font-medium break-words text-zinc-700">
            {album.originalTitle}
          </p>
          {(releaseLabel || album.labelName) && (
            <p className="text-xs text-zinc-500">
              {[releaseLabel, album.labelName].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
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
          translations: data.translations.map((t) => ({
            locale: t.locale,
            title: t.title,
          })),
          artistIds: artistIdStrs,
        }}
        cover={{
          // A null imageUrl from the snapshot means "no cover" — never
          // fall back to the earlier row read.
          imageUrl: coverState ? coverState.imageUrl : album.imageUrl,
          provenance: coverState ? coverState.provenance : null,
          r2PublicHost: r2PublicHost(),
          uploadConfigured: isUploadStorageConfigured(),
        }}
      />
    </div>
  );
}
