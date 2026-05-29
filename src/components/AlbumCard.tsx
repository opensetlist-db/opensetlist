import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { displayOriginalTitle } from "@/lib/display";
import { parseReleaseYear } from "@/lib/utils";
import { colors, radius, shadows } from "@/styles/tokens";

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
 * b09 hero variant: vertical card — square cover on top, type pill +
 *   title (main + localized sub) + release year below. No Disc/Track
 *   footer (the Artist "최신 앨범" highlight has no AlbumTrack context).
 *   The card sets no width of its own; the consumer constrains it (the
 *   Artist section wraps the latest album so the cover reads ~180px).
 *
 * Future variants (do NOT add here; document for handoff):
 *   - list (b10b): full-width row for `/[locale]/albums` list page,
 *     larger cover + artist sub-label + type pill, no chevron
 *     (whole card is the link)
 *
 * Server component — no client state, no hooks beyond useTranslations
 * (which works in both server and client trees).
 */

// All three planned variants now implemented (mini = b08, hero = b09,
// list = b10b). The open string union + discriminated props kept each
// addition self-contained; no further variants are reserved.
export type AlbumCardVariant = "mini" | "hero" | "list";

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
      // Artist-name fields — OPTIONAL so the b08 song-page payload
      // (`SongAlbumsAlbum`, which selects only color + translations)
      // still satisfies this type. Only the `list` variant reads them,
      // and only via the caller-supplied `artistName` prop (resolved
      // upstream by `getAlbums`); mini/hero never touch them.
      originalName?: string | null;
      originalShortName?: string | null;
      originalLanguage?: string;
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

interface HeroProps {
  variant: "hero";
  album: AlbumCardAlbum;
  locale: string;
  /**
   * Count of active bonuses on this album (same formula as `mini` —
   * `countActiveBonuses(listings)`). Renders the green 特典 N badge
   * pinned to the top-right of the cover when > 0.
   */
  activeBonusCount?: number;
}

interface ListProps {
  variant: "list";
  album: AlbumCardAlbum;
  locale: string;
  /**
   * Pre-resolved artist label (e.g. `displayOriginalName(...).main`).
   * Passed in by the list page rather than resolved here so AlbumCard
   * doesn't have to depend on the optional artist-name fields being
   * present. Rendered as a plain text pill — NOT a nested link, since
   * the whole card is already an album link.
   */
  artistName?: string;
  /**
   * Count of active bonuses on this album (same formula as `mini` /
   * `hero` — `countActiveBonuses(listings)`). Renders the green 特典 N
   * badge when > 0.
   */
  activeBonusCount?: number;
}

type Props = MiniProps | HeroProps | ListProps;

