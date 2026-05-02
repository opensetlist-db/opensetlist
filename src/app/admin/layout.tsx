import Link from "next/link";
import { verifyAdmin } from "@/lib/admin-auth";
import "@/app/globals.css";

const navItems = [
  { href: "/admin", label: "대시보드" },
  { href: "/admin/groups", label: "그룹" },
  { href: "/admin/artists", label: "아티스트" },
  { href: "/admin/songs", label: "곡" },
  { href: "/admin/event-series", label: "시리즈" },
  { href: "/admin/events", label: "이벤트" },
  { href: "/admin/impressions", label: "한줄감상" },
  { href: "/admin/reactions", label: "감정 태그" },
  { href: "/admin/import", label: "CSV 가져오기" },
  { href: "/admin/slug-generator", label: "Slug 생성기" },
  { href: "/admin/translation-debug", label: "번역 디버그" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await verifyAdmin();

  return (
    <html lang="ko">
      {/* Layout responsively flips at lg (≥1024px):
          - Mobile: column stack with the sidebar collapsed to a
            horizontally-scrollable nav strip above the main column,
            so admin forms get the full viewport width for data entry
            (the prior fixed `w-52` sidebar consumed 55–65 % of a
            320–375 px screen and left the form column unusable).
          - Desktop: identical to before — fixed 208 px sidebar on
            the left, vertical nav, `border-r`, `p-6` main padding.
          Intentionally minimal: no drawer, no client component, no
          state. The admin scope is operator-only (per CLAUDE.md's
          admin-scope exemption) and the operator is one person, so
          the simplest className-only swap wins. */}
      <body className="flex min-h-screen flex-col bg-zinc-50 lg:flex-row">
        <aside className="w-full border-b border-zinc-200 bg-white p-4 lg:w-52 lg:shrink-0 lg:border-b-0 lg:border-r">
          <Link href="/admin" className="mb-3 block text-lg font-bold lg:mb-6">
            Admin
          </Link>
          <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0 lg:space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block whitespace-nowrap rounded px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </body>
    </html>
  );
}
