import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { QUERY_MAX_LENGTH } from "@/lib/globalSearch/params";
import { SearchIcon } from "./HomeIcons";
import styles from "./home.module.css";

/*
 * Home Hero (approved 14-v1.3). The artwork is the supplied FICTIONAL
 * arena image — never a photo or logo of a listed concert — and carries
 * a visible "fictional artwork" caption.
 *
 * Image: pre-built WebP derivatives of the untouched original
 * (`raw/Neon Starlight Idol Concert.png`, 2086×754) in
 * `public/images/home/`. Desktop serves the full frame (960/1440/2086w)
 * cropped by CSS at 50% 57%; under 700px a 1200px-wide slice whose left
 * edge keeps the approved 55% horizontal focus, so a phone downloads
 * the part it shows instead of the whole panorama. Pre-built rather
 * than next/image: one static asset, no optimizer quota, and the
 * art-directed crop needs `<picture>` anyway. The image is decorative
 * (`alt=""`); the caption states what it is.
 *
 * Search follows ticket 13's entry contract: GET `/{locale}/search` with
 * `q` only (overview, page 1), same as the header form.
 */
export async function HomeHero({ locale }: { locale: string }) {
  const t = await getTranslations("Hero");
  const th = await getTranslations("Header");
  const ts = await getTranslations("Search");

  return (
    <section className={styles.hero} aria-labelledby="home-title">
      <picture className={styles.heroPicture}>
        <source
          media="(max-width: 699px)"
          type="image/webp"
          srcSet="/images/home/hero-mobile-800.webp 800w, /images/home/hero-mobile-1200.webp 1200w"
          sizes="100vw"
        />
        <img
          src="/images/home/hero-desktop-1440.webp"
          srcSet="/images/home/hero-desktop-960.webp 960w, /images/home/hero-desktop-1440.webp 1440w, /images/home/hero-desktop-2086.webp 2086w"
          sizes="(max-width: 1311px) calc(100vw - 48px), 1280px"
          alt=""
          width={2086}
          height={754}
          fetchPriority="high"
          decoding="async"
        />
      </picture>

      <div className={styles.heroContent}>
        <p className={styles.heroEyebrow}>{t("eyebrow")}</p>
        <h1 id="home-title" className={styles.heroTitle}>
          {t.rich("heading", {
            line: (chunks) => (
              <span className={styles.heroTitleLine}>{chunks}</span>
            ),
          })}
        </h1>
        <p className={styles.heroLead}>{t("lead")}</p>

        <form
          role="search"
          action={`/${locale}/search`}
          method="get"
          className={styles.heroSearch}
        >
          <label htmlFor="hero-search" className="sr-only">
            {ts("inputLabel")}
          </label>
          <input
            id="hero-search"
            type="search"
            name="q"
            maxLength={QUERY_MAX_LENGTH}
            autoComplete="off"
            placeholder={th("searchPlaceholder")}
            className={styles.heroInput}
          />
          <button
            type="submit"
            aria-label={ts("submit")}
            className={styles.heroSubmit}
          >
            <SearchIcon />
          </button>
        </form>

        <div className={styles.heroActions}>
          <Link
            href={`/${locale}/events`}
            className={`${styles.button} ${styles.buttonPrimary}`}
          >
            {t("browse")}
          </Link>
          <Link
            href={`/${locale}/events?filter=completed`}
            className={`${styles.button} ${styles.buttonGlass}`}
          >
            {t("pastSetlists")}
          </Link>
        </div>
      </div>

      <span className={styles.heroCaption}>{t("caption")}</span>
    </section>
  );
}
