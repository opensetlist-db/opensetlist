import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { TabBar, type TabBarItem } from "@/components/TabBar";
import { LegalSection } from "@/components/legal/LegalSection";
import type { LegalContent } from "@/lib/types/legal";
import { colors, layout, radius, shadows } from "@/styles/tokens";

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

const EMPTY_CONTENT: LegalContent = { sections: [], lastUpdated: "" };

interface Props {
  page: LegalPageKey;
  locale: string;
}

export default async function LegalLayout({ page, locale }: Props) {
  const t = await getTranslations("legal");
  const content = CONTENT[`${page}:${locale}`] ?? EMPTY_CONTENT;

  const privacyTitle = t("privacyTitle");
  const termsTitle = t("termsTitle");
  const tabs: TabBarItem[] = [
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

  return (
    <main className="flex-1" style={{ background: colors.bgPage }}>
      <div className="mx-auto max-w-[480px] px-4 pb-20 pt-5 lg:max-w-[800px] lg:px-10 lg:pt-10">
        {/* Mobile tab bar above the grid; hidden on desktop where the
            sidebar takes over. */}
        <div className="mb-5 lg:hidden">
          <TabBar tabs={tabs} activeKey={page} />
        </div>

        <div className="lg:grid lg:grid-cols-[180px_1fr] lg:items-start lg:gap-10">
          {/* Desktop sidebar — sticky page switcher + section TOC.
              `top` is inline so the value derives from the
              `layout.navHeight.desktop` token rather than a Tailwind
              arbitrary value; the +16 is breathing room above the
              navbar bottom edge. The `lg:sticky` class still gates
              when sticky positioning kicks in. */}
          <aside
            className="hidden lg:sticky lg:block"
            style={{ top: layout.navHeight.desktop + 16 }}
          >
            <div className="mb-6">
              {tabs.map((tab) => {
                const isActive = tab.key === page;
                return (
                  <Link
                    key={tab.key}
                    href={tab.href}
                    aria-current={isActive ? "page" : undefined}
                    className="block text-[13px] transition-colors"
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      marginBottom: 2,
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? colors.primary : colors.textSubtle,
                      background: isActive
                        ? colors.primaryBg
                        : "transparent",
                      textDecoration: "none",
                    }}
                  >
                    {tab.label}
                  </Link>
                );
              })}
            </div>

            {!isEmpty && (
              <>
                <div
                  className="mb-2 text-[11px] font-bold uppercase"
                  style={{
                    color: colors.textMuted,
                    letterSpacing: "0.06em",
                  }}
                >
                  {t("tocLabel")}
                </div>
                {content.sections.map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    className="block text-[12px] leading-snug transition-colors"
                    style={{
                      color: colors.textSubtle,
                      padding: "5px 12px",
                      borderRadius: 6,
                      marginBottom: 2,
                      textDecoration: "none",
                    }}
                  >
                    {s.title}
                  </a>
                ))}
              </>
            )}
          </aside>

          {/* Body column. */}
          <div>
            {/* Document header card. */}
            <div
              className="overflow-hidden"
              style={{
                background: colors.bgCard,
                borderRadius: radius.card,
                padding: "24px 24px 20px",
                marginBottom: 16,
                boxShadow: shadows.card,
              }}
            >
              <div
                className="mb-2 text-[10px] font-bold uppercase"
                style={{
                  color: colors.primary,
                  letterSpacing: "0.08em",
                }}
              >
                {t("openSetlistLabel")}
              </div>
              <h1
                className="mb-2 text-[20px] font-bold lg:text-[22px]"
                style={{ color: colors.textPrimary }}
              >
                {documentTitle}
              </h1>
              {content.lastUpdated && (
                <div
                  className="text-[12px]"
                  style={{ color: colors.textMuted }}
                >
                  {t("lastUpdated")}: {content.lastUpdated}
                </div>
              )}
            </div>

            {/* Optional preamble paragraph between header + body. */}
            {content.intro && (
              <p
                className="mb-4 text-[13px]"
                style={{
                  color: colors.textSecondary,
                  lineHeight: 1.8,
                  paddingLeft: 4,
                  paddingRight: 4,
                }}
              >
                {content.intro}
              </p>
            )}

            {/* Body card — sections OR empty-state fallback. */}
            <div
              className="overflow-hidden"
              style={{
                background: colors.bgCard,
                borderRadius: radius.card,
                padding: "24px",
                boxShadow: shadows.card,
              }}
            >
              {isEmpty ? (
                <p
                  className="py-10 text-center text-[13px]"
                  style={{ color: colors.textMuted, lineHeight: 1.7 }}
                >
                  {t("unavailableInLocale")}
                </p>
              ) : (
                content.sections.map((s) => (
                  <LegalSection key={s.id} section={s} />
                ))
              )}
            </div>

            {/* Bottom page-switch link. */}
            <div
              className="mt-5 flex items-center justify-between"
              style={{
                background: colors.bgCard,
                borderRadius: 12,
                padding: "16px 20px",
                boxShadow: shadows.nav,
              }}
            >
              <span
                className="text-[12px]"
                style={{ color: colors.textMuted }}
              >
                {t(promptKey)}
              </span>
              <Link
                href={otherPageHref}
                className="text-[12px] font-semibold"
                style={{
                  color: colors.primary,
                  textDecoration: "none",
                }}
              >
                {t(ctaKey)}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
