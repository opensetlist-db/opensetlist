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
    title: `${t("termsTitle")} — OpenSetlist`,
    alternates: staticAlternates(locale, "/terms"),
    robots: { index: true, follow: false },
  };
}

export default async function TermsPage() {
  const locale = await getLocale();
  return <LegalLayout page="terms" locale={locale} />;
}
