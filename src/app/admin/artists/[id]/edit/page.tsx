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
      stageLinks: {
        include: {
          stageIdentity: {
            include: {
              translations: true,
              voicedBy: {
                where: { endDate: null },
                include: {
                  realPerson: { include: { translations: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!artist) notFound();

  const data = serializeBigInt(artist);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingStageIdentities = data.stageLinks.map((sl: any) => {
    const siTranslations = sl.stageIdentity.translations as { locale: string; name: string }[];
    const siTr = siTranslations.find((t) => t.locale === "ko") ?? siTranslations[0];
    const va = sl.stageIdentity.voicedBy[0];
    const vaTranslations = va?.realPerson?.translations as { locale: string; name: string; stageName?: string }[] | undefined;
    const vaTr = vaTranslations?.find((t) => t.locale === "ko") ?? vaTranslations?.[0];
    return {
      id: sl.stageIdentity.id as string,
      type: sl.stageIdentity.type as string,
      color: sl.stageIdentity.color as string | null,
      name: siTr?.name ?? "Unknown",
      vaName: vaTr ? (vaTr.stageName ?? vaTr.name) : null,
    };
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">아티스트 편집</h1>
      <ArtistForm
        initialData={{
          id: Number(data.id),
          type: data.type,
          parentArtistId: data.parentArtistId
            ? Number(data.parentArtistId)
            : null,
          hasBoard: data.hasBoard,
          translations: data.translations.map((t) => ({
            locale: t.locale,
            name: t.name,
            bio: t.bio ?? "",
          })),
          groupIds: data.groupLinks.map(
            (gl: { groupId: string }) => gl.groupId
          ),
          existingStageIdentities,
        }}
      />
    </div>
  );
}
