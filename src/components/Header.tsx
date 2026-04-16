"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

type NavItem = { key: "home" | "artists" | "events" | "tours"; href: string };

const NAV_ITEMS: NavItem[] = [
  { key: "home", href: "/" },
  { key: "artists", href: "/artists" },
  { key: "events", href: "/events" },
  { key: "tours", href: "/series" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Header() {
  const t = useTranslations("Header");
  const pathname = usePathname();

  return (
    <header
      className="flex h-[60px] items-center justify-between border-b border-[#e8e8e8] bg-white px-4 md:px-8"
      style={{ borderBottomWidth: "0.5px" }}
    >
      <Link href="/" className="flex items-center gap-2.5">
        <span
          className="inline-flex h-[34px] w-[34px] overflow-hidden rounded-lg"
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
          style={{ color: "#1a1a1a", letterSpacing: 0 }}
        >
          OpenSetlist
        </span>
      </Link>

      <div className="flex items-center gap-4 md:gap-7">
        <nav className="hidden md:flex items-center gap-7">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                className="font-dm-sans text-[13px]"
                style={{
                  color: active ? "#0288D1" : "#555555",
                  fontWeight: active ? 500 : 400,
                }}
              >
                {t(item.key)}
              </Link>
            );
          })}
        </nav>

        <LanguageSwitcher />

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
            background: "linear-gradient(135deg, #4FC3F7, #0277BD)",
          }}
        >
          {t("signIn")}
        </button>
      </div>
    </header>
  );
}
