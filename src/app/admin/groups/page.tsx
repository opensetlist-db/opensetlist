import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, pickTranslation } from "@/lib/utils";

export default async function GroupsListPage() {
  const groups = await prisma.group.findMany({
    include: { translations: true },
    orderBy: { createdAt: "desc" },
  });
  const data = serializeBigInt(groups);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">그룹 관리</h1>
        <Link
          href="/admin/groups/new"
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          새 그룹
        </Link>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-zinc-500">
          <tr>
            <th className="pb-2">이름</th>
            <th className="pb-2">타입</th>
            <th className="pb-2">카테고리</th>
            <th className="pb-2">게시판</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {data.map((group) => {
            const tr = pickTranslation(group.translations, "ko");
            return (
              <tr key={group.id} className="border-b border-zinc-100">
                <td className="py-2 font-medium">{tr?.name ?? "—"}</td>
                <td className="py-2">{group.type ?? "—"}</td>
                <td className="py-2">{group.category ?? "—"}</td>
                <td className="py-2">{group.hasBoard ? "O" : "X"}</td>
                <td className="py-2">
                  <Link
                    href={`/admin/groups/${group.id}/edit`}
                    className="text-blue-600 hover:underline"
                  >
                    편집
                  </Link>
                </td>
              </tr>
            );
          })}
          {data.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-zinc-400">
                등록된 그룹이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
