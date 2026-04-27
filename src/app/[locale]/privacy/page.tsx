import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import LegalLayout from "@/components/legal/LegalLayout";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const titles: Record<string, string> = {
    ko: "개인정보처리방침 — OpenSetlist",
    ja: "プライバシーポリシー — OpenSetlist",
    en: "Privacy Policy — OpenSetlist",
  };
  return {
    title: titles[locale] ?? titles.en,
    // Indexed for search but no link-graph traversal — legal pages
    // shouldn't pass authority to followed links.
    robots: { index: true, follow: false },
  };
}

export default async function PrivacyPage() {
  const locale = await getLocale();
  return <LegalLayout page="privacy" locale={locale} />;
}
