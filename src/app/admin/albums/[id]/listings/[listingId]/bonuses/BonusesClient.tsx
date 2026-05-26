"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AlbumBonusFormModal, {
  type BonusInitial,
} from "@/components/admin/AlbumBonusFormModal";

export type BonusRow = {
  id: string;
  originalBonusType: string;
  originalBonusDescription: string | null;
  originalLanguage: string;
  bonusImageUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  translations: {
    locale: string;
    bonusType: string | null;
    bonusDescription: string | null;
  }[];
};

type Props = {
  listingId: string;
  bonuses: BonusRow[];
};

function formatUtc(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export default function BonusesClient({ listingId, bonuses }: Props) {
  const router = useRouter();
  const [modal, setModal] = useState<BonusInitial | "new" | null>(null);

  async function handleDelete(id: string) {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    const res = await fetch(`/api/admin/album-bonuses/${id}`, {
      method: "DELETE",
    });
    if (res.ok) router.refresh();
    else alert("삭제에 실패했습니다.");
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">특전 관리</h1>
        <button
          type="button"
          onClick={() => setModal("new")}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          + 추가
        </button>
      </div>

      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-zinc-500">
          <tr>
            <th className="pb-2">종류</th>
            <th className="pb-2">설명</th>
            <th className="pb-2">이미지</th>
            <th className="pb-2">시작</th>
            <th className="pb-2">종료</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {bonuses.map((b) => (
            <tr key={b.id} className="border-b border-zinc-100 align-top">
              <td className="py-2 font-medium">{b.originalBonusType}</td>
              <td className="max-w-xs py-2 text-zinc-500">
                {b.originalBonusDescription ?? "—"}
              </td>
              <td className="py-2">
                {b.bonusImageUrl ? (
                  <a
                    href={b.bonusImageUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-blue-600 hover:underline"
                  >
                    링크
                  </a>
                ) : (
                  <span className="text-zinc-400">없음</span>
                )}
              </td>
              <td className="py-2 text-zinc-500">{formatUtc(b.startsAt)}</td>
              <td className="py-2 text-zinc-500">{formatUtc(b.endsAt)}</td>
              <td className="space-x-2 py-2 whitespace-nowrap">
                <button
                  type="button"
                  onClick={() =>
                    setModal({
                      listingId,
                      originalBonusType: b.originalBonusType,
                      originalBonusDescription: b.originalBonusDescription,
                      originalLanguage: b.originalLanguage,
                      bonusImageUrl: b.bonusImageUrl,
                      startsAt: b.startsAt,
                      endsAt: b.endsAt,
                      translations: b.translations,
                      id: b.id,
                    })
                  }
                  className="text-blue-600 hover:underline"
                >
                  편집
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(b.id)}
                  className="text-red-500 hover:underline"
                >
                  삭제
                </button>
              </td>
            </tr>
          ))}
          {bonuses.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-center text-zinc-400">
                등록된 특전이 없습니다. &ldquo;+ 추가&rdquo; 로 시작하세요.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {modal !== null && (
        <AlbumBonusFormModal
          listingId={listingId}
          initialData={modal === "new" ? undefined : modal}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
