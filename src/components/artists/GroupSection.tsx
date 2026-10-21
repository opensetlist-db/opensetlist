import { getTranslations } from "next-intl/server";
import { displayNameWithFallback } from "@/lib/display";
import type { GroupForList } from "@/lib/artists";
import ArtistListRow from "@/components/artists/ArtistListRow";
import { fallbackNameLang } from "@/components/artists/artistDetail";
import styles from "./artistList.module.css";

/*
 * One group panel on the artists list (24-v1): heading band with the
 * group name, category badge and team count, a desktop-only column
 * header, then one row per top-level artist.
 *
 * Group ordering (ongoing-pinned, then alphabetical; synthetic buckets
 * last) happens at the data layer in `getArtistGroupsForList`. This
 * component renders one group at the position the page placed it.
 *
 * Synthetic sections (ungrouped artists) have no Group row: their
 * heading comes from i18n and takes the neutral `.synthetic` band, and
 * nothing here links to a group destination.
 */

interface Props {
  group: GroupForList;
  locale: string;
}

const CATEGORY_LABEL_KEY: Record<NonNullable<GroupForList["category"]>, string> =
  {
    animegame: "categoryAnimegame",
    kpop: "categoryKpop",
    jpop: "categoryJpop",
    cpop: "categoryCpop",
    others: "categoryOthers",
  };

export default async function GroupSection({ group, locale }: Props) {
  const t = await getTranslations("Artist");

  // Real Groups: localized full name → originalName → t("unknownGroup").
  // Synthetic buckets: `ungroupedSection` for a category bucket,
  // `ungroupedNoCategorySection` for the null-category one.
  const displayedName = group.isSynthetic
    ? group.category
      ? t("ungroupedSection")
      : t("ungroupedNoCategorySection")
    : displayNameWithFallback(group, group.translations, locale) ||
      t("unknownGroup");
  const titleLang = group.isSynthetic
    ? undefined
    : fallbackNameLang(group, group.translations, locale);

  const categoryLabel = group.category
    ? t(CATEGORY_LABEL_KEY[group.category])
    : null;

  return (
    <section className={styles.group}>
      <header
        className={`${styles.groupHead}${group.isSynthetic ? ` ${styles.synthetic}` : ""}`}
      >
        <h2 className={styles.groupTitle} lang={titleLang}>
          {displayedName}
        </h2>
        {categoryLabel && <span className={styles.badge}>{categoryLabel}</span>}
        <span className={styles.teamCount}>
          {t("teamCount", { count: group.artists.length })}
        </span>
      </header>

      {/* Visual column labels for the ≥1100px five-column grid. The
          rows below are list items, not table cells, so these stay
          aria-hidden rather than promoting the list to a role="grid". */}
      <div className={styles.columnHead} aria-hidden="true">
        <span />
        <span>{t("colArtist")}</span>
        <span>{t("colSubunits")}</span>
        <span className={styles.columnHeadEvents}>{t("colEvents")}</span>
        <span />
      </div>

      <ul className={styles.list}>
        {group.artists.map((artist) => (
          <ArtistListRow key={artist.id} artist={artist} locale={locale} />
        ))}
      </ul>
    </section>
  );
}
