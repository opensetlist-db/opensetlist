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

/*
 * Locale switch target: the current locale-less pathname plus the
 * live query string and hash. Keeping the query is a redesign contract
 * requirement (03-v1.1) — search q/type/page and list filters must
 * survive a language change instead of resetting.
 *
 * The query is read from `window.location` at click time rather than
 * through `useSearchParams()`: this component sits in the root locale
 * layout, and `useSearchParams` there would force a Suspense boundary
 * around the whole shell (or client-render every statically generated
 * page up to the nearest one). A click handler only ever runs in the
 * browser, so reading `location` there is safe and costs nothing at
 * render time.
 */
type Props = {
  /** `header`: compact row in the ≥1100px header. `menu`: inside the dropdown. */
  variant?: "header" | "menu";
  /** Called after a locale is chosen (the menu closes itself with this). */
  onSelect?: () => void;
};

export function LanguageSwitcher({ variant = "header", onSelect }: Props) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div
      className={`flex items-center ${variant === "menu" ? "gap-3" : "gap-0.5"}`}
    >
      {routing.locales.map((l) => {
        const active = l === locale;
        return (
          <button
            key={l}
            type="button"
            lang={l}
            // `aria-pressed` exposes the active locale to assistive
            // tech — without it screen readers would only announce
            // the visual change (color + background), which is mute
            // information for non-sighted users.
            aria-pressed={active}
            onClick={() => {
              onSelect?.();
              if (active) return;
              router.replace(
                `${pathname}${window.location.search}${window.location.hash}`,
                { locale: l },
              );
            }}
            // Inactive colours live in classes (not inline style) so the
            // hover/pressed classes can override them.
            className={`flex min-h-11 items-center whitespace-nowrap rounded-lg py-2.5 text-[12px] ${
              active
                ? "font-bold"
                : "text-[color:var(--foreground)] hover:bg-[#edf4ff] hover:text-[#104aa9] active:bg-[#dae7ff] active:text-[#0c3d8c]"
            } ${variant === "header" ? "px-[5px] min-[1300px]:px-2" : "px-2"}`}
            style={
              active
                ? { background: colors.primaryBg, color: colors.primary }
                : undefined
            }
          >
            {LOCALE_LABELS[l] ?? l}
          </button>
        );
      })}
    </div>
  );
}
