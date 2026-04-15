"use client";

import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { useLocale } from "next-intl";

const LOCALE_LABELS: Record<string, string> = {
  ko: "한국어",
  ja: "日本語",
  en: "EN",
};

export function LanguageSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex gap-1 text-sm">
      {routing.locales.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => router.replace(pathname, { locale: l })}
          className={`rounded px-2 py-1 ${
            l === locale
              ? "bg-zinc-800 text-white"
              : "text-zinc-500 hover:bg-zinc-100"
          }`}
        >
          {LOCALE_LABELS[l] ?? l}
        </button>
      ))}
    </div>
  );
}
