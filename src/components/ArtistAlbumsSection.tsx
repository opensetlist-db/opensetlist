import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { countActiveBonuses } from "@/lib/albumBonusDisplay";
import { albumCardInclude } from "@/lib/albumHighlights";
import { AlbumCard } from "@/components/AlbumCard";
import { SectionLabel } from "@/components/SectionLabel";
import { colors, radius, shadows } from "@/styles/tokens";

/*
 * Artist page "최신 앨범" highlight + discography catalog (b09).
 *
 * Self-contained async server component: does its own scoped album
 * query so the carefully-narrowed `getArtist` mega-query on the page
 * stays untouched. Mounted inside the overview tab between the members
 * section and the recent-events section.
 *
 * Albums link to the artist via the AlbumArtist N:N junction
 * (`artists: { some: { artistId } }`) — not a scalar `Album.artistId`,
 * which never existed (the b09 spec predated the b01 schema). This
 * means a sub-unit (Cerise Bouquet, DOLLCHESTRA, …) surfaces exactly
 * the albums credited to it, with no parent-chain traversal needed —
 * unlike the event history, where sub-units borrow their parent's
 * series.
 *
 * Renders nothing (returns null) when the artist has no albums, so the
 * caller can mount it unconditionally.
 */

// `take: 30` cap. The "전체 보기" discography sub-page
// (/[locale]/artists/[id]/albums) is explicitly Phase 3 — at MVP we
// show the 30 most recent and stop. 30 comfortably covers every
// Phase 1/2 artist (Hasunosora's full discography is well under that).
const DISCOGRAPHY_LIMIT = 30;

export async function ArtistAlbumsSection({
  artistId,
  locale,
}: {
  artistId: bigint;
  locale: string;
}) {
  const albums = await prisma.album.findMany({
    where: { artists: { some: { artistId } } },
    // Newest first: the head of the list is the "최신 앨범" hero, the
    // tail is the discography grid (still newest-first within it).
    // NULL releaseDate sorts last so un-dated catalog rows never
    // masquerade as the latest album.
    orderBy: [{ releaseDate: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: DISCOGRAPHY_LIMIT,
    include: albumCardInclude(locale),
  });

  if (albums.length === 0) return null;

  // serializeBigInt narrows BigInt ids → Number (and Date → ISO string
  // via the JSON round-trip); AlbumCard reads ids only through template
  // literals + React keys, both coercion-tolerant, so the runtime swap
  // is transparent. The serialized payload keeps its full shape — a
  // superset of what AlbumCard reads — so it satisfies AlbumCardAlbum
  // structurally and still exposes `listings` for the bonus count
  // (no cast that would erase the listings field).
  const serialized = serializeBigInt(albums);
  const [latest, ...rest] = serialized;

  const t = await getTranslations({ locale, namespace: "Artist" });

  return (
    <section
      style={{
        background: colors.bgCard,
        borderRadius: radius.card,
        padding: "18px 20px",
        boxShadow: shadows.card,
      }}
    >
      <SectionLabel>{t("albums.latest")}</SectionLabel>

      {/* Hero card constrained to ~200px so the square cover reads as a
          feature without stretching to the full content width. */}
      <div style={{ maxWidth: 200 }}>
        <AlbumCard
          variant="hero"
          album={latest}
          locale={locale}
          activeBonusCount={countActiveBonuses(latest.listings)}
        />
      </div>

      {rest.length > 0 && (
        <>
          <SectionLabel as="h3" noBorder style={{ marginTop: 18 }}>
            {t("albums.discography")}
          </SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {rest.map((album) => (
              <AlbumCard
                key={`${album.id}`}
                variant="mini"
                album={album}
                locale={locale}
                activeBonusCount={countActiveBonuses(album.listings)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
