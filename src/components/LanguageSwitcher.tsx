"use client";

import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { useLocale } from "next-intl";
import { colors } from "@/styles/tokens";

const LOCALE_LABELS: Record<string, string> = {
  ko: "한국어",
  ja: "日本語",
  en: "English",
};

export function LanguageSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex gap-1 text-sm">
      {routing.locales.map((l) => {
        const active = l === locale;
        return (
          <button
            key={l}
            type="button"
            onClick={() => router.replace(pathname, { locale: l })}
            className="rounded px-2 py-1 transition-colors"
            style={{
              // Selected pill mirrors the primary/primaryBg pair used
              // by the rest of the app's "active" surfaces (StatusBadge,
              // ArtistBadge, FilterBar) — keeps the locale chooser
              // visually consistent with the other selectable chips
              // instead of standing out as a hard dark pill. Bumped
              // weight on the active item compensates for the lower
              // text-on-tint contrast vs. the previous white-on-zinc.
              background: active ? colors.primaryBg : "transparent",
              color: active ? colors.primary : colors.textSubtle,
              fontWeight: active ? 600 : 400,
            }}
          >
            {LOCALE_LABELS[l] ?? l}
          </button>
        );
      })}
    </div>
  );
}
