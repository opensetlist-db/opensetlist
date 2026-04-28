import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import GroupForm from "../../GroupForm";

type Props = { params: Promise<{ id: string }> };

export default async function EditGroupPage({ params }: Props) {
  const { id } = await params;
  const group = await prisma.group.findUnique({
    where: { id },
    include: { translations: true },
  });
  if (!group) notFound();

  const data = serializeBigInt(group);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">그룹 편집</h1>
      <GroupForm
        initialData={{
          id: data.id,
          slug: data.slug,
          type: data.type,
          category: data.category,
          hasBoard: data.hasBoard,
          originalName: data.originalName ?? "",
          originalShortName: data.originalShortName ?? "",
          originalDescription: data.originalDescription ?? "",
          originalLanguage: data.originalLanguage ?? "ja",
          translations: data.translations.map((t) => ({
            locale: t.locale,
            name: t.name,
            shortName: t.shortName ?? "",
            description: t.description ?? "",
          })),
        }}
      />
    </div>
  );
}
