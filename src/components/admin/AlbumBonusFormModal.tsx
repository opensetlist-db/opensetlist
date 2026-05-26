"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

export type BonusFormPayload = {
  listingId: string;
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

export type BonusInitial = BonusFormPayload & { id?: string };

type Props = {
  listingId: string;
  initialData?: BonusInitial;
  onClose: () => void;
};

const LOCALES = ["ko", "ja", "en", "zh-CN"];
const LANGUAGES = [
  { value: "ja", label: "일본어 (ja)" },
  { value: "en", label: "영어 (en)" },
  { value: "ko", label: "한국어 (ko)" },
  { value: "zh-CN", label: "중국어 (zh-CN)" },
];

// Same UTC↔input conversion as AlbumListingFormModal — kept inline
// rather than shared because the two modals are independent and the
// conversion is six lines each side. If a third modal needs it,
// promote to a shared lib.
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

function imageSource(
  url: string,
): { label: string; color: string; warn: boolean } {
  if (!url) return { label: "비어있음", color: "bg-zinc-100 text-zinc-500", warn: false };
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return { label: "잘못된 URL", color: "bg-red-100 text-red-700", warn: true };
  }
  if (
    host.endsWith(".media-amazon.com") ||
    host === "images-na.ssl-images-amazon.com" ||
    host === "m.media-amazon.com"
  ) {
    return { label: "Amazon", color: "bg-amber-100 text-amber-700", warn: false };
  }
  const r2Host = process.env.NEXT_PUBLIC_R2_PUBLIC_HOST;
  if (r2Host && host === r2Host.toLowerCase()) {
    return { label: "R2", color: "bg-emerald-100 text-emerald-700", warn: false };
  }
  return { label: "External", color: "bg-red-100 text-red-700", warn: true };
}

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
  const [originalBonusDescription, setOriginalBonusDescription] = useState(
    initialData?.originalBonusDescription ?? "",
  );
  const [originalLanguage, setOriginalLanguage] = useState(
    initialData?.originalLanguage ?? "ja",
  );
  const [bonusImageUrl, setBonusImageUrl] = useState(
    initialData?.bonusImageUrl ?? "",
  );
  const [startsAt, setStartsAt] = useState(
    utcIsoToInputValue(initialData?.startsAt ?? null),
  );
  const [endsAt, setEndsAt] = useState(
    utcIsoToInputValue(initialData?.endsAt ?? null),
  );
  const [translations, setTranslations] = useState(
    initialData?.translations ?? [],
  );

  function addTranslation() {
    const used = new Set(translations.map((t) => t.locale));
    const next = LOCALES.find((l) => !used.has(l));
    if (next)
      setTranslations((prev) => [
        ...prev,
        { locale: next, bonusType: null, bonusDescription: null },
      ]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const payload: BonusFormPayload = {
      listingId,
      originalBonusType: originalBonusType.trim(),
      originalBonusDescription: originalBonusDescription.trim() || null,
      originalLanguage,
      bonusImageUrl: bonusImageUrl.trim() || null,
      startsAt: inputValueToUtcIso(startsAt),
      endsAt: inputValueToUtcIso(endsAt),
      translations: translations
        .filter((t) => t.locale)
        .map((t) => ({
          locale: t.locale,
          bonusType: t.bonusType?.trim() || null,
          bonusDescription: t.bonusDescription?.trim() || null,
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

  const imgSrc = imageSource(bonusImageUrl);

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
              placeholder="예: B2 タペストリー (Mira)"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">원어</label>
            <select
              value={originalLanguage}
              onChange={(e) => setOriginalLanguage(e.target.value)}
              className="rounded border border-zinc-300 px-3 py-2"
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium">
            설명 (원어, 선택)
          </label>
          <textarea
            value={originalBonusDescription}
            onChange={(e) => setOriginalBonusDescription(e.target.value)}
            rows={2}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-sm font-medium">특전 이미지 URL</label>
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${imgSrc.color}`}
            >
              {imgSrc.label}
            </span>
          </div>
          <input
            value={bonusImageUrl}
            onChange={(e) => setBonusImageUrl(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 font-mono text-xs"
            placeholder="R2 URL 또는 Amazon CDN URL"
          />
          {imgSrc.warn && (
            <p className="mt-1 text-xs text-red-600">
              정책 외 URL입니다. 임시 placeholder라면 wiki/log.md 에 기록하세요.
            </p>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">
              시작 (UTC, 선택 — 비우면 구매처 시작 시간 상속)
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
              종료 (UTC, 선택 — 비우면 구매처 종료 시간 상속)
            </label>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </div>
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
          <div className="space-y-2">
            {translations.map((tr, i) => (
              <div
                key={i}
                className="grid grid-cols-[80px_1fr_2fr_auto] gap-2 rounded border border-zinc-200 bg-zinc-50 p-2"
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
                <input
                  placeholder="설명"
                  value={tr.bonusDescription ?? ""}
                  onChange={(e) =>
                    setTranslations((prev) =>
                      prev.map((t, j) =>
                        j === i
                          ? { ...t, bonusDescription: e.target.value }
                          : t,
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
