import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { serializeBigIntAsString } from "@/lib/utils";
import { membershipOrderBy } from "@/lib/officialOrder";
import ArtistForm from "../../ArtistForm";
import { ADMIN_UNKNOWN_NAME } from "@/lib/admin-constants";

type Props = { params: Promise<{ id: string }> };

export default async function EditArtistPage({ params }: Props) {
  const { id } = await params;
  const artist = await prisma.artist.findFirst({
    where: { id: BigInt(id), isDeleted: false },
    include: {
      translations: true,
      groupLinks: true,
      // Official member order (`src/lib/memberOrder.ts`) — the form
      // lists members in this order, next to their 정렬 순서 input.
      stageLinks: {
        orderBy: membershipOrderBy(),
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

  const data = serializeBigIntAsString(artist);

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
      sortOrder: sl.stageIdentity.sortOrder as number | null,
      membershipSortOrder: sl.sortOrder as number | null,
      createdAt: sl.stageIdentity.createdAt as string,
      name: siTr?.name ?? ADMIN_UNKNOWN_NAME,
      vaName: vaTr ? (vaTr.stageName ?? vaTr.name) : null,
    };
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">아티스트 편집</h1>
      <ArtistForm
        initialData={{
          id: data.id,
          type: data.type,
          parentArtistId: data.parentArtistId
            ? data.parentArtistId
            : null,
          hasBoard: data.hasBoard,
          category: data.category ?? null,
          isMainUnit: data.isMainUnit ?? false,
          color: data.color ?? null,
          sortOrder: data.sortOrder ?? null,
          isSideProject: data.isSideProject ?? false,
          originalName: data.originalName ?? "",
          originalShortName: data.originalShortName ?? "",
          originalBio: data.originalBio ?? "",
          originalLanguage: data.originalLanguage ?? "ja",
          translations: data.translations.map((t) => ({
            locale: t.locale,
            name: t.name,
            shortName: t.shortName ?? "",
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
