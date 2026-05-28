import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@/generated/prisma/client";
import { InfoCard } from "@/components/InfoCard";
import { colors, radius, shadows } from "@/styles/tokens";
import { resolveLocalizedField, displayNameWithFallback } from "@/lib/display";
import { isEndedListing } from "@/lib/albumBonusDisplay";
import { formatDate } from "@/lib/utils";
import type { BigIntStringified } from "@/lib/utils";

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
// Wire-shape after page.tsx's getAlbum runs serializeBigIntAsString —
// every `bigint` becomes `string`, every `Date` becomes `string`. The
// component reads `album.id` / `artists[].artist.id` / etc as strings
// (template-literal hrefs work identically) so the BigIntStringified
// wrapper is the right contract to declare.
export type AlbumForInfoCard = BigIntStringified<
  Prisma.AlbumGetPayload<{
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
  }>
>;

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

  // Secondary artists (any artist past the first credited row). Render
  // as muted chips inline beneath the primary-artist link so a
  // multi-artist single / OST still surfaces every contributing
  // artist on the sidebar. mockup intent: the album page is a
  // collaboration surface; the primary anchor + secondary chips
  // mirror how the song page exposes the same relationship.
  const secondaryArtists = album.artists.slice(1);

  const trackCount = album.tracks.length;
  const totalBonusCount = album.listings.reduce(
    (sum, l) => sum + l.bonuses.length,
    0,
  );
  const activeBonusCount = album.listings
    .filter((l) => !isEndedListing(l))
    .reduce((sum, l) => sum + l.bonuses.length, 0);
  const endedBonusCount = album.listings
    .filter(isEndedListing)
    .reduce((sum, l) => sum + l.bonuses.length, 0);

  // Mockup's sidebar meta block (line 656-676): 4 label/value rows
  // with a fixed 48-px label gutter. Each row only renders when its
  // value is non-empty so a Phase 1 row missing label / release date
  // doesn't draw an "—" stub. The artist row links to the primary
  // artist page; the rest are static text.
  const metaRows: Array<{
    key: "artist" | "releaseDate" | "label" | "trackCount";
    label: string;
    value: React.ReactNode;
  }> = [];
  if (primaryArtist && primaryArtistName) {
    metaRows.push({
      key: "artist",
      label: t("meta.label.artist"),
      value: (
        <Link
          href={`/${locale}/artists/${primaryArtist.id}/${primaryArtist.slug}`}
          style={{
            color: colors.primary,
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          {primaryArtistName}
        </Link>
      ),
    });
  }
  if (album.releaseDate) {
    metaRows.push({
      key: "releaseDate",
      label: t("meta.label.releaseDate"),
      value: formatDate(album.releaseDate, locale),
    });
  }
  if (album.labelName) {
    metaRows.push({
      key: "label",
      label: t("meta.label.label"),
      value: album.labelName,
    });
  }
  if (trackCount > 0) {
    metaRows.push({
      key: "trackCount",
      label: t("meta.label.trackCount"),
      value: t("stats.trackCount", { count: trackCount }),
    });
  }

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
          margin: "0 0 16px",
          color: colors.textPrimary,
          lineHeight: 1.3,
        }}
      >
        {title}
      </h1>

      {/* Meta rows — mockup line 656-676. Label gutter pinned at 48px
          so the 발매일 / 레이블 / 수록곡 / 아티스트 row starts align
          even when the value spans multiple lines. */}
      {metaRows.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            marginBottom: secondaryArtists.length > 0 ? 12 : 16,
          }}
        >
          {metaRows.map((row) => (
            <div
              key={row.key}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: colors.textMuted,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  width: 48,
                  flexShrink: 0,
                  paddingTop: 1,
                }}
              >
                {row.label}
              </span>
              <span
                style={{
                  fontSize: 13,
                  color: colors.textPrimary,
                  fontWeight: 400,
                  wordBreak: "break-word",
                }}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Secondary artist credit chips — render only when the album
          credits more than one artist. Each chip links to its artist
          page so a multi-artist collab page surfaces every credited
          artist as a navigable hop. */}
      {secondaryArtists.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 16,
          }}
        >
          {secondaryArtists.map((aa) => {
            const a = aa.artist;
            const name = displayNameWithFallback(a, a.translations, locale);
            if (!name) return null;
            return (
              <Link
                key={a.id}
                href={`/${locale}/artists/${a.id}/${a.slug}`}
                style={{
                  display: "inline-block",
                  padding: "3px 9px",
                  background: colors.bgSubtle,
                  color: colors.textSubtle,
                  borderRadius: radius.tag,
                  fontSize: 11,
                  fontWeight: 600,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {name}
              </Link>
            );
          })}
        </div>
      ) : null}

      {/* Bonus stats section — mockup line 678-716: borderTop separator
          + section label + chip row. 3-chip layout per the b03-b05
          simplification handoff (active/ended only — sold_out and
          unknown collapse into "active" upstream in isEndedListing).
          Each chip color-coded:
            총 N개   — primary blue (matches mockup #0277BD / #e8f4fd)
            활성 X    — emerald green (#16a34a / #f0fdf4)
            종료 Z    — slate gray   (#64748b / #f1f5f9)
          Renders nothing when the album has zero listings — the empty
          state is the bonus tab's placeholder, not a stub-zero chip. */}
      {totalBonusCount > 0 ? (
        <div
          style={{
            borderTop: `1px solid ${colors.borderSubtle}`,
            paddingTop: 14,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: colors.textMuted,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            {t("stats.bonusSectionLabel")}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <BonusChip variant="total">
              {t("stats.totalBonusCount", { count: totalBonusCount })}
            </BonusChip>
            {activeBonusCount > 0 ? (
              <BonusChip variant="active">
                {t("stats.activeBonusCount", { count: activeBonusCount })}
              </BonusChip>
            ) : null}
            {endedBonusCount > 0 ? (
              <BonusChip variant="ended">
                {t("stats.endedBonusCount", { count: endedBonusCount })}
              </BonusChip>
            ) : null}
          </div>
        </div>
      ) : null}
    </InfoCard>
  );
}

// Bonus-stat chip palette. Colors picked literal from the mockup
// rather than wired through the design-token system because the
// mockup uses a specific traffic-light semantic mapping (blue=count,
// green=available, gray=ended) that isn't represented as named
// tokens in `@/styles/tokens` today. If a future surface needs the
// same palette, lifting these to tokens is the right move.
const BONUS_CHIP_PALETTE: Record<
  "total" | "active" | "ended",
  { color: string; bg: string }
> = {
  total: { color: "#0277BD", bg: "#e8f4fd" },
  active: { color: "#16a34a", bg: "#f0fdf4" },
  ended: { color: "#64748b", bg: "#f1f5f9" },
};

function BonusChip({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: "total" | "active" | "ended";
}) {
  const palette = BONUS_CHIP_PALETTE[variant];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 9px",
        background: palette.bg,
        color: palette.color,
        borderRadius: radius.tag,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
