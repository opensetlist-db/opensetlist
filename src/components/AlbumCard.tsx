import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { displayOriginalTitle } from "@/lib/display";
import { colors, radius } from "@/styles/tokens";

/*
 * AlbumCard — reusable album mini-card used across Sprint B2 cross-link
 * surfaces. Owner: b08 (Song → Album sidebar). Designed for b09 / b10b
 * to extend with `hero` / `list` variants without modifying b08's
 * behaviour — the discriminated union on `variant` makes each variant
 * a self-contained render block, and shared atoms (type pill, cover,
 * bonus badge) are extracted as internal helpers.
 *
 * b08 mini variant: horizontal compact 44×44-cover + meta + chevron
 *   row inside the Song page sidebar InfoCard. Mockup reference:
 *   F:\work\vaults\opensetlist\raw\mockups\song-page-v2-mockup.jsx
 *   lines 127–201 (AlbumLinkCard).
 *
 * Future variants (do NOT add here; document for handoff):
 *   - hero (b09): 160×160 cover above title, "최신 앨범" emphasis,
 *     no Disc/Track context (Artist page latest-album highlight)
 *   - list (b10b): full-width row for `/[locale]/albums` list page,
 *     larger cover + artist sub-label + type pill, no chevron
 *     (whole card is the link)
 *
 * Server component — no client state, no hooks beyond useTranslations
 * (which works in both server and client trees).
 */

// Open string union to keep b09 / b10b additions trivial — adding
// "hero" / "list" later is a one-line change here + a new branch
// below. Closed-set discriminated union would force every caller to
// update on variant addition.
export type AlbumCardVariant = "mini";

// Per-AlbumType pill styling. Mirrors the mockup's ALBUM_TYPE_LABEL
// map (lines 96–102) but uses semantic tokens from
// `@/styles/tokens.ts` where they exist. The single-text labels
// route through i18n (existing `Album.type.*` namespace per
// messages/{ko,ja,en}.json) so this map only carries colors —
// no English / Korean / Japanese label strings to keep in sync.
const TYPE_PILL_STYLE: Record<
  string,
  { color: string; bg: string }
> = {
  single: { color: colors.upcoming, bg: colors.upcomingBg },
  album: { color: colors.primary, bg: colors.primaryBg },
  ep: { color: colors.primary, bg: colors.primaryBg },
  live_album: { color: colors.variant, bg: colors.variantBg },
  soundtrack: { color: colors.warning, bg: colors.warningBg },
};

const DEFAULT_TYPE_PILL = {
  color: colors.textSubtle,
  bg: colors.bgSubtle,
};

// Minimal structural shape for the album payload. Stays narrow so
// callers can hand a Prisma payload directly without intermediary
// adapters. Ids accept string | number | bigint per the
// LiveSetlistItem precedent — runtime is Number (post-serializeBigInt)
// even when TS types say bigint; consumers here read ids via template
// literals + React keys, both of which are coercion-tolerant.
export type AlbumCardAlbum = {
  id: string | number | bigint;
  slug: string;
  type: string;
  releaseDate: string | Date | null;
  imageUrl: string | null;
  originalTitle: string;
  originalLanguage: string;
  translations: Array<{ locale: string; title: string }>;
  artists: Array<{
    artist: {
      color: string | null;
      translations: Array<{ locale: string; name: string }>;
    };
  }>;
};

interface MiniProps {
  variant: "mini";
  album: AlbumCardAlbum;
  locale: string;
  /**
   * Renders the canonical-emphasis treatment: light-blue border +
   * "원본 수록" pill. Set on the Song page sidebar for the oldest
   * album the song appears on; other Wave-2 surfaces (b09 hero,
   * b10b list) don't carry a canonical notion and ignore this.
   */
  isCanonical?: boolean;
  /**
   * AlbumTrack context (mini-variant only). Renders the
   * "Disc N · Track M · Year" footer line beneath the title.
   * Other variants don't have AlbumTrack rows to source these from.
   */
  discNumber?: number | null;
  trackNumber?: number | null;
  /**
   * Count of active bonuses on this album (listings.filter(!ended)
   * → bonuses.length). Renders the green 特典 N badge to the right
   * of the title row when > 0. Caller derives via `getSongAlbums`
   * (b08) or any equivalent helper that mirrors the AlbumInfoCard
   * formula.
   */
  activeBonusCount?: number;
}

type Props = MiniProps;

export async function AlbumCard(props: Props) {
  if (props.variant === "mini") {
    return await MiniVariant(props);
  }
  return null;
}

