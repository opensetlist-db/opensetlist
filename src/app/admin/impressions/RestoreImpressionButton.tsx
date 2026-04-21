"use client";

import { useRouter } from "next/navigation";

export default function RestoreImpressionButton({
  rootImpressionId,
}: {
  rootImpressionId: string;
}) {
  const router = useRouter();

  async function handleRestore() {
    const res = await fetch(`/api/admin/impressions/${rootImpressionId}`, {
      method: "PATCH",
    });
    if (res.ok) {
      router.refresh();
    } else {
      alert("복원에 실패했습니다.");
    }
  }

  return (
    <button onClick={handleRestore} className="text-blue-600 hover:underline">
      복원
    </button>
  );
}
