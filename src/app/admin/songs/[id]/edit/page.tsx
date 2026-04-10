import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import SongForm from "../../SongForm";

type Props = { params: Promise<{ id: string }> };

export default async function EditSongPage({ params }: Props) {
  const { id } = await params;
  const song = await prisma.song.findFirst({
    where: { id: BigInt(id), isDeleted: false },
    include: {
      translations: true,
      artists: {
        include: { artist: { include: { translations: true } } },
      },
    },
  });
  if (!song) notFound();

  const data = serializeBigInt(song);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">곡 편집</h1>
      <SongForm
        initialData={{
          id: Number(data.id),
          originalTitle: data.originalTitle,
          variantLabel: data.variantLabel,
          releaseDate: data.releaseDate
            ? new Date(data.releaseDate).toISOString().split("T")[0]
            : null,
          baseVersionId: data.baseVersionId ? Number(data.baseVersionId) : null,
          translations: data.translations.map((t) => ({
            locale: t.locale,
            title: t.title,
          })),
          artistCredits: data.artists.map(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (sa: any) => ({
              artistId: Number(sa.artistId),
              role: sa.role as string,
            })
          ),
        }}
      />
    </div>
  );
}