export async function AlbumCard(props: Props) {
  if (props.variant === "mini") {
    return await MiniVariant(props);
  }
  if (props.variant === "hero") {
    return await HeroVariant(props);
  }
  if (props.variant === "list") {
    return await ListVariant(props);
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
  //
  // Mini is the only variant that still loads the `Song` namespace — it
  // renders Disc/Track footers + the "원본 수록" canonical pill, which are
  // genuinely Song-page-sidebar concepts. The cross-surface active-bonus
  // badge keys moved to `Album` (PR #486), so hero/list load `Album` only.
  const [albumT, songT] = await Promise.all([
    getTranslations({ locale, namespace: "Album" }),
    getTranslations({ locale, namespace: "Song" }),
  ]);

  const titleParts = displayOriginalTitle(album, album.translations, locale);
  const pillStyle = TYPE_PILL_STYLE[album.type] ?? DEFAULT_TYPE_PILL;

  const releaseYear = parseReleaseYear(album.releaseDate);

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
          text uses `Album.albumActiveBonusesBadge` (compact "특전 N" /
          "特典 N" / "Bonus N" per locale); the longer aria-label
          ("매장특전 N건" / "店舗特典 N件" / plural-aware en) lives
          in `Album.albumActiveBonuses` for screen readers. */}
      {activeBonusCount > 0 && (
        <span
          aria-label={albumT("albumActiveBonuses", { count: activeBonusCount })}
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
          {albumT("albumActiveBonusesBadge", { count: activeBonusCount })}
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

async function HeroVariant({
  album,
  locale,
  activeBonusCount = 0,
}: HeroProps) {
  // Album namespace only — type-pill label + active-bonus badge text
  // both live under `Album` now (the badge keys moved out of `Song` in
  // PR #486 since AlbumCard renders on non-Song surfaces). Server-side
  // `getTranslations` per the MiniVariant note (keeps consumers RSC).
  const albumT = await getTranslations({ locale, namespace: "Album" });

  const titleParts = displayOriginalTitle(album, album.translations, locale);
  const pillStyle = TYPE_PILL_STYLE[album.type] ?? DEFAULT_TYPE_PILL;

  const releaseYear = parseReleaseYear(album.releaseDate);

  const primaryArtist = album.artists[0]?.artist ?? null;
  const fallbackColor = primaryArtist?.color ?? colors.primary;

  const albumHref = `/${locale}/albums/${album.id}/${album.slug}`;

  return (
    <Link
      href={albumHref}
      style={{
        display: "flex",
        flexDirection: "column",
        background: colors.bgCard,
        border: `1.5px solid ${colors.border}`,
        borderRadius: radius.card,
        overflow: "hidden",
        textDecoration: "none",
        color: "inherit",
        transition: "border-color 0.12s",
      }}
    >
      {/* Square cover. `aspectRatio: 1` keeps the cover proportional
          at whatever width the consumer constrains the card to (the
          Artist section caps it ~180px). `referrerPolicy="no-referrer"`
          is required regardless of source per
          album-image-source-policy.md (Amazon CDN leak guard). */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1 / 1",
          background: album.imageUrl
            ? "transparent"
            : `linear-gradient(135deg, ${fallbackColor}30, ${fallbackColor}70)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 44,
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
        {/* Active-bonus badge pinned over the cover top-right — mirrors
            the artist-page-v2 mockup's 特典 badge placement. Same token
            pair + i18n keys as the mini variant so the green treatment
            reads identically across surfaces. */}
        {activeBonusCount > 0 && (
          <span
            aria-label={albumT("albumActiveBonuses", { count: activeBonusCount })}
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              fontSize: 10,
              fontWeight: 700,
              color: colors.bonusActiveText,
              background: colors.bonusActiveBg,
              borderRadius: 10,
              padding: "2px 7px",
            }}
          >
            {albumT("albumActiveBonusesBadge", { count: activeBonusCount })}
          </span>
        )}
      </div>

      {/* Meta block */}
      <div style={{ padding: "12px 14px 14px" }}>
        <div style={{ marginBottom: 6 }}>
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
        </div>
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: colors.primary,
            lineHeight: 1.35,
            // Two-line clamp — hero titles get more room than the
            // single-line mini, but a runaway title still can't push
            // the card height unbounded.
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {titleParts.main}
        </div>
        {titleParts.sub && (
          <div
            style={{
              fontSize: 11,
              color: colors.textMuted,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {titleParts.sub}
          </div>
        )}
        {releaseYear !== null && (
          <div
            style={{
              fontSize: 11,
              color: colors.textMuted,
              marginTop: 6,
            }}
          >
            {releaseYear}
          </div>
        )}
      </div>
    </Link>
  );
}

async function ListVariant({
  album,
  locale,
  artistName,
  activeBonusCount = 0,
}: ListProps) {
  // Album namespace only — type pill + active-bonus badge both resolve
  // here (the badge keys moved out of `Song` in PR #486).
  const albumT = await getTranslations({ locale, namespace: "Album" });

  const titleParts = displayOriginalTitle(album, album.translations, locale);
  const pillStyle = TYPE_PILL_STYLE[album.type] ?? DEFAULT_TYPE_PILL;

  const releaseYear = parseReleaseYear(album.releaseDate);

  const primaryArtist = album.artists[0]?.artist ?? null;
  const fallbackColor = primaryArtist?.color ?? colors.primary;
  const albumHref = `/${locale}/albums/${album.id}/${album.slug}`;

  // Shared sub-elements rendered in both the mobile-row and desktop-card
  // layouts so they can't drift apart.
  const typePill = (
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
  );
  const artistPill = artistName ? (
    <span
      style={{
        fontSize: 9,
        fontWeight: 600,
        color: colors.textSubtle,
        background: colors.bgSubtle,
        borderRadius: 8,
        padding: "1px 5px",
        maxWidth: 140,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {artistName}
    </span>
  ) : null;
  const bonusBadge =
    activeBonusCount > 0 ? (
      <span
        aria-label={albumT("albumActiveBonuses", { count: activeBonusCount })}
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: colors.bonusActiveText,
          background: colors.bonusActiveBg,
          borderRadius: 8,
          padding: "1px 5px",
        }}
      >
        {albumT("albumActiveBonusesBadge", { count: activeBonusCount })}
      </span>
    ) : null;

  const coverImg = album.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={album.imageUrl}
      alt=""
      referrerPolicy="no-referrer"
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  ) : (
    <span aria-hidden="true">💿</span>
  );

  return (
    // One <Link> renders both layouts; Tailwind breakpoint visibility
    // picks which shows. Mobile: a borderless row — the year-section
    // wrapper supplies the white container + `divide-y` separators, so
    // the row needs no border of its own (sidesteps the responsive
    // last-child-divider problem inline styles can't express). Desktop:
    // a self-contained bordered card inside the wrapper's grid. The
    // arbitrary `lg:` border/rounded values are the token hexes
    // (colors.border / radius) — they live in className rather than
    // `style` only because a media-query-conditional border can't be
    // expressed inline.
    <Link
      href={albumHref}
      className="block lg:flex lg:h-full lg:flex-col lg:overflow-hidden lg:rounded-[14px] lg:border lg:border-[#e2e8f0] lg:bg-white"
      style={{ textDecoration: "none", color: "inherit" }}
    >
      {/* ── Mobile row ── */}
      <div
        className="flex lg:hidden"
        style={{ alignItems: "center", gap: 14, padding: "12px 16px" }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 10,
            flexShrink: 0,
            background: album.imageUrl
              ? "transparent"
              : `linear-gradient(135deg, ${fallbackColor}30, ${fallbackColor}60)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            overflow: "hidden",
            boxShadow: shadows.imageThumbnail,
          }}
        >
          {coverImg}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              marginBottom: 4,
              flexWrap: "wrap",
            }}
          >
            {typePill}
            {artistPill}
            {bonusBadge}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: colors.primary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginBottom: 2,
            }}
          >
            {titleParts.main}
          </div>
          <div style={{ fontSize: 11, color: colors.textMuted }}>
            {[titleParts.sub, releaseYear !== null ? String(releaseYear) : null]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <span
          style={{ fontSize: 14, color: colors.borderSubtle, flexShrink: 0 }}
          aria-hidden="true"
        >
          ›
        </span>
      </div>

      {/* ── Desktop card ── */}
      <div className="hidden lg:flex lg:h-full lg:flex-col">
        <div
          style={{
            position: "relative",
            height: 120,
            background: album.imageUrl
              ? "transparent"
              : `linear-gradient(135deg, ${fallbackColor}25, ${fallbackColor}55)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 40,
            overflow: "hidden",
          }}
        >
          {coverImg}
          {activeBonusCount > 0 && (
            <span
              aria-label={albumT("albumActiveBonuses", {
                count: activeBonusCount,
              })}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                fontSize: 10,
                fontWeight: 700,
                color: colors.bonusActiveText,
                background: colors.bonusActiveBg,
                borderRadius: 10,
                padding: "2px 7px",
              }}
            >
              {albumT("albumActiveBonusesBadge", { count: activeBonusCount })}
            </span>
          )}
        </div>
        <div
          style={{
            padding: "10px 12px 12px",
            flex: 1,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              marginBottom: 5,
              flexWrap: "wrap",
            }}
          >
            {typePill}
            {artistPill}
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: colors.primary,
              lineHeight: 1.4,
              marginBottom: 3,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {titleParts.main}
          </div>
          {releaseYear !== null && (
            <div style={{ fontSize: 10, color: colors.textMuted }}>
              {releaseYear}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
