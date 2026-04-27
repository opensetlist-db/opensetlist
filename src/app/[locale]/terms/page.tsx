import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import LegalLayout from "@/components/legal/LegalLayout";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const titles: Record<string, string> = {
    ko: "이용약관 — OpenSetlist",
    ja: "利用規約 — OpenSetlist",
    en: "Terms of Service — OpenSetlist",
  };
  return {
    title: titles[locale] ?? titles.en,
    robots: { index: true, follow: false },
  };
}

export default async function TermsPage() {
  const locale = await getLocale();
  return <LegalLayout page="terms" locale={locale} />;
}
