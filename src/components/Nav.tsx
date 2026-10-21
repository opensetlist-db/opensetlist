"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useId } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LAUNCH_FLAGS } from "@/lib/launchFlags";
import { breakpoint, colors } from "@/styles/tokens";

/*
 * Site header — redesign common contract 03-v1.1
 * (`wiki/output/redesign/handoffs/03/v1.1/design-contract.md`).
 *
 * Bands (all in tokens: `breakpoint.nav`, `layout.navHeight`):
 *   ≥1100px  80px header: brand · 4 links · [search field] · 3 locales
 *   700–1099 68px header: brand · [search icon] · menu button
 *   <700px   64px header, same as tablet with tighter gutters
 * The 1100px threshold is header-only; page grids keep the 1024px
 * `breakpoint.desktop`. Tailwind's `min-[1100px]:` arbitrary variant
 * carries it in class names — keep it equal to `breakpoint.nav`.
 *
 * Search slot: the field (desktop) and icon (menu bands) render only
 * when `LAUNCH_FLAGS.showSearch` is on. There is no search page yet, so
 * shipping the controls now would be a dead entry point; ticket 13
 * builds `/[locale]/search` and flips the flag. The contract it inherits:
 * the field submits a plain GET to `/{locale}/search?q=…` (no
 * autocomplete), and the icon links to the same page without a query.
 */

type NavItem = { key: "home" | "artists" | "events" | "albums"; href: string };

const NAV_ITEMS: NavItem[] = [
  { key: "home", href: "/" },
  { key: "artists", href: "/artists" },
  { key: "events", href: "/events" },
  { key: "albums", href: "/albums" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={22}
      height={22}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
    >
      {open ? (
        <path d="M6 6l12 12M18 6 6 18" />
      ) : (
        <path d="M4 7h16M4 12h16M4 17h16" />
      )}
    </svg>
  );
}

// 44px square icon button surface shared by the search icon and the menu
// toggle (contract: 44px touch targets, hover #EDF4FF / pressed #DAE7FF).
const ICON_BUTTON =
  "grid h-11 w-11 place-items-center rounded-lg text-[color:var(--foreground)] hover:bg-[#edf4ff] active:bg-[#dae7ff]";

