import type { Metadata } from "next";
import Link from "next/link";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { CACHE_TTL, timeBucket } from "@/lib/dataCache";
import { getCachedHomeData } from "@/lib/homeEvents";
import { projectHomeCard, projectUpcomingCard } from "@/lib/homeView";
import { routing } from "@/i18n/routing";
import { staticAlternates } from "@/lib/seo/entityUrl";
import { HomeHero } from "@/components/home/HomeHero";
import { UpcomingCard } from "@/components/home/UpcomingCard";
import { CompactEventCard } from "@/components/home/CompactEventCard";
import styles from "@/components/home/home.module.css";

// hreflang lives on the homepage (not the locale layout) so the canonical
// only applies to the locale root. A layout-level canonical would be
// inherited by every child page (e.g. /ko/songs/789), pointing them all at
// the home URL — search engines would then de-prioritize the actual content
// pages. x-default follows the site-wide policy in `staticAlternates`:
// the default-locale (ja) URL, same as every entity page.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: staticAlternates(locale, "") };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Mirror the [locale]/layout.tsx guard. RSC streaming runs the layout
  // and page in parallel, so the layout's notFound() doesn't short-circuit
  // the page's data fetching — without this guard, requests like /.env or
  // /.git (which bypass the next-intl middleware matcher because the path
  // contains a dot) reach formatDate() with locale=".env" and crash inside
  // Date.toLocaleDateString with RangeError. The guard has to run before
  // any locale-dependent work, not just before render.
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const t = await getTranslations("Home");
  const evT = await getTranslations("Event");
  const unknown = evT("unknownEvent");

  // Same instant the cached lists were computed against (see
  // `getCachedHomeData`), so D-N labels and prediction badges agree with
  // the section an event landed in.
  const bucketMs = timeBucket(new Date(), CACHE_TTL.home);
  const now = new Date(bucketMs);
  const home = await getCachedHomeData(bucketMs);

  const ongoing = home.ongoing.map((e) => projectHomeCard(e, locale, unknown));
  const upcoming = home.upcoming.map((e) =>
    projectUpcomingCard(e, locale, unknown, now),
  );
  const past = home.past.map((e) => projectHomeCard(e, locale, unknown));

  const eventsHref = `/${locale}/events`;
  const pastHref = `/${locale}/events?filter=completed`;

  return (
    <main className={styles.page}>
      <HomeHero locale={locale} />

      <div className={styles.content}>
        {/* Ongoing appears only while something is live — and then above
            upcoming, with no count cap (14 contract). */}
        {ongoing.length > 0 && (
          <section className={styles.section} aria-labelledby="ongoing-title">
            <div className={styles.sectionHead}>
              <div>
                <p className={styles.eyebrow}>{t("liveEyebrow")}</p>
                <h2
                  id="ongoing-title"
                  className={`${styles.sectionTitle} ${styles.liveTitle}`}
                >
                  {t("liveTitle")}
                </h2>
              </div>
            </div>
            <div className={styles.compactGrid}>
              {ongoing.map((v) => (
                <CompactEventCard key={v.id} view={v} live />
              ))}
            </div>
          </section>
        )}

        <section className={styles.section} aria-labelledby="upcoming-title">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.eyebrow}>{t("upcomingEyebrow")}</p>
              <h2 id="upcoming-title" className={styles.sectionTitle}>
                {t("upcomingTitle")}
              </h2>
            </div>
            <Link href={eventsHref} className={styles.textLink}>
              {t("allConcerts")} ↗
            </Link>
          </div>
          {upcoming.length >= 2 && (
            <p className={styles.railHint}>{t("railHint")}</p>
          )}
          {upcoming.length > 0 ? (
            // Focusable region: on mobile this is the one horizontally
            // scrolling strip, and keyboard users scroll it with the
            // arrow keys once it has focus (cards are links, so Tab
            // also walks it).
            <div
              className={styles.rail}
              data-count={upcoming.length}
              role="region"
              aria-labelledby="upcoming-title"
              tabIndex={0}
            >
              {upcoming.map((v) => (
                <UpcomingCard key={v.id} view={v} />
              ))}
            </div>
          ) : (
            <EmptyNotice
              message={t("emptyUpcoming")}
              href={eventsHref}
              label={t("browse")}
            />
          )}
        </section>

        <section className={styles.section} aria-labelledby="past-title">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.eyebrow}>{t("pastEyebrow")}</p>
              <h2 id="past-title" className={styles.sectionTitle}>
                {home.pastMode === "recent"
                  ? t("recentTitle")
                  : t("archiveTitle")}
              </h2>
            </div>
            <Link href={pastHref} className={styles.textLink}>
              {t("pastLink")} ↗
            </Link>
          </div>
          {home.pastMode !== "none" && (
            <p className={styles.sectionIntro}>
              {home.pastMode === "recent" ? t("recentNote") : t("archiveNote")}
            </p>
          )}
          {past.length > 0 ? (
            <div className={styles.compactGrid}>
              {past.map((v) => (
                <CompactEventCard key={v.id} view={v} />
              ))}
            </div>
          ) : (
            <EmptyNotice
              message={t("emptyPast")}
              href={eventsHref}
              label={t("browse")}
            />
          )}
        </section>
      </div>
    </main>
  );
}

/** Compact empty state that keeps a real browsing entry point. */
function EmptyNotice({
  message,
  href,
  label,
}: {
  message: string;
  href: string;
  label: string;
}) {
  return (
    <div className={styles.empty}>
      <p>{message}</p>
      <Link href={href} className={styles.textLink}>
        {label} →
      </Link>
    </div>
  );
}
