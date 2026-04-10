import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import ArtistForm from "../../ArtistForm";

type Props = { params: Promise<{ id: string }> };

export default async function EditArtistPage({ params }: Props) {
  const { id } = await params;
  const artist = await prisma.artist.findFirst({
    where: { id: BigInt(id), isDeleted: false },
    include: {
      translations: true,
      groupLinks: true,
    },
  });
  if (!artist) notFound();

  const data = serializeBigInt(artist);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">아티스트 편집</h1>
      <ArtistForm
        initialData={{
          id: Number(data.id),
          type: data.type,
          parentArtistId: data.parentArtistId ? Number(data.parentArtistId) : null,
          hasBoard: data.hasBoard,
          translations: data.translations.map((t) => ({
            locale: t.locale,
            name: t.name,
            bio: t.bio ?? "",
          })),
          groupIds: data.groupLinks.map(
            (gl: { groupId: string }) => gl.groupId
          ),
        }}
      />
    </div>
  );
}
