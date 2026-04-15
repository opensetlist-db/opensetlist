import type { Metadata } from "next";
import { GoogleAnalytics } from "@next/third-parties/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { BASE_URL } from "@/lib/config";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import "@fontsource-variable/noto-sans-kr";
import "../globals.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const mt = await getTranslations({ locale, namespace: "Meta" });

  return {
    metadataBase: new URL(BASE_URL),
    title: "OpenSetlist",
    description: mt("description"),
    verification: {
      other: {
        "naver-site-verification": "ba0a8cbcd0d75b35340f288a129a4e0d8dbc71c9",
      },
    },
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>
          <header className="flex justify-end px-4 py-2">
            <LanguageSwitcher />
          </header>
          {children}
        </NextIntlClientProvider>
      </body>
      {process.env.NEXT_PUBLIC_GA_ID && (
        <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />
      )}
    </html>
  );
}
