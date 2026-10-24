import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { displayNameWithFallback } from "@/lib/display";
import { getArtistColor } from "@/lib/artistColor";
import { entityPath } from "@/lib/seo/entityUrl";
import type { ArtistRowData } from "@/lib/artists";
import {
  accentStyle,
  fallbackNameLang,
  firstGrapheme,
  originalLang,
} from "@/components/artists/artistDetail";
import {
  avatarAccent,
  avatarGlyphTone,
} from "@/components/artists/artistList";
import styles from "./artistList.module.css";

/*
 * One artist row on the list page (24-v1). A single DOM serves every
 * width: artistList.module.css re-places the cells — five columns from
 * 1100px, a two-line name/units stack with count and chevron on the
 * right below that, and under 700px a three-line stack with the count
 * beneath the chips. The old page shipped a mobile card and a desktop
 * table row side by side and hid one; the approved layout needs no such
 * split.
 *
 * The whole row is one link to the artist's canonical URL (DB slug via
 * `entityPath`). Main-unit chips stay plain text — the list has never
 * linked units separately, and the packet keeps that.
 */

const GLYPH_CLASS = {
  ink: styles.glyphInk,
  white: styles.glyphWhite,
  black: styles.glyphBlack,
} as const;

interface Props {
  artist: ArtistRowData;
  locale: string;
}

export default async function ArtistListRow({ artist, locale }: Props) {
  const [t, tEvent] = await Promise.all([
    getTranslations("Artist"),
    getTranslations("Event"),
  ]);

  // Full localized name → original name → translatable "unknown", so a
  // row never renders as a nameless link. Long names wrap (24-v1 drops
  // the old desktop ellipsis).
  const primaryName =
    displayNameWithFallback(artist, artist.translations, locale) ||
    t("unknown");
  const primaryLang = fallbackNameLang(artist, artist.translations, locale);
  // Avatar initial keys off the curated short handle (e.g. `C` for
  // Cerise Bouquet) before the full name — same rule the old list used.
  const initialSource =
    displayNameWithFallback(artist, artist.translations, locale, "short") ||
    primaryName;
  // Original-language subline only when it differs from what the row
  // already shows.
  const originalName =
    locale !== artist.originalLanguage &&
    artist.originalName &&
    primaryName !== artist.originalName
      ? artist.originalName
      : null;

  const units = artist.subArtists.map((s) => ({
    id: s.id,
    name:
      displayNameWithFallback(s, s.translations, locale, "full") ||
      t("unknown"),
    lang: fallbackNameLang(s, s.translations, locale),
  }));

  const color = getArtistColor(artist);

  return (
    <li>
      <Link
        href={entityPath("artists", locale, artist.id, artist.slug)}
        className={styles.row}
      >
        <span
          aria-hidden="true"
          className={`${styles.avatar} ${GLYPH_CLASS[avatarGlyphTone(color)]}`}
          style={accentStyle(avatarAccent(color))}
        >
          {firstGrapheme(initialSource)}
        </span>

        <span className={styles.name}>
          <span className={styles.nameLine}>
            <span className={styles.artistTitle} lang={primaryLang}>
              {primaryName}
            </span>
            {artist.hasOngoing && (
              <span className={styles.live}>
                <i aria-hidden="true" className={styles.liveDot} />
                {tEvent("live")}
              </span>
            )}
          </span>
          {originalName && (
            <span
              className={styles.originalName}
              lang={originalLang(artist.originalLanguage, locale)}
            >
              {originalName}
            </span>
          )}
        </span>

        {/* Desktop shows a dash for "no listed main units"; the narrower
            bands hide it and pull the count up a row (`:has(.noUnits)`). */}
        {units.length > 0 ? (
          <span className={styles.units}>
            {units.map((u) => (
              <span key={u.id} className={styles.unitChip} lang={u.lang}>
                {u.name}
              </span>
            ))}
          </span>
        ) : (
          <span className={`${styles.units} ${styles.noUnits}`}>
            <span aria-hidden="true">—</span>
          </span>
        )}

        <span className={styles.eventCount}>
          <b>{artist.totalEvents}</b>
          <small>{t("eventsLabel")}</small>
        </span>
        <span aria-hidden="true" className={styles.chevron}>
          ›
        </span>
      </Link>
    </li>
  );
}
