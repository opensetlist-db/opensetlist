import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminEventWithOrderedSetlist } from "@/lib/adminEventSetlist";
import { serializeBigInt, serializeBigIntAsString } from "@/lib/utils";
import EventForm from "../../EventForm";
import SetlistBuilder from "../../SetlistBuilder";
import BoardSettings from "../../BoardSettings";
import CollaborationSettings from "../../CollaborationSettings";
import EventLogoSection from "../../EventLogoSection";
import { getEventLogoAdminState } from "@/lib/adminEventLogo";
import { seriesAdminName } from "@/lib/adminLogo";

type Props = { params: Promise<{ id: string }> };

export default async function EditEventPage({ params }: Props) {
  const { id } = await params;
  const event = await getAdminEventWithOrderedSetlist(BigInt(id));
  if (!event) notFound();

  const data = serializeBigInt(event);

  // Logo override card: uncached admin read (assignment, provenance,
  // applied result, draft previews); null only if the event vanished
  // between the two reads.
  const logoState = await getEventLogoAdminState(event.id);
  if (!logoState) notFound();
  // Two names on purpose: the explanation text is admin prose (Korean
  // name first, like the series card), while the typography preview
  // mirrors the record's original-language fields, as public pages do.
  const series = event.eventSeriesId
    ? await prisma.eventSeries.findUnique({
        where: { id: event.eventSeriesId },
        select: { originalName: true, originalShortName: true },
      })
    : null;
  const seriesName = event.eventSeriesId ? await seriesAdminName(prisma, event.eventSeriesId) : null;
  // Typography fallback from the SAVED record (the preview shows what
  // public pages render, which changes only when EventForm saves). Event
  // names are often just "Day.1", so the series name rides on top and
  // the date / venue below keep each day's card distinguishable. The
  // date is a UTC calendar date, so it is read with getUTC*.
  const logoDate = event.date
    ? `${event.date.getUTCFullYear()}.${String(event.date.getUTCMonth() + 1).padStart(2, "0")}.${String(event.date.getUTCDate()).padStart(2, "0")}`
    : null;
  const logoTypography = {
    eyebrow: series ? series.originalShortName || series.originalName : null,
    title: event.originalShortName || event.originalName || `#${event.id}`,
    caption: [logoDate, event.originalVenue].filter(Boolean).join(" · ") || null,
  };

  const artistOrder = await prisma.artist.findMany({
    where: { isDeleted: false },
    select: { id: true, parentArtistId: true, type: true, sortOrder: true },
  });

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
            // `serializeBigInt` already replaced BigInt with Number at
            // runtime, so the `Number(...)` wrapper here is a no-op on
            // the wire. It stays in the source as a *type-level* narrow:
            // `serializeBigInt<T>(...)` returns `T` unchanged, so TS
            // still sees `data.artistId` as `bigint | null` even though
            // the actual value is a JS number. Stripping the cast
            // tripped TS2322 against `EventFormProps.artistId: number |
            // null`. Same pattern as `eventSeriesId` above — keep them
            // mirrored so a future refactor of `serializeBigInt`'s
            // return type can drop both at once.
            artistId: data.artistId ? Number(data.artistId) : null,
            // bdAlbumId follows the same serializeBigInt → Number cast as
            // eventSeriesId / artistId above. The PUT route validates via
            // validateBdAlbumId → validateNullableBigIntFk, which accepts
            // either the number form or "" / null for "no selection."
            bdAlbumId: data.bdAlbumId ? Number(data.bdAlbumId) : null,
            organizerName: data.organizerName ?? null,
            date: data.date
              ? new Date(data.date).toISOString().split("T")[0]
              : null,
            country: data.country,
            posterUrl: data.posterUrl,
            startTime: new Date(data.startTime).toISOString().slice(0, 16),
            engagementOpensAt: data.engagementOpensAt
              ? new Date(data.engagementOpensAt).toISOString().slice(0, 16)
              : "",
            originalName: data.originalName ?? "",
            originalShortName: data.originalShortName ?? "",
            originalCity: data.originalCity ?? "",
            originalVenue: data.originalVenue ?? "",
            originalLanguage: data.originalLanguage ?? "ja",
            translations: data.translations.map((t: { locale: string; name: string; shortName?: string | null; city?: string | null; venue?: string | null; organizerName?: string | null }) => ({
              locale: t.locale,
              name: t.name,
              shortName: t.shortName ?? "",
              city: t.city ?? "",
              venue: t.venue ?? "",
              organizerName: t.organizerName ?? "",
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

      <EventLogoSection
        eventId={logoState.eventId}
        initialState={{
          assignment: logoState.assignment,
          asset: logoState.asset,
          applied: logoState.applied,
          previews: logoState.previews,
          attempt: null,
        }}
        typography={logoTypography}
        seriesName={seriesName}
      />

      <hr className="border-zinc-200" />

      <div>
        <h2 className="mb-6 text-2xl font-bold">팬 보드</h2>
        <BoardSettings eventId={Number(data.id)} />
      </div>

      <hr className="border-zinc-200" />

      <div>
        <h2 className="mb-6 text-2xl font-bold">협업 그룹 출연</h2>
        <CollaborationSettings key={event.id.toString()} eventId={event.id.toString()} />
      </div>

      <hr className="border-zinc-200" />

      <div>
        <h2 className="mb-6 text-2xl font-bold">세트리스트</h2>
        {/* eslint-disable @typescript-eslint/no-explicit-any */}
        <SetlistBuilder
          eventId={Number(data.id)}
          initialItems={data.setlistItems as any}
          artistOrder={serializeBigIntAsString(artistOrder)}
          eventGuestIds={event.performers.filter((p) => p.isGuest).map((p) => p.stageIdentity.id)}
          // Guests can be picked explicitly but never seed the default roster.
          eventPerformers={event.performers.filter((p) => !p.isGuest).map(({ stageIdentity }) => ({
            id: stageIdentity.id,
            translations: stageIdentity.translations,
            sortOrder: stageIdentity.sortOrder,
            createdAt: stageIdentity.createdAt.toISOString(),
            artistLinks: stageIdentity.artistLinks.map((link) => ({
              artistId: Number(link.artistId),
              sortOrder: link.sortOrder,
              artist: { id: Number(link.artist.id), translations: link.artist.translations },
            })),
          }))}
        />
        {/* eslint-enable @typescript-eslint/no-explicit-any */}
      </div>
    </div>
  );
}
