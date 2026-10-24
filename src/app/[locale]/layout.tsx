import type { Metadata, Viewport } from "next";
import { GoogleAnalytics } from "@next/third-parties/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { BASE_URL } from "@/lib/config";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import FirstVisitTracker from "@/components/FirstVisitTracker";
import { SkipLink } from "@/components/SkipLink";
// Supply a real static face for every body weight in all three scripts.
// This keeps WebKit and Chromium on the same glyph/weight baseline,
// including CJK text measured by the share-card renderer. Fontsource's
// unicode ranges load only the subsets used by the page; no Google or
// locally installed font is needed (consistency-03-v3 font contract).
import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/500.css";
import "@fontsource/noto-sans-kr/600.css";
import "@fontsource/noto-sans-kr/700.css";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/500.css";
import "@fontsource/noto-sans-jp/600.css";
import "@fontsource/noto-sans-jp/700.css";
import "@fontsource/josefin-sans/400.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "../globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

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
  const th = await getTranslations({ locale, namespace: "Header" });

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>
          <FirstVisitTracker />
          {/* Skip link (03 contract). Its fallback target is a zero-size
              marker after the header rather than a wrapper around
              `children`: wrapping would insert a box between body's flex
              column and each page's outer element (whose width rules
              assume it is the direct flex item). */}
          <SkipLink label={th("skipToContent")} />
          <Nav />
          <span id="main-content" tabIndex={-1} className="outline-none" />
          {children}
          <Footer />
          <SpeedInsights />
        </NextIntlClientProvider>
      </body>
      {process.env.NEXT_PUBLIC_GA_ID && (
        <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />
      )}
    </html>
  );
}
