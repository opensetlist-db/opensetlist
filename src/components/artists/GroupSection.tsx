import { getTranslations } from "next-intl/server";
import { displayName } from "@/lib/display";
import { colors, shadows, radius } from "@/styles/tokens";
import type { GroupForList } from "@/lib/artists";
import ArtistCard from "@/components/artists/ArtistCard";
import ArtistTableRow from "@/components/artists/ArtistTableRow";

/*
 * One group block: white card with header (name + category badge +
 * artist-count) and a list of artist rows. Both the mobile-card and
 * desktop-table layouts ship in the SSR output; Tailwind's `lg:`
 * prefix (matching `breakpoint.desktop = 1024` in tokens.ts) toggles
 * which one is visible. This pattern matches the rest of the Phase
 * 1B redesigns (LiveSetlist, SetlistRow, EventHeader) — none of
 * which use the `useIsDesktop` hook for layout switching.
 *
 * Group ordering (ongoing-pinned, then alphabetical) happens at the
 * data layer in `getArtistGroupsForList`. This component just
 * renders one group at the position the page placed it.
 */

interface Props {
  group: GroupForList;
  locale: string;
}

const CATEGORY_LABEL_KEY: Record<NonNullable<GroupForList["category"]>, string> =
  {
    anime: "categoryAnime",
    game: "categoryGame",
    kpop: "categoryKpop",
    jpop: "categoryJpop",
    cpop: "categoryCpop",
  };

export default async function GroupSection({ group, locale }: Props) {
  const t = await getTranslations("Artist");

  const localizedTranslation = group.translations.find(
    (tr) => tr.locale === locale,
  );
  const displayedName = localizedTranslation
    ? displayName(localizedTranslation, "short")
    : (group.originalShortName ?? group.originalName);

  const artistCount = group.artists.length;
  const categoryLabel = group.category
    ? t(CATEGORY_LABEL_KEY[group.category])
    : null;

  return (
    <section
      style={{
        background: colors.bgCard,
        borderRadius: radius.card,
        boxShadow: shadows.card,
        marginBottom: 12,
        overflow: "hidden",
      }}
    >
      {/* Group header — same shape mobile + desktop */}
      <header
        className="flex items-center justify-between"
        style={{
          background: colors.bgFaint,
          borderBottom: `1px solid ${colors.borderLight}`,
          padding: "12px 16px",
        }}
      >
        <div className="flex items-center" style={{ gap: 8, minWidth: 0 }}>
          <h2
            className="truncate"
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: colors.textPrimary,
              margin: 0,
            }}
          >
            {displayedName}
          </h2>
          {categoryLabel && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: colors.primary,
                background: colors.primaryBg,
                borderRadius: 6,
                padding: "2px 6px",
                whiteSpace: "nowrap",
              }}
            >
              {categoryLabel}
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: 11,
            color: colors.textMuted,
            whiteSpace: "nowrap",
            flexShrink: 0,
            marginLeft: 8,
          }}
        >
          {t("teamCount", { count: artistCount })}
        </span>
      </header>

      {/* Mobile: card list (visible < lg) */}
      <ul className="lg:hidden" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {group.artists.map((artist, idx) => (
          <ArtistCard
            key={artist.id}
            artist={artist}
            locale={locale}
            isLast={idx === group.artists.length - 1}
          />
        ))}
      </ul>

      {/* Desktop: table (visible >= lg) */}
      <div className="hidden lg:block">
        <div
          role="row"
          style={{
            display: "grid",
            gridTemplateColumns: "56px 1fr 1fr 80px 28px",
            background: colors.bgFaint,
            borderBottom: `2px solid ${colors.border}`,
            padding: "10px 20px",
            gap: 12,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: colors.textMuted,
          }}
        >
          <span />
          <span>{t("colArtist")}</span>
          <span>{t("colSubunits")}</span>
          <span>{t("colEvents")}</span>
          <span />
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {group.artists.map((artist, idx) => (
            <ArtistTableRow
              key={artist.id}
              artist={artist}
              locale={locale}
              isLast={idx === group.artists.length - 1}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
