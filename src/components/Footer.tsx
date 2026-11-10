"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { colors } from "@/styles/tokens";

// Email contact stays `help@...` per CLAUDE.md "Email: help@opensetlist.com".
// The handoff §3 suggested `hello.opensetlist@gmail.com` but the project
// convention is the source of truth — operator can flip in a separate PR
// if they want to change the canonical contact address.
const CONTACT_EMAIL = "help@opensetlist.com";

// Shared link treatment: 44px tall hit area, underline on hover.
const LINK_CLASS = "flex min-h-11 items-center hover:underline";

interface FooterLinkProps {
  href: "/privacy" | "/terms";
  active: boolean;
  children: React.ReactNode;
}

function FooterLink({ href, active, children }: FooterLinkProps) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={LINK_CLASS}
      style={{
        color: active ? colors.primary : colors.textPrimary,
        fontWeight: active ? 700 : 400,
      }}
    >
      {children}
    </Link>
  );
}

/*
 * Footer — redesign common contract 03-v1.1. Brand + the unofficial
 * fan-site statement (spec story 30) on the left, legal/contact links on
 * the right; stacked below 700px. Content column matches the 1200px main
 * content width with 24px minimum side gutters (20px on phones).
 */
export function Footer() {
  const t = useTranslations("Footer");
  const tHeader = useTranslations("Header");
  const pathname = usePathname();
  // UTC year so the rendered copyright doesn't flicker between regions
  // around Jan 1 (CLAUDE.md "UTC is the only correct default" — applies
  // even to display-cosmetic year reads since the alternative is local
  // tz which is non-deterministic on Vercel edge).
  const currentYear = new Date().getUTCFullYear();

  return (
    <footer
      className="mt-auto bg-white px-5 pb-[18px] pt-[26px] min-[700px]:px-[max(24px,calc((100vw-1200px)/2))] min-[700px]:pt-8"
      style={{ borderTop: `1px solid ${colors.border}` }}
    >
      <div className="min-[700px]:flex min-[700px]:items-center min-[700px]:justify-between min-[700px]:gap-[30px]">
        <div>
          <div className="flex items-center gap-2.5">
            <Image
              src="/images/opensetlist-symbol-40.svg"
              alt=""
              width={30}
              height={30}
              className="rounded-lg"
            />
            <span
              className="font-josefin pt-1 text-[19px] uppercase tracking-[0.02em]"
              style={{ color: colors.textPrimary }}
            >
              {tHeader("brandName")}
            </span>
          </div>
          <p
            className="my-3 max-w-[500px] text-[11px]"
            style={{ color: colors.textSecondary }}
          >
            {t("unofficial")}
          </p>
        </div>
        <nav
          aria-label={t("navLabel")}
          className="flex flex-wrap gap-5 text-[11px] min-[700px]:gap-6 min-[700px]:text-[12px]"
        >
          <FooterLink href="/privacy" active={pathname === "/privacy"}>
            {t("privacy")}
          </FooterLink>
          <FooterLink href="/terms" active={pathname === "/terms"}>
            {t("terms")}
          </FooterLink>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className={LINK_CLASS}
            style={{ color: colors.textPrimary }}
          >
            {t("contact")}
          </a>
        </nav>
      </div>
      <p
        className="mt-3 text-[10px] min-[700px]:mt-[18px]"
        style={{ color: colors.textSecondary }}
      >
        {t("copyright", { year: currentYear })}
      </p>
    </footer>
  );
}
