import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { displayNameWithFallback } from "@/lib/display";
import { colors } from "@/styles/tokens";
import ArtistAvatar from "@/components/ArtistAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import type { ArtistRowData } from "@/lib/artists";

/*
 * Desktop table row for one artist. Sibling of <ArtistCard>.
 *
 * Kept in sync between siblings: link target, the data each row
 * displays, the LIVE badge contract, and i18n keys. Intentionally
 * different per the operator mockup: layout (5-col grid vs flex),
 * avatar size (40 vs 48), and the artist-name color treatment
 * (mockup §3 spells out `#0277BD bold 14px` / colors.primary for
 * desktop only — mobile uses the default colors.textPrimary because
 * the whole row is one big tap target rather than a discrete link).
 *
 * The 5-col grid `56px | 1fr | 1fr | 80px | 28px` matches the table
 * header in <GroupSection>; widening any column here requires the
 * matching adjustment there.
 */

interface Props {
  artist: ArtistRowData;
  locale: string;
  isLast: boolean;
}

export default async function ArtistTableRow({
  artist,
  locale,
  isLast,
}: Props) {
  const [t, tEvent] = await Promise.all([
    getTranslations("Artist"),
    getTranslations("Event"),
  ]);

  // Same `displayNameWithFallback` + t("unknown") pattern as
  // <ArtistCard>; see the comment there for why the final fallback is
  // a translatable label rather than empty string.
  const primaryName =
    displayNameWithFallback(artist, artist.translations, locale, "short") ||
    t("unknown");
  const showOriginal =
    locale !== artist.originalLanguage &&
    !!artist.originalName &&
    primaryName !== artist.originalName;

  const subUnitNames = artist.subArtists.map(
    (s) =>
      displayNameWithFallback(s, s.translations, locale, "short") ||
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
          display: "grid",
          gridTemplateColumns: "56px 1fr 1fr 80px 28px",
          alignItems: "center",
          gap: 12,
          padding: "12px 20px",
          textDecoration: "none",
          color: "inherit",
          transition: "background 0.12s ease",
        }}
      >
        {/* col 1: avatar */}
        <ArtistAvatar artist={artist} size={40} />

        {/* col 2: name stack */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              className="truncate"
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: colors.primary,
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
        </div>

        {/* col 3: subunit chips */}
        <div
          style={{
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
          }}
        >
          {subUnitNames.map((name, i) => (
            <span
              key={i}
              style={{
                background: colors.borderLight,
                color: colors.textSubtle,
                borderRadius: 10,
                padding: "1px 6px",
                fontSize: 10,
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {name}
            </span>
          ))}
        </div>

        {/* col 4: event count */}
        <div>
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: colors.textPrimary,
            }}
          >
            {artist.totalEvents}
          </span>
          <span
            style={{
              fontSize: 11,
              color: colors.textMuted,
              marginLeft: 4,
            }}
          >
            {t("eventsLabel")}
          </span>
        </div>

        {/* col 5: chevron */}
        <span
          aria-hidden="true"
          style={{
            fontSize: 14,
            color: colors.textMuted,
            textAlign: "right",
          }}
        >
          ›
        </span>
      </Link>
    </li>
  );
}
