import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { displayNameWithFallback } from "@/lib/display";
import { colors, radius } from "@/styles/tokens";
import ArtistAvatar from "@/components/ArtistAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import { StatsSubLabel } from "@/components/StatsSubLabel";
import type { ArtistRowData } from "@/lib/artists";

/*
 * Mobile card for one artist row in the list page (visible < lg).
 *
 * Wrapped in <Link> so the entire flex row is clickable and the
 * keyboard tab order matches the visual reading order. The same
 * link target is used by <ArtistTableRow> for the desktop variant —
 * keep these two in sync if the routing changes.
 *
 * `isLast` controls whether to render the bottom border. CSS
 * :last-child would work too, but we already know the index from
 * the parent map and passing a boolean keeps the rule explicit.
 */

interface Props {
  artist: ArtistRowData;
  locale: string;
  isLast: boolean;
}

export default async function ArtistCard({ artist, locale, isLast }: Props) {
  const [t, tEvent] = await Promise.all([
    getTranslations("Artist"),
    getTranslations("Event"),
  ]);

  // Full localized name (project rule: `full` is the default for
  // every user-facing surface that isn't a breadcrumb or a "short
  // because page already shows full" exception). Long names wrap or
  // truncate per the row's CSS — the artists list isn't a
  // setlist-row chip; readability beats compactness here.
  // `displayNameWithFallback` cascades: localized name →
  // originalName → "". `t("unknown")` is the last-resort label so a
  // row never renders as a nameless link when the cascade collapses.
  const primaryName =
    displayNameWithFallback(artist, artist.translations, locale) ||
    t("unknown");
  // Avatar-initial source: locale shortName cascade. The big-glyph
  // square reads better when keyed off a curated short handle (e.g.
  // `C` from `Cerise Bouquet`'s shortName) instead of the full
  // name's first character — same intent as the member-page hero,
  // applied per the avatar policy on artist surfaces. Empty string
  // collapses to `null` so the avatar's `??` chain falls through to
  // `name` cleanly.
  const primaryShortName =
    displayNameWithFallback(artist, artist.translations, locale, "short") ||
    null;
  // Show the original (typically Japanese) name as a sub-line only when
  // the viewer's locale differs from the artist's original-language and
  // an original name actually exists.
  const showOriginal =
    locale !== artist.originalLanguage &&
    !!artist.originalName &&
    primaryName !== artist.originalName;

  // Sub-unit chips use full name (not shortName). The chip strip
  // sits under the parent name and a long label like "DOLLCHESTRA"
  // reads better than its truncation. Operator preference per
  // visual review.
  const subUnitNames = artist.subArtists.map(
    (s) =>
      displayNameWithFallback(s, s.translations, locale, "full") ||
      t("unknown"),
  );

  return (
    <li
      style={{
        borderBottom: isLast ? "none" : `1px solid ${colors.borderLight}`,
      }}
    >
      <Link
        href={`/${locale}/artists/${artist.id}/${artist.slug}`}
        className="row-hover-bg"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "14px 16px",
          textDecoration: "none",
          color: "inherit",
        }}
      >
        {/* `ArtistRowData` carries `originalName` + `translations`, not
            the flat `name`/`shortName` fields the avatar component
            expects — pass already-resolved values so the glyph picks
            the localized label's first character instead of falling
            through to "?". `shortName` takes precedence inside the
            avatar (preferred initial source); `name` is the fallback
            when no shortName exists at any locale. */}
        <ArtistAvatar
          artist={{
            color: artist.color,
            name: primaryName,
            shortName: primaryShortName,
          }}
          size={48}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: colors.textPrimary,
              }}
            >
              {primaryName}
            </span>
            {artist.hasOngoing && (
              <StatusBadge
                status="ongoing"
                size="sm"
                label={tEvent("live")}
              />
            )}
          </div>
          {showOriginal && (
            <div
              className="truncate"
              style={{
                fontSize: 11,
                color: colors.textMuted,
                marginTop: 2,
              }}
            >
              {artist.originalName}
            </div>
          )}
          {subUnitNames.length > 0 && (
            <div
              style={{
                display: "flex",
                gap: 4,
                marginTop: 6,
                flexWrap: "wrap",
              }}
            >
              {subUnitNames.map((name, i) => (
                <span
                  key={i}
                  style={{
                    background: colors.borderLight,
                    color: colors.textSubtle,
                    borderRadius: radius.chip,
                    padding: "1px 6px",
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                >
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}
        >
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: colors.textPrimary,
                lineHeight: 1.1,
              }}
            >
              {artist.totalEvents}
            </div>
            <StatsSubLabel>{t("eventsLabel")}</StatsSubLabel>
          </div>
          <span
            aria-hidden="true"
            style={{
              fontSize: 14,
              color: colors.textMuted,
              marginLeft: 4,
            }}
          >
            ›
          </span>
        </div>
      </Link>
    </li>
  );
}
