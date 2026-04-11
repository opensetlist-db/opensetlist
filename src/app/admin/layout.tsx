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
  { href: "/admin/import", label: "CSV 가져오기" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await verifyAdmin();

  return (
    <html lang="ko">
      <body className="flex min-h-screen bg-zinc-50">
        <aside className="w-52 shrink-0 border-r border-zinc-200 bg-white p-4">
          <Link href="/admin" className="mb-6 block text-lg font-bold">
            Admin
          </Link>
          <nav className="space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="flex-1 p-6">{children}</main>
      </body>
    </html>
  );
}
