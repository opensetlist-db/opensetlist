"use client";

import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";

const LABELS: Record<string, { privacy: string; terms: string; contact: string }> = {
  ko: { privacy: "개인정보처리방침", terms: "이용약관", contact: "문의" },
  ja: { privacy: "プライバシーポリシー", terms: "利用規約", contact: "お問い合わせ" },
  en: { privacy: "Privacy Policy", terms: "Terms of Service", contact: "Contact" },
};

export function Footer() {
  const locale = useLocale();
  const l = LABELS[locale] ?? LABELS.en;

  return (
    <footer className="mt-auto border-t border-zinc-200 py-6 text-center text-sm text-zinc-400">
      <div className="mb-2 flex items-center justify-center gap-2">
        <Link href="/privacy" className="hover:text-zinc-600">
          {l.privacy}
        </Link>
        <span>&middot;</span>
        <Link href="/terms" className="hover:text-zinc-600">
          {l.terms}
        </Link>
        <span>&middot;</span>
        <a
          href="mailto:hello.opensetlist@gmail.com"
          className="hover:text-zinc-600"
        >
          {l.contact}
        </a>
      </div>
      <div>&copy; 2026 OpenSetlist</div>
    </footer>
  );
}
