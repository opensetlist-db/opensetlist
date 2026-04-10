import { prisma } from "@/lib/prisma";

async function getCounts() {
  const [groups, artists, songs, eventSeries, events, setlistItems] =
    await Promise.all([
      prisma.group.count(),
      prisma.artist.count({ where: { isDeleted: false } }),
      prisma.song.count({ where: { isDeleted: false } }),
      prisma.eventSeries.count({ where: { isDeleted: false } }),
      prisma.event.count({ where: { isDeleted: false } }),
      prisma.setlistItem.count({ where: { isDeleted: false } }),
    ]);
  return { groups, artists, songs, eventSeries, events, setlistItems };
}

export default async function AdminDashboard() {
  const counts = await getCounts();

  const cards = [
    { label: "그룹", count: counts.groups, href: "/admin/groups" },
    { label: "아티스트", count: counts.artists, href: "/admin/artists" },
    { label: "곡", count: counts.songs, href: "/admin/songs" },
    { label: "시리즈", count: counts.eventSeries, href: "/admin/event-series" },
    { label: "이벤트", count: counts.events, href: "/admin/events" },
    { label: "세트리스트 항목", count: counts.setlistItems, href: "#" },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">대시보드</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <a
            key={card.label}
            href={card.href}
            className="rounded-lg border border-zinc-200 bg-white p-4 transition hover:shadow-md"
          >
            <p className="text-sm text-zinc-500">{card.label}</p>
            <p className="mt-1 text-3xl font-bold">{card.count}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
