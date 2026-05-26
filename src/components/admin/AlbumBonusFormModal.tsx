"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ADMIN_LOCALES, ADMIN_LANGUAGES } from "@/lib/adminLocales";

export type BonusFormPayload = {
  listingId: string;
  originalBonusType: string;
  originalLanguage: string;
  translations: { locale: string; bonusType: string | null }[];
};

export type BonusInitial = BonusFormPayload & { id?: string };

type Props = {
  listingId: string;
  initialData?: BonusInitial;
  onClose: () => void;
};

export default function AlbumBonusFormModal({
  listingId,
  initialData,
  onClose,
}: Props) {
  const router = useRouter();
  const formId = useId();
  const [loading, setLoading] = useState(false);

  const [originalBonusType, setOriginalBonusType] = useState(
    initialData?.originalBonusType ?? "",
  );
  const [originalLanguage, setOriginalLanguage] = useState(
    initialData?.originalLanguage ?? "ja",
  );
  const [translations, setTranslations] = useState(
    initialData?.translations ?? [],
  );

  function addTranslation() {
    const used = new Set(translations.map((t) => t.locale));
    const next = ADMIN_LOCALES.find((l) => !used.has(l));
    if (next)
      setTranslations((prev) => [...prev, { locale: next, bonusType: null }]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const payload: BonusFormPayload = {
      listingId,
      originalBonusType: originalBonusType.trim(),
      originalLanguage,
      translations: translations
        .filter((t) => t.locale)
        .map((t) => ({
          locale: t.locale,
          bonusType: t.bonusType?.trim() || null,
        })),
    };
    const url = initialData?.id
      ? `/api/admin/album-bonuses/${initialData.id}`
      : "/api/admin/album-bonuses";
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
        id={formId}
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
      >
        <h2 className="mb-4 text-xl font-bold">
          {initialData?.id ? "특전 편집" : "새 특전"}
        </h2>

        <div className="grid grid-cols-[1fr_auto] gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              종류 (원어)
            </label>
            <input
              value={originalBonusType}
              onChange={(e) => setOriginalBonusType(e.target.value)}
              required
              className="w-full rounded border border-zinc-300 px-3 py-2"
              placeholder="예: B2 タペストリー (Mira) — 변형 마커는 같이 적으세요"
            />
            <p className="mt-1 text-xs text-zinc-500">
              한 줄로 끝나는 자유 텍스트. 캐릭터/디자인 변형이나 한정 수량
              같은 부가 정보도 이 필드 안에 괄호로 적어 주세요.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">원어</label>
            <select
              value={originalLanguage}
              onChange={(e) => setOriginalLanguage(e.target.value)}
              className="rounded border border-zinc-300 px-3 py-2"
            >
              {ADMIN_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium">로케일 별 라벨 (선택)</label>
            {translations.length < ADMIN_LOCALES.length && (
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
                className="grid grid-cols-[80px_1fr_auto] gap-2 rounded border border-zinc-200 bg-zinc-50 p-2"
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
                  {ADMIN_LOCALES.map((l) => {
                    // Same dup-locale guard as the listing modal —
                    // AlbumStoreBonusTranslation @@unique([bonusId,
                    // locale]) backs this on the server side.
                    const usedElsewhere =
                      l !== tr.locale &&
                      translations.some(
                        (other, j) => j !== i && other.locale === l,
                      );
                    return (
                      <option key={l} value={l} disabled={usedElsewhere}>
                        {l}
                      </option>
                    );
                  })}
                </select>
                <input
                  placeholder="종류"
                  value={tr.bonusType ?? ""}
                  onChange={(e) =>
                    setTranslations((prev) =>
                      prev.map((t, j) =>
                        j === i ? { ...t, bonusType: e.target.value } : t,
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
