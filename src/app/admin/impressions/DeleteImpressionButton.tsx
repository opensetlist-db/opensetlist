"use client";

import { useRouter } from "next/navigation";

export default function DeleteImpressionButton({
  rootImpressionId,
}: {
  rootImpressionId: string;
}) {
  const router = useRouter();

  async function handleDelete() {
    if (!confirm("이 한줄평을 삭제하시겠습니까?")) return;

    const res = await fetch(`/api/admin/impressions/${rootImpressionId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      router.refresh();
    } else {
      alert("삭제에 실패했습니다.");
    }
  }

  return (
    <button onClick={handleDelete} className="text-red-500 hover:underline">
      삭제
    </button>
  );
}
