"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Translation = { locale: string; name: string; description: string };

type GroupFormProps = {
  initialData?: {
    id: string;
    type: string | null;
    category: string | null;
    hasBoard: boolean;
    translations: Translation[];
  };
};

const GROUP_TYPES = ["franchise", "label", "agency", "series"];
const GROUP_CATEGORIES = ["anime", "kpop", "jpop", "cpop", "game"];
const LOCALES = ["ko", "ja", "en", "zh-CN"];

export default function GroupForm({ initialData }: GroupFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState(initialData?.type ?? "");
  const [category, setCategory] = useState(initialData?.category ?? "");
  const [hasBoard, setHasBoard] = useState(initialData?.hasBoard ?? false);
  const [translations, setTranslations] = useState<Translation[]>(
    initialData?.translations.length
      ? initialData.translations
      : [{ locale: "ko", name: "", description: "" }]
  );

  function updateTranslation(
    index: number,
    field: keyof Translation,
    value: string
  ) {
    setTranslations((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t))
    );
  }

  function addTranslation() {
    const usedLocales = translations.map((t) => t.locale);
    const next = LOCALES.find((l) => !usedLocales.includes(l));
    if (next) {
      setTranslations((prev) => [
        ...prev,
        { locale: next, name: "", description: "" },
      ]);
    }
  }

  function removeTranslation(index: number) {
    if (translations.length > 1) {
      setTranslations((prev) => prev.filter((_, i) => i !== index));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const payload = {
      type: type || null,
      category: category || null,
      hasBoard,
      translations: translations.filter((t) => t.name.trim()),
    };

    const url = initialData
      ? `/api/admin/groups/${initialData.id}`
      : "/api/admin/groups";
    const method = initialData ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      router.push("/admin/groups");
      router.refresh();
    } else {
      alert("저장에 실패했습니다.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">타입</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2"
          >
            <option value="">선택 안 함</option>
            {GROUP_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">카테고리</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2"
          >
            <option value="">선택 안 함</option>
            {GROUP_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={hasBoard}
          onChange={(e) => setHasBoard(e.target.checked)}
        />
        게시판 활성화
      </label>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium">번역</label>
          {translations.length < LOCALES.length && (
            <button
              type="button"
              onClick={addTranslation}
              className="text-sm text-blue-600 hover:underline"
            >
              + 언어 추가
            </button>
          )}
        </div>
        <div className="space-y-3">
          {translations.map((tr, i) => (
            <div
              key={i}
              className="rounded border border-zinc-200 bg-white p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <select
                  value={tr.locale}
                  onChange={(e) => updateTranslation(i, "locale", e.target.value)}
                  className="rounded border border-zinc-300 px-2 py-1 text-sm"
                >
                  {LOCALES.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                {translations.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeTranslation(i)}
                    className="text-sm text-red-500 hover:underline"
                  >
                    삭제
                  </button>
                )}
              </div>
              <input
                placeholder="이름"
                value={tr.name}
                onChange={(e) => updateTranslation(i, "name", e.target.value)}
                className="mb-2 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
              />
              <textarea
                placeholder="설명 (선택)"
                value={tr.description}
                onChange={(e) =>
                  updateTranslation(i, "description", e.target.value)
                }
                rows={2}
                className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "저장 중..." : "저장"}
      </button>
    </form>
  );
}
