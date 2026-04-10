import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import EventSeriesForm from "../../EventSeriesForm";

type Props = { params: Promise<{ id: string }> };

export default async function EditEventSeriesPage({ params }: Props) {
  const { id } = await params;
  const series = await prisma.eventSeries.findFirst({
    where: { id: BigInt(id), isDeleted: false },
    include: { translations: true },
  });
  if (!series) notFound();

  const data = serializeBigInt(series);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">시리즈 편집</h1>
      <EventSeriesForm
        initialData={{
          id: Number(data.id),
          type: data.type,
          artistId: data.artistId ? Number(data.artistId) : null,
          parentSeriesId: data.parentSeriesId ? Number(data.parentSeriesId) : null,
          organizerName: data.organizerName,
          hasBoard: data.hasBoard,
          translations: data.translations.map((t) => ({
            locale: t.locale,
            name: t.name,
            description: t.description ?? "",
          })),
        }}
      />
    </div>
  );
}
