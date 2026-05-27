"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AlbumListingFormModal, {
  type ListingInitial,
} from "@/components/admin/AlbumListingFormModal";
import { isSafeExternalUrl } from "@/lib/utils";

export type ListingRow = {
  id: string;
  originalStoreName: string;
  originalEditionLabel: string | null;
  originalLanguage: string;
  productUrl: string | null;
  status: "active" | "sold_out" | "ended" | "unknown";
  translations: {
    locale: string;
    storeName: string | null;
    editionLabel: string | null;
  }[];
  bonusCount: number;
};

type Props = {
  albumId: string;
  listings: ListingRow[];
  storeNameSuggestions: string[];
};

// 2-state display — matches the form. Schema enum still has four
// values; sold_out + unknown render alongside active as "판매중" per
// the b03 read path (handoff doc).
const STATUS_LABELS: Record<ListingRow["status"], string> = {
  active: "판매중",
  sold_out: "판매중",
  unknown: "판매중",
  ended: "종료",
};
const STATUS_COLORS: Record<ListingRow["status"], string> = {
  active: "bg-emerald-100 text-emerald-700",
  sold_out: "bg-emerald-100 text-emerald-700",
  unknown: "bg-emerald-100 text-emerald-700",
  ended: "bg-zinc-100 text-zinc-500",
};

export default function ListingsClient({
  albumId,
  listings,
  storeNameSuggestions,
}: Props) {
  const router = useRouter();
  const [modal, setModal] = useState<ListingInitial | "new" | null>(null);

  async function handleDelete(id: string) {
    if (!confirm("정말 삭제하시겠습니까? 연결된 특전도 함께 삭제됩니다.")) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/album-listings/${id}`, {
        method: "DELETE",
      });
      if (res.ok) router.refresh();
      else alert("삭제에 실패했습니다.");
    } catch {
      alert("삭제에 실패했습니다. 네트워크를 확인해 주세요.");
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">매장별 구매처</h1>
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
            <th className="pb-2">매장</th>
            <th className="pb-2">에디션</th>
            <th className="pb-2">상태</th>
            <th className="pb-2">구매 URL</th>
            <th className="pb-2 text-right">특전</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {listings.map((l) => (
            <tr key={l.id} className="border-b border-zinc-100 align-top">
              <td className="py-2 font-medium">{l.originalStoreName}</td>
              <td className="py-2 text-zinc-500">
                {l.originalEditionLabel ?? "—"}
              </td>
              <td className="py-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[l.status]}`}
                >
                  {STATUS_LABELS[l.status]}
                </span>
              </td>
              <td className="max-w-xs truncate py-2 font-mono text-xs">
                {/* Same scheme allowlist as the public buy button —
                    operator-entered productUrl can be `javascript:` or
                    other malicious schemes; render as plain text rather
                    than a click-through anchor when the URL isn't a
                    real http(s) target. The check is shared with
                    ListingCard via lib/utils so both surfaces enforce
                    the identical rule. */}
                {isSafeExternalUrl(l.productUrl) ? (
                  <a
                    href={l.productUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-blue-600 hover:underline"
                  >
                    {l.productUrl}
                  </a>
                ) : l.productUrl ? (
                  <span className="text-amber-700" title="잘못된 URL 형식">
                    {l.productUrl}
                  </span>
                ) : (
                  <span className="text-zinc-400">없음</span>
                )}
              </td>
              <td className="py-2 text-right">
                <Link
                  href={`/admin/albums/${albumId}/listings/${l.id}/bonuses`}
                  className="text-blue-600 hover:underline"
                >
                  {l.bonusCount}
                </Link>
              </td>
              <td className="space-x-2 py-2 whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => {
                    const { bonusCount: _ignored, ...listing } = l;
                    void _ignored;
                    setModal({ ...listing, albumId });
                  }}
                  className="text-blue-600 hover:underline"
                >
                  편집
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(l.id)}
                  className="text-red-500 hover:underline"
                >
                  삭제
                </button>
              </td>
            </tr>
          ))}
          {listings.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-center text-zinc-400">
                등록된 구매처가 없습니다. &ldquo;+ 추가&rdquo; 로 시작하세요.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {modal !== null && (
        <AlbumListingFormModal
          albumId={albumId}
          initialData={modal === "new" ? undefined : modal}
          storeNameSuggestions={storeNameSuggestions}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
