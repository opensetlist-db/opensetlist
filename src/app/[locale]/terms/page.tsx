import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import LegalLayout from "@/components/legal/LegalLayout";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal");
  return {
    title: `${t("termsTitle")} — OpenSetlist`,
    robots: { index: true, follow: false },
  };
}

export default async function TermsPage() {
  const locale = await getLocale();
  return <LegalLayout page="terms" locale={locale} />;
}
