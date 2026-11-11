import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { displayNameWithFallback } from "@/lib/display";
import { getArtistColor } from "@/lib/artistColor";
import { entityPath } from "@/lib/seo/entityUrl";
import type { ArtistRowData } from "@/lib/artists";
import {
  accentStyle,
  firstGrapheme,
} from "@/components/artists/artistDetail";
import {
  avatarAccent,
  avatarGlyphTone,
} from "@/components/artists/artistList";
import { IdentityName, identityName } from "./IdentityName";
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

  const name = identityName(artist, locale, t("unknown"));
  // Avatar initial keys off the curated short handle (e.g. `C` for
  // Cerise Bouquet) before the full name — same rule the old list used.
  const initialSource =
    displayNameWithFallback(artist, artist.translations, locale, "short") ||
    name.main;
  const units = artist.subArtists.map((unit) => ({
    id: unit.id,
    name: identityName(unit, locale, t("unknown")),
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
            <span className={styles.artistTitle} lang={name.lang}>
              {name.main}
            </span>
            {artist.hasOngoing && (
              <span className={styles.live}>
                <i aria-hidden="true" className={styles.liveDot} />
                {tEvent("live")}
              </span>
            )}
          </span>
          {name.sub && (
            <span
              className={styles.originalName}
              lang={locale}
            >
              {name.sub}
            </span>
          )}
        </span>

        {/* Desktop shows a dash for "no listed main units"; the narrower
            bands hide it and pull the count up a row (`:has(.noUnits)`). */}
        {units.length > 0 ? (
          <span className={styles.units}>
            {units.map((u) => (
              <span key={u.id} className={styles.unitChip}>
                <IdentityName name={u.name} />
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