export function Nav() {
  const t = useTranslations("Header");
  const locale = useLocale();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Close the menu on navigation (covers browser back/forward, programmatic
  // routing, etc. — anything the per-Link onClick wouldn't catch). The
  // useState-pair "track previous prop" idiom (React docs: "Storing
  // information from previous renders") avoids both the
  // react-hooks/set-state-in-effect rule (no useEffect) and the
  // react-hooks/refs rule (no ref read/write in render).
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    if (menuOpen) setMenuOpen(false);
  }

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    // Escape closes the menu and returns focus to the toggle, so a
    // keyboard user is never left on a link that just disappeared. The
    // menu is ordinary page navigation, not a modal: no focus trap.
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    }
    // Widening past the header threshold swaps to the desktop header,
    // which has no dropdown; drop the open state so narrowing again
    // doesn't resurrect a stale menu.
    const wide = window.matchMedia(`(min-width: ${breakpoint.nav}px)`);
    function handleWide(e: MediaQueryListEvent) {
      if (e.matches) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    wide.addEventListener("change", handleWide);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
      wide.removeEventListener("change", handleWide);
    };
  }, [menuOpen]);

  const signIn = LAUNCH_FLAGS.showSignIn && (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title={t("signIn")}
      className="font-dm-sans cursor-not-allowed rounded-lg px-4 py-2 text-[13px] font-medium"
      style={{ background: "#edf0f5", color: colors.textMuted }}
    >
      {t("signIn")}
    </button>
  );

  return (
    <div
      ref={menuRef}
      className="relative z-[5] bg-white"
      style={{ borderBottom: `1px solid ${colors.border}` }}
    >
      <header className="mx-auto flex h-16 w-full max-w-[1376px] items-center gap-1 px-4 min-[700px]:h-[68px] min-[700px]:gap-2 min-[700px]:px-6 min-[1100px]:h-20 min-[1100px]:gap-[22px] min-[1300px]:gap-8 min-[1300px]:px-8">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 min-[700px]:gap-2.5"
        >
          <Image
            src="/images/opensetlist-symbol-40.svg"
            alt=""
            width={34}
            height={34}
            priority
            className="h-[30px] w-[30px] rounded-lg min-[700px]:h-[34px] min-[700px]:w-[34px]"
          />
          <span
            className="font-josefin pt-1 text-[17px] uppercase tracking-[0.02em] min-[700px]:text-[19px]"
            style={{ color: colors.textPrimary }}
          >
            {t("brandName")}
          </span>
        </Link>

        <nav
          aria-label={t("mainNav")}
          className="hidden items-center gap-4 whitespace-nowrap min-[1100px]:flex min-[1300px]:gap-6"
        >
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                // Active page exposed as `aria-current="page"` — a real
                // a11y signal (screen readers announce the current
                // section) and the stable structural anchor the e2e
                // suite keys on, matching the page TabBar convention.
                aria-current={active ? "page" : undefined}
                // The 2px bottom border is transparent on inactive links
                // so every link keeps the same height and the row never
                // shifts when the active section changes.
                // Inactive colours are classes so hover/pressed can win.
                className={`flex h-12 items-center border-b-2 text-[14px] ${
                  active
                    ? "font-medium"
                    : "border-transparent text-[color:var(--foreground)] hover:bg-[#edf4ff] hover:text-[#104aa9] active:bg-[#dae7ff] active:text-[#0c3d8c]"
                }`}
                style={
                  active
                    ? { color: colors.primary, borderBottomColor: colors.primary }
                    : undefined
                }
              >
                {t(item.key)}
              </Link>
            );
          })}
        </nav>

        {LAUNCH_FLAGS.showSearch && (
          <form
            role="search"
            action={`/${locale}/search`}
            method="get"
            className="relative ml-auto hidden w-[240px] min-w-[180px] items-center min-[1100px]:flex min-[1300px]:w-[300px]"
          >
            <label htmlFor="header-search" className="sr-only">
              {t("search")}
            </label>
            <input
              id="header-search"
              type="search"
              name="q"
              autoComplete="off"
              placeholder={t("searchPlaceholder")}
              className="h-11 w-full rounded-lg border bg-[#f8faff] pl-3.5 pr-[45px] text-[12px] placeholder:text-[color:#52617a]"
              style={{ borderColor: colors.borderStrong, color: colors.textPrimary }}
            />
            <button
              type="submit"
              aria-label={t("search")}
              className="absolute right-px grid h-[42px] w-11 place-items-center rounded-lg hover:bg-[#edf4ff] active:bg-[#dae7ff]"
              style={{ color: colors.primary }}
            >
              <SearchIcon />
            </button>
          </form>
        )}

        {/* Desktop right group. `ml-auto` lands on whichever element is
            first after the links: the search form when it is shown,
            otherwise this group. */}
        <div
          className={`hidden items-center gap-4 min-[1100px]:flex ${LAUNCH_FLAGS.showSearch ? "" : "ml-auto"}`}
        >
          <LanguageSwitcher variant="header" />
          {signIn}
        </div>

        {/* Menu bands (<1100px): search icon + menu toggle. */}
        <div className="ml-auto flex items-center gap-1 min-[1100px]:hidden">
          {LAUNCH_FLAGS.showSearch && (
            <Link href="/search" aria-label={t("search")} className={ICON_BUTTON}>
              <SearchIcon />
            </Link>
          )}
          <button
            ref={toggleRef}
            type="button"
            className={ICON_BUTTON}
            style={menuOpen ? { background: colors.primaryBg } : undefined}
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-label={menuOpen ? t("closeMenu") : t("openMenu")}
            aria-expanded={menuOpen}
            aria-controls={menuId}
          >
            <MenuIcon open={menuOpen} />
          </button>
        </div>
      </header>

      {/* Menu dropdown. Unmounted while closed, so its links leave the
          tab order. */}
      {menuOpen && (
        <div
          id={menuId}
          className="absolute left-0 right-0 top-full z-50 bg-white px-6 pb-5 pt-3 min-[1100px]:hidden"
          style={{
            borderBottom: `1px solid ${colors.border}`,
            boxShadow: "0 18px 28px #17244520",
          }}
        >
          <nav aria-label={t("mainNav")} className="flex flex-col">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className="rounded-none px-2 py-3.5 text-[15px]"
                  style={{
                    color: active ? colors.primary : colors.textPrimary,
                    fontWeight: active ? 700 : 400,
                    borderBottom: `1px solid ${colors.border}`,
                  }}
                >
                  {t(item.key)}
                </Link>
              );
            })}
          </nav>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-[18px]">
            <LanguageSwitcher variant="menu" onSelect={() => setMenuOpen(false)} />
            {signIn}
          </div>
        </div>
      )}
    </div>
  );
}
