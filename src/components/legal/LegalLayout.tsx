import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { LegalSection } from "@/components/legal/LegalSection";
import { LegalToc } from "@/components/legal/LegalToc";
import type { LegalContent } from "@/lib/types/legal";
import { formatDate } from "@/lib/utils";
import styles from "./legal.module.css";

// Local page-switch descriptor. Not using the shared `<TabBar>` component
// because privacy/terms are *separate routes* — the shared TabBar is
// query-param driven (`?tab=...` on a single route, used by the
// artist/song detail pages). Plain `<Link>`s with `aria-current="page"`
// keep legal-pages routing semantics intact.
type LegalTab = { key: "privacy" | "terms"; label: string; href: "/privacy" | "/terms" };

import privacyKo from "@/content/privacy/ko";
import privacyJa from "@/content/privacy/ja";
import privacyEn from "@/content/privacy/en";
import termsKo from "@/content/terms/ko";
import termsJa from "@/content/terms/ja";
import termsEn from "@/content/terms/en";

export type LegalPageKey = "privacy" | "terms";

// Static map of (page, locale) → content. Imports stay at module
// scope so the bundler can tree-shake unused locales per route. The
// fallback for unknown locales is `EMPTY_CONTENT`, which triggers the
// "Available in {KO} only" empty-state branch — defensive even though
// Phase 1A authors all three locales for both pages.
const CONTENT: Record<string, LegalContent> = {
  "privacy:ko": privacyKo,
  "privacy:ja": privacyJa,
  "privacy:en": privacyEn,
  "terms:ko": termsKo,
  "terms:ja": termsJa,
  "terms:en": termsEn,
};

const EMPTY_CONTENT: LegalContent = { sections: [] };

const LAST_UPDATED_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
};

interface Props {
  page: LegalPageKey;
  locale: string;
}

/**
 * Privacy / terms page body — approved redesign packet 34-v1.
 *
 * ≥1024px: 240px (210px below 1100) sticky sidebar with the page
 * switcher and section TOC, content column beside it. <1024px: the
 * sidebar is replaced by a two-choice route switcher above the title
 * card and a collapsed "Contents" `<details>` between the preamble and
 * the document. Both TOCs link the same source section ids.
 *
 * Content, numbering, revision dates and links come unchanged from
 * `src/content/{privacy,terms}/*` — this component only lays them out.
 */
export default async function LegalLayout({ page, locale }: Props) {
  const [t, ct] = await Promise.all([
    getTranslations("legal"),
    getTranslations("Common"),
  ]);
  const content = CONTENT[`${page}:${locale}`] ?? EMPTY_CONTENT;

  const privacyTitle = t("privacyTitle");
  const termsTitle = t("termsTitle");
  const tabs: LegalTab[] = [
    { key: "privacy", label: privacyTitle, href: "/privacy" },
    { key: "terms", label: termsTitle, href: "/terms" },
  ];

  const isPrivacy = page === "privacy";
  const documentTitle = isPrivacy ? privacyTitle : termsTitle;
  const otherPageHref = isPrivacy ? "/terms" : "/privacy";
  const promptKey = isPrivacy
    ? "bottomLinkPrivacyToTerms"
    : "bottomLinkTermsToPrivacy";
  const ctaKey = isPrivacy ? "bottomLinkViewTerms" : "bottomLinkViewPrivacy";

  const isEmpty = content.sections.length === 0;
  const tocSections = content.sections.map(({ id, title }) => ({ id, title }));

  // Rendered twice (sidebar ≥1024, route switcher <1024); CSS shows one.
  const pageLinks = tabs.map((tab) => (
    <Link
      key={tab.key}
      href={tab.href}
      aria-current={tab.key === page ? "page" : undefined}
    >
      {tab.label}
    </Link>
  ));

  return (
    <main className={styles.page}>
      <div className={styles.breadcrumb}>
        <Breadcrumb
          ariaLabel={ct("breadcrumb")}
          items={[
            { label: ct("home"), href: `/${locale}` },
            { label: documentTitle },
          ]}
        />
      </div>

      <nav
        aria-label={t("legalNavLabel")}
        className={`${styles.pageNav} ${styles.mobilePages}`}
      >
        {pageLinks}
      </nav>

      <div className={styles.grid}>
        <aside className={styles.sidebar}>
          <nav aria-label={t("legalNavLabel")} className={styles.pageNav}>
            {pageLinks}
          </nav>
          {!isEmpty && (
            <>
              {/* Visual heading only — the nav's aria-label already
                  names it for assistive tech. */}
              <p className={styles.tocTitle} aria-hidden="true">
                {t("tocLabel")}
              </p>
              <LegalToc
                sections={tocSections}
                ariaLabel={t("tocLabel")}
                className={styles.toc}
              />
            </>
          )}
        </aside>

        <div className={styles.content}>
          <div className={styles.titleCard}>
            <p className={styles.eyebrow}>{t("openSetlistLabel")}</p>
            <h1 className={styles.title}>{documentTitle}</h1>
            {content.lastUpdated && (
              <p className={styles.updated}>
                {t("lastUpdated")}:{" "}
                <time dateTime={content.lastUpdated}>
                  {formatDate(content.lastUpdated, locale, LAST_UPDATED_FORMAT)}
                </time>
              </p>
            )}
          </div>

          {/* Optional preamble paragraph between header + body. */}
          {content.intro && <p className={styles.intro}>{content.intro}</p>}

          {!isEmpty && (
            <details className={styles.mobileToc}>
              <summary>{t("tocLabel")}</summary>
              <LegalToc
                sections={tocSections}
                ariaLabel={t("tocLabel")}
                className={styles.toc}
              />
            </details>
          )}

          {/* Body — sections OR empty-state fallback. */}
          <article className={styles.document} aria-label={documentTitle}>
            {isEmpty ? (
              <p className={styles.empty}>{t("unavailableInLocale")}</p>
            ) : (
              content.sections.map((s) => (
                <LegalSection key={s.id} section={s} />
              ))
            )}
          </article>

          {/* Bottom page-switch link. Hidden when this locale's
              content is empty — the user landed on a "Korean only"
              fallback, and routing them to the *other* legal page in
              the same missing locale would just dead-end on another
              empty-state. */}
          {!isEmpty && (
            <div className={styles.bottomSwitch}>
              <p>{t(promptKey)}</p>
              <Link href={otherPageHref}>{t(ctaKey)}</Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
