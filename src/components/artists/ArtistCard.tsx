import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { displayNameWithFallback } from "@/lib/display";
import { colors, radius } from "@/styles/tokens";
import ArtistAvatar from "@/components/ArtistAvatar";
import { StatusBadge } from "@/components/StatusBadge";
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

  // `displayNameWithFallback` cascades: localized shortName → localized
  // name → originalShortName → originalName → "". When everything is
  // null the cascade ends in "" (Prisma types original* as nullable
  // even though the schema is non-null), so add t("unknown") as the
  // last-resort label so a row never renders as a nameless link.
  const primaryName =
    displayNameWithFallback(artist, artist.translations, locale, "short") ||
    t("unknown");
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
            expects — pass the already-resolved primaryName as `name`
            so the glyph picks the localized label's first character
            instead of falling through to "?". */}
        <ArtistAvatar
          artist={{ color: artist.color, name: primaryName }}
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
                label={tEvent("status.ongoing")}
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
            <div style={{ fontSize: 10, color: colors.textMuted }}>
              {t("eventsLabel")}
            </div>
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
