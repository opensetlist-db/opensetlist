"use client";

import { useRouter } from "next/navigation";

export default function DeleteButton({
  url,
  label,
}: {
  url: string;
  label?: string;
}) {
  const router = useRouter();

  async function handleDelete() {
    if (!confirm("정말 삭제하시겠습니까?")) return;

    const res = await fetch(url, { method: "DELETE" });
    if (res.ok) {
      router.refresh();
    } else {
      alert("삭제에 실패했습니다.");
    }
  }

  return (
    <button
      onClick={handleDelete}
      className="text-red-500 hover:underline"
    >
      {label ?? "삭제"}
    </button>
  );
}
