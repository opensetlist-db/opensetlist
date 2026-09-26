import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@/generated/prisma/client";
import { InfoCard } from "@/components/InfoCard";
import { colors, radius, shadows } from "@/styles/tokens";
import {
  displayOriginalTitle,
  displayOriginalName,
} from "@/lib/display";
import { countActiveBonuses, isEndedListing } from "@/lib/albumBonusDisplay";
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
  /**
   * Total bonus count (active + ended) computed once by the page
   * server component so the sidebar's `총 N개` chip can never
   * silently diverge from the tab-bar's `매장특전 (N)` badge. Both
   * read from the same `album.listings.reduce(...)` value — passing
   * it as a prop here makes the single source of truth explicit.
   */
  totalBonusCount: number;
}

export async function AlbumInfoCard({
  album,
  locale,
  totalBonusCount,
}: Props) {
  const t = await getTranslations({ locale, namespace: "Album" });

  // Albums are artwork — original-language title leads, locale
  // translation reads as the subtitle. Matches the song page's
  // sidebar pattern (`displayOriginalTitle` for any
  // artwork-identity surface). `main` is the original-language
  // title; `sub` is the locale translation when it exists and
  // differs from the original (returns null when same-locale or
  // missing, so we never paint a duplicate line).
  const titleParts = displayOriginalTitle(
    album,
    album.translations,
    locale,
  );

  const primaryArtistRow = album.artists[0] ?? null;
  const primaryArtist = primaryArtistRow?.artist ?? null;
  // Artists are identity — locale name leads, original-language
  // name reads as the subtitle. Flipped from albums by design
  // (`displayOriginalName` documents the rationale): a Korean
  // viewer sees the Korean rendering on top of a Japanese tour.
  const primaryArtistNameParts = primaryArtist
    ? displayOriginalName(
        primaryArtist,
        primaryArtist.translations,
        locale,
      )
    : null;
  const primaryArtistName = primaryArtistNameParts?.main ?? null;

  // Secondary artists (any artist past the first credited row). Render
  // as muted chips inline beneath the primary-artist link so a
  // multi-artist single / OST still surfaces every contributing
  // artist on the sidebar. mockup intent: the album page is a
  // collaboration surface; the primary anchor + secondary chips
  // mirror how the song page exposes the same relationship.
  const secondaryArtists = album.artists.slice(1);

  // `totalBonusCount` arrives as a prop (single source of truth with
  // the tab-bar badge). `activeBonusCount` + `endedBonusCount` are
  // derived locally — they partition the same listings tree, so their
  // sum is invariant to `totalBonusCount` by construction and no
  // cross-component divergence is possible.
  const activeBonusCount = countActiveBonuses(album.listings);
  const endedBonusCount = album.listings
    .filter(isEndedListing)
    .reduce((sum, l) => sum + l.bonuses.length, 0);

  // Sidebar meta block — pared down from the mockup's full 4-row set
  // (line 656-676) to the two rows that carry irreplaceable info:
  //   - 아티스트 (links to the primary artist page)
  //   - 발매일 (the only place this surfaces on the page)
  //
  // The two rows the mockup also had — 레이블 + 수록곡 — were
  // dropped on operator feedback during the mockup-gap pass:
  //   - 레이블: low-value label info that doesn't drive user action
  //   - 수록곡: track count already shows in the TabBar badge
  //            ("수록곡 (10)") right next to the sidebar, so a second
  //            "수록곡: 10곡" row is redundant.
  //
  // Each row still only renders when its value is non-empty so a row
  // with missing data doesn't draw an "—" stub.
  const metaRows: Array<{
    key: "artist" | "releaseDate";
    label: string;
    value: React.ReactNode;
  }> = [];
  if (primaryArtist && primaryArtistName) {
    // Artist name follows the identity-name rule (locale primary,
    // original-language sub). The sub line only renders when the
    // helper returns a non-null `sub` — same-locale entries collapse
    // to single-line cleanly.
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
            display: "inline-flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          <span>{primaryArtistName}</span>
          {primaryArtistNameParts?.sub ? (
            <span
              style={{
                fontSize: 11,
                color: colors.textMuted,
                fontWeight: 400,
              }}
            >
              {primaryArtistNameParts.sub}
            </span>
          ) : null}
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

  return (
    <InfoCard artist={primaryArtist}>
      {album.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={album.imageUrl}
          alt={titleParts.main}
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
          margin: titleParts.sub ? "0 0 4px" : "0 0 16px",
          color: colors.textPrimary,
          lineHeight: 1.3,
        }}
      >
        {titleParts.main}
      </h1>
      {/* Locale-translation subtitle line — present only when the
          translation exists and differs from the original
          (displayOriginalTitle returns null on same-locale / no
          translation, so the line collapses cleanly). Matches the
          song page H1+subtitle shape. */}
      {titleParts.sub ? (
        <p
          style={{
            margin: "0 0 16px",
            fontSize: 13,
            color: colors.textSubtle,
            lineHeight: 1.4,
            fontWeight: 500,
          }}
        >
          {titleParts.sub}
        </p>
      ) : null}

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
            // Identity rule: locale name primary. Chips are single-
            // line (no room for an original-language sub on a chip),
            // so we read just the `main` from displayOriginalName.
            const name = displayOriginalName(a, a.translations, locale).main;
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

// Bonus-stat chip palette — wired through the design-token system
// (colors.bonusTotal* / bonusActive* / bonusEnded*). Traffic-light
// semantic mapping (blue=count, green=available, gray=ended) — see
// the tokens.ts inline comment for the per-shade rationale.
const BONUS_CHIP_PALETTE: Record<
  "total" | "active" | "ended",
  { color: string; bg: string }
> = {
  total: { color: colors.bonusTotalText, bg: colors.bonusTotalBg },
  active: { color: colors.bonusActiveText, bg: colors.bonusActiveBg },
  ended: { color: colors.bonusEndedText, bg: colors.bonusEndedBg },
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
