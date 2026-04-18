import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import EventForm from "../../EventForm";
import SetlistBuilder from "../../SetlistBuilder";

type Props = { params: Promise<{ id: string }> };

export default async function EditEventPage({ params }: Props) {
  const { id } = await params;
  const event = await prisma.event.findFirst({
    where: { id: BigInt(id), isDeleted: false },
    include: {
      translations: true,
      performers: {
        include: {
          stageIdentity: {
            include: {
              translations: true,
              artistLinks: {
                include: { artist: { include: { translations: true } } },
              },
            },
          },
        },
      },
      setlistItems: {
        where: { isDeleted: false },
        include: {
          songs: {
            include: { song: { include: { translations: true } } },
            orderBy: { order: "asc" },
          },
          performers: {
            include: {
              stageIdentity: { include: { translations: true } },
            },
          },
          artists: {
            include: {
              artist: { include: { translations: true } },
            },
          },
        },
        orderBy: { position: "asc" },
      },
    },
  });
  if (!event) notFound();

  const data = serializeBigInt(event);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="mb-6 text-2xl font-bold">이벤트 편집</h1>
        <EventForm
          initialData={{
            id: Number(data.id),
            type: data.type,
            status: data.status,
            eventSeriesId: data.eventSeriesId ? Number(data.eventSeriesId) : null,
            date: data.date
              ? new Date(data.date).toISOString().split("T")[0]
              : null,
            country: data.country,
            posterUrl: data.posterUrl,
            startTime: new Date(data.startTime).toISOString().slice(0, 16),
            translations: data.translations.map((t: { locale: string; name: string; shortName?: string | null; city?: string | null; venue?: string | null }) => ({
              locale: t.locale,
              name: t.name,
              shortName: t.shortName ?? "",
              city: t.city ?? "",
              venue: t.venue ?? "",
            })),
            performers: (data.performers ?? []).map((p: {
              isGuest: boolean;
              stageIdentity: {
                id: string;
                translations: { locale: string; name: string }[];
                artistLinks: { artist: { translations: { locale: string; name: string }[] } }[];
              };
            }) => ({
              isGuest: p.isGuest,
              stageIdentity: {
                id: p.stageIdentity.id,
                translations: p.stageIdentity.translations,
                artistLinks: p.stageIdentity.artistLinks,
              },
            })),
          }}
        />
      </div>

      <hr className="border-zinc-200" />

      <div>
        <h2 className="mb-6 text-2xl font-bold">세트리스트</h2>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <SetlistBuilder eventId={Number(data.id)} initialItems={data.setlistItems as any} />
      </div>
    </div>
  );
}
