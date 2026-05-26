"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

export type ListingFormPayload = {
  albumId: string;
  originalStoreName: string;
  originalEditionLabel: string | null;
  originalLanguage: string;
  productUrl: string | null;
  status: "active" | "sold_out" | "ended" | "unknown";
  startsAt: string | null; // ISO
  endsAt: string | null;
  lastVerifiedAt: string | null;
  sourceUrl: string | null;
  translations: { locale: string; storeName: string | null; editionLabel: string | null }[];
};

export type ListingInitial = ListingFormPayload & { id?: string };

type Props = {
  albumId: string;
  initialData?: ListingInitial;
  storeNameSuggestions: string[];
  onClose: () => void;
};

const LOCALES = ["ko", "ja", "en", "zh-CN"];
const LANGUAGES = [
  { value: "ja", label: "일본어 (ja)" },
  { value: "en", label: "영어 (en)" },
  { value: "ko", label: "한국어 (ko)" },
  { value: "zh-CN", label: "중국어 (zh-CN)" },
];
const STATUSES: { value: ListingFormPayload["status"]; label: string }[] = [
  { value: "active", label: "active — 구매 가능" },
  { value: "sold_out", label: "sold_out — 매진" },
  { value: "ended", label: "ended — 판매 종료" },
  { value: "unknown", label: "unknown — 미확인" },
];

// `<input type="datetime-local">` wants the value formatted as
// `YYYY-MM-DDTHH:mm` in **local time**, but everything we store and
// reason about server-side is in UTC (per CLAUDE.md "Date & Time —
// UTC is the only correct default"). Convert in both directions at
// the boundary: stored UTC → input string uses getUTC* getters so a
// 2025-12-01 UTC stays 2025-12-01 in the input regardless of where
// the operator's laptop happens to be; input string → stored UTC
// re-attaches the Z so `new Date()` parses it as UTC, not local.
function utcIsoToInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}
function inputValueToUtcIso(value: string): string | null {
  if (!value) return null;
  return `${value}:00.000Z`;
}

