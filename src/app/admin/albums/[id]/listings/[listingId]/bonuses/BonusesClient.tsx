"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AlbumBonusFormModal, {
  type BonusInitial,
} from "@/components/admin/AlbumBonusFormModal";

export type BonusRow = {
  id: string;
  originalBonusType: string;
  originalLanguage: string;
  translations: { locale: string; bonusType: string | null }[];
};

type Props = {
  listingId: string;
  bonuses: BonusRow[];
};

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
            <th className="pb-2">종류 (원어)</th>
            <th className="pb-2">로케일 라벨</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {bonuses.map((b) => {
            // Compact translation summary so the operator can see
            // at a glance which locales are filled without opening
            // the edit modal.
            const tlSummary = b.translations
              .filter((tr) => tr.bonusType)
              .map((tr) => `${tr.locale}: ${tr.bonusType}`)
              .join(" · ");
            return (
              <tr key={b.id} className="border-b border-zinc-100 align-top">
                <td className="py-2 font-medium">{b.originalBonusType}</td>
                <td className="py-2 text-zinc-500">{tlSummary || "—"}</td>
                <td className="space-x-2 py-2 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() =>
                      setModal({
                        listingId,
                        originalBonusType: b.originalBonusType,
                        originalLanguage: b.originalLanguage,
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
            );
          })}
          {bonuses.length === 0 && (
            <tr>
              <td colSpan={3} className="py-4 text-center text-zinc-400">
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
