"use client";

import Image from "next/image";
import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LAUNCH_FLAGS } from "@/lib/launchFlags";
import { colors } from "@/styles/tokens";

type NavItem = { key: "home" | "artists" | "events"; href: string };

const NAV_ITEMS: NavItem[] = [
  { key: "home", href: "/" },
  { key: "artists", href: "/artists" },
  { key: "events", href: "/events" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
  const t = useTranslations("Header");
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  return (
    <div ref={menuRef} className="relative">
      <header
        className="flex h-[52px] items-center justify-between bg-white px-4 lg:h-[56px] lg:px-8"
        style={{ borderBottom: `0.5px solid ${colors.border}` }}
      >
        <Link href="/" className="flex items-center gap-2.5">
          <span
            className="inline-flex h-[34px] w-[34px] overflow-hidden"
            style={{ borderRadius: "8px" }}
          >
            <Image
              src="/images/opensetlist-symbol-40.svg"
              alt=""
              width={34}
              height={34}
              priority
            />
          </span>
          <span
            className="font-josefin text-[17px] uppercase"
            style={{ color: colors.textPrimary, letterSpacing: 0 }}
          >
            {t("brandName")}
          </span>
        </Link>

        {/* Desktop right side */}
        <div className="hidden lg:flex items-center gap-7">
          <nav className="flex items-center gap-7">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className="font-dm-sans text-[13px]"
                  style={{
                    color: active ? colors.primary : colors.textSubtle,
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {t(item.key)}
                </Link>
              );
            })}
          </nav>

          <LanguageSwitcher />

          {LAUNCH_FLAGS.showSignIn && (
            <button
              type="button"
              disabled
              aria-disabled="true"
              title={t("signIn")}
              className="font-dm-sans rounded-md text-white opacity-60 cursor-not-allowed"
              style={{
                fontSize: "12px",
                fontWeight: 500,
                padding: "7px 16px",
                borderRadius: "6px",
                background: colors.brandGradient,
              }}
            >
              {t("signIn")}
            </button>
          )}
        </div>

        {/* Mobile / tablet hamburger */}
        <button
          type="button"
          className="lg:hidden flex flex-col justify-center items-center w-9 h-9 gap-1.5"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-label={menuOpen ? t("closeMenu") : t("openMenu")}
          aria-expanded={menuOpen}
        >
          <span
            className="block w-5 h-0.5 transition-transform duration-200"
            style={{
              background: colors.textSubtle,
              transform: menuOpen ? "translateY(8px) rotate(45deg)" : "none",
            }}
          />
          <span
            className="block w-5 h-0.5 transition-opacity duration-200"
            style={{
              background: colors.textSubtle,
              opacity: menuOpen ? 0 : 1,
            }}
          />
          <span
            className="block w-5 h-0.5 transition-transform duration-200"
            style={{
              background: colors.textSubtle,
              transform: menuOpen ? "translateY(-8px) rotate(-45deg)" : "none",
            }}
          />
        </button>
      </header>

      {/* Mobile / tablet dropdown */}
      {menuOpen && (
        <div
          className="lg:hidden absolute top-full left-0 right-0 z-50 bg-white shadow-sm"
          style={{ borderBottom: `1px solid ${colors.border}` }}
        >
          <nav className="flex flex-col px-4 py-2">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="font-dm-sans text-[15px] py-3"
                  style={{
                    color: active ? colors.primary : colors.textPrimary,
                    fontWeight: active ? 500 : 400,
                    borderBottom: `1px solid ${colors.borderLight}`,
                  }}
                >
                  {t(item.key)}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center justify-between px-4 py-4">
            <LanguageSwitcher />
            {LAUNCH_FLAGS.showSignIn && (
              <button
                type="button"
                disabled
                aria-disabled="true"
                title={t("signIn")}
                className="font-dm-sans rounded-md text-white opacity-60 cursor-not-allowed"
                style={{
                  fontSize: "13px",
                  fontWeight: 500,
                  padding: "8px 20px",
                  borderRadius: "6px",
                  background: colors.brandGradient,
                }}
              >
                {t("signIn")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
