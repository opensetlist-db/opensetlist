"use client";

import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { useLocale } from "next-intl";
import { colors } from "@/styles/tokens";

/**
 * Locale labels are intentionally locale-INDEPENDENT — every viewer
 * sees each language in its own native script regardless of the
 * currently active locale. A Korean viewer should still recognise
 * "日本語" as Japanese and "English" as English; translating these
 * via i18n keys (so a Korean viewer sees "일본어" / "영어") would
 * defeat the whole point of a language switcher, since users are
 * usually looking for their *target* language by its native name,
 * not its name in their *current* language. This is the convention
 * followed by Wikipedia, Google, and basically every multi-locale
 * site — see also https://www.w3.org/International/questions/qa-navigation-design
 *
 * So this hardcoded map is not an i18n violation; it's the
 * deliberate exception. Do not move into messages/{locale}.json.
 */
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
            // `aria-pressed` exposes the active locale to assistive
            // tech — without it screen readers would only announce
            // the visual change (color + background), which is mute
            // information for non-sighted users.
            aria-pressed={active}
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
