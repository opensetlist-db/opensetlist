import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import LegalLayout from "@/components/legal/LegalLayout";
import { staticAlternates } from "@/lib/seo/entityUrl";

export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([
    getTranslations("legal"),
    getLocale(),
  ]);
  return {
    title: `${t("privacyTitle")} — OpenSetlist`,
    alternates: staticAlternates(locale, "/privacy"),
    // Indexed for search but no link-graph traversal — legal pages
    // shouldn't pass authority to followed links.
    robots: { index: true, follow: false },
  };
}

export default async function PrivacyPage() {
  const locale = await getLocale();
  return <LegalLayout page="privacy" locale={locale} />;
}
