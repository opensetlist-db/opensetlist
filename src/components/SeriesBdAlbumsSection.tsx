import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { AlbumType } from "@/generated/prisma/enums";
import { countActiveBonuses } from "@/lib/albumBonusDisplay";
import { albumCardInclude, collectBdAlbumIds } from "@/lib/albumHighlights";
import { AlbumCard } from "@/components/AlbumCard";
import { SectionLabel } from "@/components/SectionLabel";
import { colors, radius, shadows } from "@/styles/tokens";

/*
 * Series page "투어 BD 목록" catalog (b09).
 *
 * The live-BD albums for a tour aren't linked to the EventSeries
 * directly — they hang off the individual Event rows via
 * `Event.bdAlbumId` (the relation b07's EventBdSection surfaces on the
 * event page). So this section fans out: series → its events (+ direct
 * child-series events) → their bdAlbumId set → the live_album rows.
 *
 * Series-id set is `self + direct childSeries` — matching the
 * one-level nesting `getEventSeries` already models (a tour with
 * per-leg child series). A deeper tree isn't part of the Phase 1/2
 * data shape; if it ever is, widen the childSeries query to recurse.
 *
 * Type filter pins to `live_album`: only BD/Blu-ray releases belong in
 * a "tour BDs" list, even though an event could in principle point its
 * bdAlbumId at some other album type via operator error.
 *
 * Returns null when the series has no BD albums, so the caller mounts
 * it unconditionally.
 */
export async function SeriesBdAlbumsSection({
  seriesId,
  locale,
}: {
  seriesId: bigint;
  locale: string;
}) {
  // Direct child series (e.g. per-city legs under a tour). One level
  // deep — see the header note.
  const childSeries = await prisma.eventSeries.findMany({
    where: { parentSeriesId: seriesId, isDeleted: false },
    select: { id: true },
  });
  const seriesIds = [seriesId, ...childSeries.map((c) => c.id)];

  const events = await prisma.event.findMany({
    where: {
      eventSeriesId: { in: seriesIds },
      isDeleted: false,
      bdAlbumId: { not: null },
    },
    select: { bdAlbumId: true },
  });

  const bdAlbumIds = collectBdAlbumIds(events);
  if (bdAlbumIds.length === 0) return null;

  const albums = await prisma.album.findMany({
    where: { id: { in: bdAlbumIds }, type: AlbumType.live_album },
    // Ascending (oldest → newest) so the catalog reads chronologically
    // 1st live → latest, matching how a fan walks a tour history.
    orderBy: [{ releaseDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    include: albumCardInclude(locale),
  });

  if (albums.length === 0) return null;

  const serialized = serializeBigInt(albums);
  const t = await getTranslations({ locale, namespace: "EventSeries" });

  return (
    <section
      style={{
        background: colors.bgCard,
        borderRadius: radius.card,
        padding: "16px 20px",
        marginBottom: 12,
        boxShadow: shadows.card,
      }}
    >
      <SectionLabel>{t("tourBds")}</SectionLabel>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {serialized.map((album) => (
          <AlbumCard
            key={`${album.id}`}
            variant="mini"
            album={album}
            locale={locale}
            activeBonusCount={countActiveBonuses(album.listings)}
          />
        ))}
      </div>
    </section>
  );
}