export default function AlbumListingFormModal({
  albumId,
  initialData,
  storeNameSuggestions,
  onClose,
}: Props) {
  const router = useRouter();
  const listId = useId();
  const [loading, setLoading] = useState(false);

  const [originalStoreName, setOriginalStoreName] = useState(
    initialData?.originalStoreName ?? "",
  );
  const [originalEditionLabel, setOriginalEditionLabel] = useState(
    initialData?.originalEditionLabel ?? "",
  );
  const [originalLanguage, setOriginalLanguage] = useState(
    initialData?.originalLanguage ?? "ja",
  );
  const [productUrl, setProductUrl] = useState(initialData?.productUrl ?? "");
  const [status, setStatus] = useState<ListingFormPayload["status"]>(
    initialData?.status ?? "unknown",
  );
  const [startsAt, setStartsAt] = useState(
    utcIsoToInputValue(initialData?.startsAt ?? null),
  );
  const [endsAt, setEndsAt] = useState(
    utcIsoToInputValue(initialData?.endsAt ?? null),
  );
  const [lastVerifiedAt, setLastVerifiedAt] = useState(
    utcIsoToInputValue(initialData?.lastVerifiedAt ?? null),
  );
  const [sourceUrl, setSourceUrl] = useState(initialData?.sourceUrl ?? "");
  const [translations, setTranslations] = useState(
    initialData?.translations ?? [],
  );

  function setNow() {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const v =
      `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}` +
      `T${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
    setLastVerifiedAt(v);
  }

  function addTranslation() {
    const used = new Set(translations.map((t) => t.locale));
    const next = LOCALES.find((l) => !used.has(l));
    if (next)
      setTranslations((prev) => [
        ...prev,
        { locale: next, storeName: null, editionLabel: null },
      ]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const payload: ListingFormPayload = {
      albumId,
      originalStoreName: originalStoreName.trim(),
      originalEditionLabel: originalEditionLabel.trim() || null,
      originalLanguage,
      productUrl: productUrl.trim() || null,
      status,
      startsAt: inputValueToUtcIso(startsAt),
      endsAt: inputValueToUtcIso(endsAt),
      lastVerifiedAt: inputValueToUtcIso(lastVerifiedAt),
      sourceUrl: sourceUrl.trim() || null,
      translations: translations
        .filter((t) => t.locale)
        .map((t) => ({
          locale: t.locale,
          storeName: t.storeName?.trim() || null,
          editionLabel: t.editionLabel?.trim() || null,
        })),
    };
    const url = initialData?.id
      ? `/api/admin/album-listings/${initialData.id}`
      : "/api/admin/album-listings";
    const method = initialData?.id ? "PATCH" : "POST";
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        router.refresh();
        onClose();
        return;
      }
      const body = await res.json().catch(() => null);
      alert(body?.error ?? "저장에 실패했습니다.");
    } catch {
      alert("저장에 실패했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
      >
        <h2 className="mb-4 text-xl font-bold">
          {initialData?.id ? "구매처 편집" : "새 구매처"}
        </h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              매장 이름 (원어)
            </label>
            <input
              list={`${listId}-stores`}
              value={originalStoreName}
              onChange={(e) => setOriginalStoreName(e.target.value)}
              required
              className="w-full rounded border border-zinc-300 px-3 py-2"
              placeholder="amazon_jp / animate / sofmap / …"
            />
            <datalist id={`${listId}-stores`}>
              {storeNameSuggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              에디션 (원어, 선택)
            </label>
            <input
              value={originalEditionLabel}
              onChange={(e) => setOriginalEditionLabel(e.target.value)}
              className="w-full rounded border border-zinc-300 px-3 py-2"
              placeholder="통상반은 비워두세요"
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">원어 코드</label>
            <select
              value={originalLanguage}
              onChange={(e) => setOriginalLanguage(e.target.value)}
              className="w-full rounded border border-zinc-300 px-3 py-2"
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">상태</label>
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as ListingFormPayload["status"])
              }
              className="w-full rounded border border-zinc-300 px-3 py-2"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium">구매 URL</label>
          <input
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 font-mono text-xs"
            placeholder="https://www.amazon.co.jp/dp/... (제휴 파라미터 그대로 붙여넣기)"
          />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">
              판매 시작 (UTC)
            </label>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">
              판매 종료 (UTC)
            </label>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <label className="font-medium text-zinc-600">
                마지막 확인 (UTC)
              </label>
              <button
                type="button"
                onClick={setNow}
                className="text-blue-600 hover:underline"
              >
                지금
              </button>
            </div>
            <input
              type="datetime-local"
              value={lastVerifiedAt}
              onChange={(e) => setLastVerifiedAt(e.target.value)}
              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium">
            공식 출처 URL (선택)
          </label>
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 font-mono text-xs"
            placeholder="공식 뉴스 / 사이트 URL"
          />
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium">로케일 별 라벨 (선택)</label>
            {translations.length < LOCALES.length && (
              <button
                type="button"
                onClick={addTranslation}
                className="text-sm text-blue-600 hover:underline"
              >
                + 로케일 추가
              </button>
            )}
          </div>
          {translations.length === 0 && (
            <p className="text-xs text-zinc-500">
              비어 있으면 모든 로케일에서 원어 라벨을 그대로 사용합니다.
            </p>
          )}
          <div className="space-y-2">
            {translations.map((tr, i) => (
              <div
                key={i}
                className="grid grid-cols-[80px_1fr_1fr_auto] gap-2 rounded border border-zinc-200 bg-zinc-50 p-2"
              >
                <select
                  value={tr.locale}
                  onChange={(e) =>
                    setTranslations((prev) =>
                      prev.map((t, j) =>
                        j === i ? { ...t, locale: e.target.value } : t,
                      ),
                    )
                  }
                  className="rounded border border-zinc-300 px-2 py-1 text-sm"
                >
                  {LOCALES.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                <input
                  placeholder="매장 이름"
                  value={tr.storeName ?? ""}
                  onChange={(e) =>
                    setTranslations((prev) =>
                      prev.map((t, j) =>
                        j === i ? { ...t, storeName: e.target.value } : t,
                      ),
                    )
                  }
                  className="rounded border border-zinc-300 px-2 py-1 text-sm"
                />
                <input
                  placeholder="에디션"
                  value={tr.editionLabel ?? ""}
                  onChange={(e) =>
                    setTranslations((prev) =>
                      prev.map((t, j) =>
                        j === i ? { ...t, editionLabel: e.target.value } : t,
                      ),
                    )
                  }
                  className="rounded border border-zinc-300 px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  onClick={() =>
                    setTranslations((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="text-sm text-red-500"
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}
