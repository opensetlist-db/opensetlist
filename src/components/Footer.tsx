"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function Footer() {
  const t = useTranslations("Footer");

  return (
    <footer className="mt-auto border-t border-zinc-200 py-6 text-center text-sm text-zinc-400">
      <div className="mb-2 flex items-center justify-center gap-2">
        <Link href="/privacy" className="hover:text-zinc-600">
          {t("privacy")}
        </Link>
        <span>&middot;</span>
        <Link href="/terms" className="hover:text-zinc-600">
          {t("terms")}
        </Link>
        <span>&middot;</span>
        <a
          href="mailto:help@opensetlist.com"
          className="hover:text-zinc-600"
        >
          {t("contact")}
        </a>
      </div>
      <div>&copy; 2026 OpenSetlist</div>
    </footer>
  );
}
