"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AlbumListingFormModal, {
  type ListingInitial,
} from "@/components/admin/AlbumListingFormModal";

export type ListingRow = {
  id: string;
  originalStoreName: string;
  originalEditionLabel: string | null;
  originalLanguage: string;
  productUrl: string | null;
  status: "active" | "sold_out" | "ended" | "unknown";
  startsAt: string | null;
  endsAt: string | null;
  lastVerifiedAt: string | null;
  sourceUrl: string | null;
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

const STATUS_LABELS: Record<ListingRow["status"], string> = {
  active: "구매 가능",
  sold_out: "매진",
  ended: "판매 종료",
  unknown: "미확인",
};
const STATUS_COLORS: Record<ListingRow["status"], string> = {
  active: "bg-emerald-100 text-emerald-700",
  sold_out: "bg-amber-100 text-amber-700",
  ended: "bg-zinc-100 text-zinc-500",
  unknown: "bg-zinc-100 text-zinc-700",
};

// 30 days in milliseconds — the schema-doc "stale" threshold for
// AlbumStoreListing.lastVerifiedAt. After this many ms since the
// operator last clicked "지금 확인", the row picks up a "확인 필요"
// badge so periodic sweeps surface it.
const STALE_MS = 30 * 24 * 60 * 60 * 1000;

function isStale(lastVerifiedAt: string | null): boolean {
  if (!lastVerifiedAt) return true;
  const d = new Date(lastVerifiedAt);
  if (Number.isNaN(d.getTime())) return true;
  // Both sides are absolute instants — Date.now() is fine to compare
  // against a stored UTC timestamp (per CLAUDE.md's UTC rule).
  return Date.now() - d.getTime() > STALE_MS;
}

function formatUtc(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // Inspect via getUTC* getters so the rendered slice doesn't drift
  // by the operator's TZ. The operator works in absolute terms; the
  // admin scope intentionally bypasses the public formatDate helper.
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

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
    const res = await fetch(`/api/admin/album-listings/${id}`, {
      method: "DELETE",
    });
    if (res.ok) router.refresh();
    else alert("삭제에 실패했습니다.");
  }

  async function handleTouch(id: string) {
    const res = await fetch(`/api/admin/album-listings/${id}/touch`, {
      method: "POST",
    });
    if (res.ok) router.refresh();
    else alert("업데이트에 실패했습니다.");
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
            <th className="pb-2">마지막 확인</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {listings.map((l) => {
            const stale = isStale(l.lastVerifiedAt);
            return (
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
                  {l.productUrl ? (
                    <a
                      href={l.productUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-blue-600 hover:underline"
                    >
                      {l.productUrl}
                    </a>
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
                <td className="py-2">
                  <span className="text-zinc-500">
                    {formatUtc(l.lastVerifiedAt)}
                  </span>
                  {stale && (
                    <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                      확인 필요
                    </span>
                  )}
                </td>
                <td className="space-x-2 py-2 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => {
                      // Strip the read-only bonusCount before
                      // handing the row to the modal — the form
                      // payload doesn't carry it and TS would
                      // otherwise complain about the excess key.
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
                    onClick={() => handleTouch(l.id)}
                    className="text-zinc-600 hover:underline"
                    title="lastVerifiedAt 을 지금으로 갱신"
                  >
                    지금 확인
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
            );
          })}
          {listings.length === 0 && (
            <tr>
              <td colSpan={7} className="py-4 text-center text-zinc-400">
                등록된 구매처가 없습니다. &ldquo;+ 추가&rdquo; 로 시작하세요.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {modal !== null && (
        <AlbumListingFormModal
          albumId={albumId}
          initialData={
            modal === "new"
              ? undefined
              : modal
          }
          storeNameSuggestions={storeNameSuggestions}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
