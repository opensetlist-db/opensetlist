import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@/generated/prisma/client";
import { InfoCard } from "@/components/InfoCard";
import { colors, radius, shadows } from "@/styles/tokens";
import { resolveLocalizedField, displayNameWithFallback } from "@/lib/display";

/*
 * Sidebar card for the Album detail page (`/[locale]/albums/[id]/...`).
 *
 * Wraps the generic <InfoCard> (which itself wraps <ColorStripe> + the
 * white-rounded shell used by every other detail page) and fills its
 * body with album-specific content: cover image, type badge, title,
 * primary artist link, and stat chips (track count / listing count /
 * active bonuses / ended bonuses).
 *
 * Cover image:
 *   `Album.imageUrl` may host either a Cloudflare R2 URL or an Amazon
 *   CDN URL (`m.media-amazon.com`, populated when the operator wires
 *   an Amazon JP product to the album per [[album-image-source-policy]]).
 *   We render with `referrerPolicy="no-referrer"` regardless of source
 *   — required by the policy to avoid leaking the page URL to Amazon
 *   when the source is Amazon CDN, harmless on R2. `<img>` instead of
 *   `next/image` because next/image doesn't surface the
 *   `referrerPolicy` prop and the cover is a single sidebar surface
 *   that doesn't need Next's image-optimization pipeline.
 *
 * Stat chip semantics (consumed by both b02 sidebar render and the
 * upcoming b03/b04 surfaces):
 *   trackCount       = album.tracks.length
 *   listingCount     = album.listings.length
 *   bonusCount       = bonuses across listings whose status ≠ "ended"
 *                      (active + sold_out + unknown — the "current"
 *                      bonuses visible by default on b03's grid)
 *   endedBonusCount  = bonuses across listings whose status = "ended"
 *                      (matches b03's "ended toggle" body content)
 *
 * Primary artist routing: AlbumArtist is a junction with no role
 * column (unlike SongArtist's primary/featured/cover), so we pick the
 * first row deterministically (already ordered by the include's
 * default — insertion order, which the CSV import lands in
 * artist_slugs declaration order). For Phase 1 single-artist albums
 * this is unambiguous; multi-artist OSTs / collabs land the first
 * credited artist as the sidebar anchor and the others appear inline
 * in b04's related-events tab where artist context expands.
 */

// Derived from the include shape used by `getAlbum` in the album
// detail page — keeping the type alias here rather than in the page
// itself lets the component own the exact dependency surface it needs
// without coupling to the page's full include tree (b03 / b04 will
// add more nested includes for their own surfaces). Prisma's
// GetPayload utility composes the include into a typed shape that
// satisfies `resolveLocalizedField`'s `Record<string, unknown>`
// constraint, so we don't need a type assertion at the call sites.
export type AlbumForInfoCard = Prisma.AlbumGetPayload<{
  include: {
    translations: true;
    artists: {
      include: {
        artist: { include: { translations: true } };
      };
    };
    tracks: true;
    listings: { include: { bonuses: true } };
  };
}>;

interface Props {
  album: AlbumForInfoCard;
  locale: string;
}

export async function AlbumInfoCard({ album, locale }: Props) {
  const t = await getTranslations({ locale, namespace: "Album" });

  const title =
    resolveLocalizedField(
      album,
      album.translations,
      locale,
      "title",
      "originalTitle",
    ) ?? t("unknown");

  const primaryArtistRow = album.artists[0] ?? null;
  const primaryArtist = primaryArtistRow?.artist ?? null;
  const primaryArtistName = primaryArtist
    ? displayNameWithFallback(
        primaryArtist,
        primaryArtist.translations,
        locale,
      )
    : null;

  const trackCount = album.tracks.length;
  const listingCount = album.listings.length;
  const bonusCount = album.listings
    .filter((l) => l.status !== "ended")
    .reduce((sum, l) => sum + l.bonuses.length, 0);
  const endedBonusCount = album.listings
    .filter((l) => l.status === "ended")
    .reduce((sum, l) => sum + l.bonuses.length, 0);

  return (
    <InfoCard artist={primaryArtist}>
      {album.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={album.imageUrl}
          alt={title}
          referrerPolicy="no-referrer"
          style={{
            width: "100%",
            aspectRatio: "1 / 1",
            objectFit: "cover",
            borderRadius: radius.card,
            boxShadow: shadows.card,
            display: "block",
            marginBottom: 16,
          }}
        />
      ) : (
        <div
          aria-hidden="true"
          style={{
            width: "100%",
            aspectRatio: "1 / 1",
            background: colors.bgSubtle,
            borderRadius: radius.card,
            marginBottom: 16,
          }}
        />
      )}

      <div
        style={{
          display: "inline-block",
          padding: "3px 10px",
          background: colors.bgSubtle,
          color: colors.textSubtle,
          borderRadius: radius.tag,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        {t(`type.${album.type}`)}
      </div>

      <h1
        style={{
          fontSize: 22,
          fontWeight: 800,
          margin: "0 0 8px",
          color: colors.textPrimary,
          lineHeight: 1.3,
        }}
      >
        {title}
      </h1>

      {primaryArtist && primaryArtistName ? (
        <Link
          href={`/${locale}/artists/${primaryArtist.id}/${primaryArtist.slug}`}
          style={{
            color: colors.textSubtle,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
            borderBottom: `1px solid ${colors.borderSubtle}`,
            paddingBottom: 1,
          }}
        >
          {primaryArtistName}
        </Link>
      ) : null}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginTop: 16,
        }}
      >
        {trackCount > 0 ? <Chip>{t("stats.trackCount", { count: trackCount })}</Chip> : null}
        {listingCount > 0 ? <Chip>{t("stats.listingCount", { count: listingCount })}</Chip> : null}
        {bonusCount > 0 ? <Chip>{t("stats.bonusCount", { count: bonusCount })}</Chip> : null}
        {endedBonusCount > 0 ? (
          <Chip variant="muted">{t("stats.endedBonusCount", { count: endedBonusCount })}</Chip>
        ) : null}
      </div>
    </InfoCard>
  );
}

function Chip({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "muted";
}) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        background: variant === "muted" ? "transparent" : colors.bgSubtle,
        color: variant === "muted" ? colors.textMuted : colors.textSubtle,
        border: variant === "muted" ? `1px dashed ${colors.borderSubtle}` : "none",
        borderRadius: radius.tag,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
