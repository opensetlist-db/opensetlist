"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { colors } from "@/styles/tokens";

// Email contact stays `help@...` per CLAUDE.md "Email: help@opensetlist.com".
// The handoff §3 suggested `hello.opensetlist@gmail.com` but the project
// convention is the source of truth — operator can flip in a separate PR
// if they want to change the canonical contact address.
const CONTACT_EMAIL = "help@opensetlist.com";

interface FooterLinkProps {
  href: "/privacy" | "/terms";
  active: boolean;
  children: React.ReactNode;
}

function FooterLink({ href, active, children }: FooterLinkProps) {
  return (
    <Link
      href={href}
      style={{
        color: active ? colors.primary : colors.textSubtle,
        fontWeight: active ? 700 : 400,
      }}
      className="hover:underline"
    >
      {children}
    </Link>
  );
}

export function Footer() {
  const t = useTranslations("Footer");
  const pathname = usePathname();

  return (
    <footer
      className="mt-auto py-6 text-center text-sm"
      style={{
        borderTop: `1px solid ${colors.border}`,
        color: colors.textMuted,
      }}
    >
      <div className="mb-2 flex items-center justify-center gap-2 text-[12px]">
        <FooterLink href="/privacy" active={pathname === "/privacy"}>
          {t("privacy")}
        </FooterLink>
        <span style={{ color: colors.border }}>&middot;</span>
        <FooterLink href="/terms" active={pathname === "/terms"}>
          {t("terms")}
        </FooterLink>
        <span style={{ color: colors.border }}>&middot;</span>
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="hover:underline"
          style={{ color: colors.textSubtle }}
        >
          {t("contact")}
        </a>
      </div>
      <div className="text-[11px]">&copy; 2026 OpenSetlist</div>
    </footer>
  );
}
