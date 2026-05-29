import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { countActiveBonuses } from "@/lib/albumBonusDisplay";
import { albumCardInclude } from "@/lib/albumHighlights";
import { AlbumCard } from "@/components/AlbumCard";
import { SectionLabel } from "@/components/SectionLabel";
import { colors, radius, shadows } from "@/styles/tokens";

/*
 * Album page "관련 앨범" sidebar section (b09).
 *
 * Shows other albums by the same artist(s) as the current album,
 * newest first, capped at 5. "Same artist" matches via the AlbumArtist
 * junction against any of the current album's credited artists
 * (`artistIds` passed in by the page from the already-loaded
 * `album.artists`, so this adds no artist round-trip). The current
 * album is excluded by id.
 *
 * Same-series related albums (BD ↔ BD across a tour) are explicitly
 * Phase 3 per the b09 spec — at MVP this is same-artist only.
 *
 * Returns null when there are no other albums by the artist, so the
 * caller mounts it unconditionally below the AlbumInfoCard.
 */
const RELATED_LIMIT = 5;

export async function RelatedAlbumsSection({
  albumId,
  artistIds,
  locale,
}: {
  albumId: bigint;
  artistIds: bigint[];
  locale: string;
}) {
  // No artists credited (data gap) → nothing to relate against.
  if (artistIds.length === 0) return null;

  const albums = await prisma.album.findMany({
    where: {
      artists: { some: { artistId: { in: artistIds } } },
      id: { not: albumId },
    },
    orderBy: [{ releaseDate: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: RELATED_LIMIT,
    include: albumCardInclude(locale),
  });

  if (albums.length === 0) return null;

  const serialized = serializeBigInt(albums);
  const t = await getTranslations({ locale, namespace: "Album" });

  return (
    <section
      style={{
        background: colors.bgCard,
        borderRadius: radius.card,
        padding: "16px 18px",
        marginTop: 12,
        boxShadow: shadows.card,
      }}
    >
      <SectionLabel as="h3">{t("related")}</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