async function MiniVariant({
  album,
  locale,
  isCanonical = false,
  discNumber,
  trackNumber,
  activeBonusCount = 0,
}: MiniProps) {
  // Server-side translation lookup. AlbumCard is rendered inside the
  // Song page sidebar (also a server component) and any future
  // variants (b09 hero, b10b list) also live on server-rendered
  // pages — see AlbumInfoCard for the same pattern. Switching to
  // `useTranslations` from `next-intl` would force a `"use client"`
  // boundary on every consumer that mounts AlbumCard, defeating the
  // RSC tree the rest of the album-surface stack relies on.
  const [albumT, songT] = await Promise.all([
    getTranslations({ locale, namespace: "Album" }),
    getTranslations({ locale, namespace: "Song" }),
  ]);

  const titleParts = displayOriginalTitle(album, album.translations, locale);
  const pillStyle = TYPE_PILL_STYLE[album.type] ?? DEFAULT_TYPE_PILL;

  const releaseYear = (() => {
    if (album.releaseDate === null) return null;
    const d =
      album.releaseDate instanceof Date
        ? album.releaseDate
        : new Date(album.releaseDate);
    const year = d.getUTCFullYear();
    return Number.isNaN(year) ? null : year;
  })();

  const primaryArtist = album.artists[0]?.artist ?? null;
  const fallbackColor = primaryArtist?.color ?? colors.primary;

  // "Disc N · Track M · YYYY" footer. The Disc/Track labels route
  // through the existing `Song.discN` / `Song.trackN` keys (Korean
  // viewer sees "Disc 1" in Latin script, Japanese viewer sees
  // "Disc 1" — these labels happen to be Latin script across all
  // three locales currently, but the routing-through-i18n keeps the
  // CLAUDE.md "never hardcode public-facing strings" rule honored
  // and lets a future locale switch the markers if needed). Omits
  // any segment that's missing rather than rendering an em-dash
  // placeholder.
  const footerSegments: string[] = [];
  if (discNumber !== null && discNumber !== undefined) {
    footerSegments.push(songT("discN", { disc: discNumber }));
  }
  if (trackNumber !== null && trackNumber !== undefined) {
    footerSegments.push(songT("trackN", { track: trackNumber }));
  }
  if (releaseYear !== null) {
    footerSegments.push(String(releaseYear));
  }

  const albumHref = `/${locale}/albums/${album.id}/${album.slug}`;

  return (
    <Link
      href={albumHref}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        background: colors.bgCard,
        border: `1.5px solid ${
          isCanonical ? colors.primaryBorder : colors.border
        }`,
        borderRadius: radius.tag,
        textDecoration: "none",
        color: "inherit",
        transition: "background 0.12s",
      }}
    >
      {/* Cover thumbnail — Amazon CDN + R2 both possible; no-referrer
          is required by album-image-source-policy.md regardless. */}
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 8,
          flexShrink: 0,
          background: album.imageUrl
            ? "transparent"
            : `linear-gradient(135deg, ${fallbackColor}30, ${fallbackColor}70)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          overflow: "hidden",
        }}
      >
        {album.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={album.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span aria-hidden="true">💿</span>
        )}
      </div>

      {/* Title + meta column */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            marginBottom: 3,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: pillStyle.color,
              background: pillStyle.bg,
              borderRadius: 8,
              padding: "1px 5px",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {albumT(`type.${album.type}`)}
          </span>
          {isCanonical && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: colors.primary,
                background: colors.primaryBg,
                borderRadius: 8,
                padding: "1px 5px",
              }}
            >
              {songT("albumOriginalRecording")}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: colors.primary,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {titleParts.main}
        </div>
        {footerSegments.length > 0 && (
          <div
            style={{
              fontSize: 10,
              color: colors.textMuted,
              marginTop: 1,
            }}
          >
            {footerSegments.join(" · ")}
          </div>
        )}
      </div>

      {/* Active-bonus badge — only when count > 0. Mirrors
          AlbumInfoCard's bonusActive token pair so the green
          treatment reads consistently across album surfaces. Visible
          text uses `Song.albumActiveBonusesBadge` (compact "특전 N" /
          "特典 N" / "Bonus N" per locale); the longer aria-label
          ("매장특전 N건" / "店舗特典 N件" / plural-aware en) lives
          in `Song.albumActiveBonuses` for screen readers. */}
      {activeBonusCount > 0 && (
        <span
          aria-label={songT("albumActiveBonuses", { count: activeBonusCount })}
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: colors.bonusActiveText,
            background: colors.bonusActiveBg,
            borderRadius: 10,
            padding: "2px 7px",
            flexShrink: 0,
          }}
        >
          {songT("albumActiveBonusesBadge", { count: activeBonusCount })}
        </span>
      )}

      <span
        style={{
          fontSize: 13,
          color: colors.borderSubtle,
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        ›
      </span>
    </Link>
  );
}
