"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Translation = { locale: string; name: string; shortName: string; description: string };

type EventSeriesFormProps = {
  initialData?: {
    id: number;
    type: string;
    artistId: number | null;
    parentSeriesId: number | null;
    organizerName: string | null;
    hasBoard: boolean;
    originalName: string;
    originalShortName: string;
    originalDescription: string;
    originalLanguage: string;
    translations: Translation[];
  };
};

const SERIES_TYPES = ["concert_tour", "standalone", "festival", "fan_meeting"];
const LOCALES = ["ko", "ja", "en", "zh-CN"];
const ORIGINAL_LANGUAGES = ["ja", "ko", "en", "zh-CN"];

function normalizeSeriesType(value?: string) {
  return value === "one_time" ? "standalone" : value;
}

export default function EventSeriesForm({ initialData }: EventSeriesFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState(normalizeSeriesType(initialData?.type) ?? "concert_tour");
  const [artistId, setArtistId] = useState(
    initialData?.artistId?.toString() ?? ""
  );
  const [parentSeriesId, setParentSeriesId] = useState(
    initialData?.parentSeriesId?.toString() ?? ""
  );
  const [organizerName, setOrganizerName] = useState(
    initialData?.organizerName ?? ""
  );
  const [hasBoard, setHasBoard] = useState(initialData?.hasBoard ?? false);
  const [originalLanguage, setOriginalLanguage] = useState(
    initialData?.originalLanguage ?? "ja"
  );
  const [originalName, setOriginalName] = useState(initialData?.originalName ?? "");
  const [originalShortName, setOriginalShortName] = useState(
    initialData?.originalShortName ?? ""
  );
  const [originalDescription, setOriginalDescription] = useState(
    initialData?.originalDescription ?? ""
  );
  const [translations, setTranslations] = useState<Translation[]>(
    initialData?.translations.length
      ? initialData.translations
      : [{ locale: "ko", name: "", shortName: "", description: "" }]
  );

  const [artists, setArtists] = useState<
    { id: number; translations: { locale: string; name: string }[] }[]
  >([]);
  const [seriesList, setSeriesList] = useState<
    { id: number; translations: { locale: string; name: string }[] }[]
  >([]);

  useEffect(() => {
    fetch("/api/admin/artists")
      .then((r) => r.json())
      .then(setArtists);
    fetch("/api/admin/event-series")
      .then((r) => r.json())
      .then(setSeriesList);
  }, []);

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
        { locale: next, name: "", shortName: "", description: "" },
      ]);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!originalName.trim()) {
      alert("원본 이름(originalName)은 필수입니다.");
      return;
    }

    setLoading(true);

    const payload = {
      type,
      artistId: artistId || null,
      parentSeriesId: parentSeriesId || null,
      organizerName: organizerName || null,
      hasBoard,
      originalName: originalName.trim(),
      originalShortName: originalShortName.trim() || null,
      originalDescription: originalDescription.trim() || null,
      originalLanguage,
      translations: translations
        .filter((t) => t.name.trim())
        .map((t) => ({ locale: t.locale, name: t.name, shortName: t.shortName || null, description: t.description || null })),
    };

    const url = initialData
      ? `/api/admin/event-series/${initialData.id}`
      : "/api/admin/event-series";
    const method = initialData ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      router.push("/admin/event-series");
      router.refresh();
    } else {
      alert("저장에 실패했습니다.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-6">
      <div>
        <label className="mb-1 block text-sm font-medium">타입</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2"
        >
          {SERIES_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">아티스트</label>
          <select
            value={artistId}
            onChange={(e) => setArtistId(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2"
          >
            <option value="">없음 (페스티벌 등)</option>
            {artists.map((a) => {
              const name =
                a.translations.find((t) => t.locale === "ko")?.name ??
                a.translations[0]?.name ??
                `ID: ${a.id}`;
              return (
                <option key={a.id} value={a.id}>
                  {name}
                </option>
              );
            })}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">
            상위 시리즈
          </label>
          <select
            value={parentSeriesId}
            onChange={(e) => setParentSeriesId(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2"
          >
            <option value="">없음</option>
            {seriesList
              .filter((s) => s.id !== initialData?.id)
              .map((s) => {
                const name =
                  s.translations.find((t) => t.locale === "ko")?.name ??
                  s.translations[0]?.name ??
                  `ID: ${s.id}`;
                return (
                  <option key={s.id} value={s.id}>
                    {name}
                  </option>
                );
              })}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">
          주최 (아티스트 없는 경우)
        </label>
        <input
          placeholder="Bandai Namco / Lantis"
          value={organizerName}
          onChange={(e) => setOrganizerName(e.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={hasBoard}
          onChange={(e) => setHasBoard(e.target.checked)}
        />
        게시판 활성화
      </label>

      <div className="rounded border border-zinc-300 bg-zinc-50 p-4">
        <div className="mb-3 text-sm font-medium">
          원본 (다른 언어 번역이 없을 때 표시)
        </div>
        <div className="mb-3">
          <label className="mb-1 block text-xs text-zinc-600">원본 언어</label>
          <select
            value={originalLanguage}
            onChange={(e) => setOriginalLanguage(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          >
            {ORIGINAL_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <input
          placeholder="원본 이름 (필수)"
          value={originalName}
          onChange={(e) => setOriginalName(e.target.value)}
          className="mb-2 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          required
        />
        <input
          placeholder="원본 약칭 (선택)"
          value={originalShortName}
          onChange={(e) => setOriginalShortName(e.target.value)}
          className="mb-2 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
        />
        <textarea
          placeholder="원본 설명 (선택)"
          value={originalDescription}
          onChange={(e) => setOriginalDescription(e.target.value)}
          rows={2}
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>

      {/* Translations */}
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
                  onChange={(e) =>
                    updateTranslation(i, "locale", e.target.value)
                  }
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
                    onClick={() =>
                      setTranslations((prev) =>
                        prev.filter((_, j) => j !== i)
                      )
                    }
                    className="text-sm text-red-500 hover:underline"
                  >
                    삭제
                  </button>
                )}
              </div>
              <div className="mb-2 flex gap-2">
                <input
                  placeholder="이름"
                  value={tr.name}
                  onChange={(e) => updateTranslation(i, "name", e.target.value)}
                  className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm"
                />
                <input
                  placeholder="약칭"
                  value={tr.shortName}
                  onChange={(e) => updateTranslation(i, "shortName", e.target.value)}
                  className="w-28 rounded border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>
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
