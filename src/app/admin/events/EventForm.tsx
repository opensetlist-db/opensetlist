"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Translation = { locale: string; name: string; shortName: string };

type EventFormProps = {
  initialData?: {
    id: number;
    type: string;
    status: string;
    eventSeriesId: number | null;
    date: string | null;
    country: string | null;
    posterUrl: string | null;
    startTime: string;
    translations: Translation[];
  };
};

const EVENT_TYPES = ["concert", "festival", "fan_meeting", "showcase", "virtual_live"];
const EVENT_STATUSES = ["scheduled", "ongoing", "completed", "cancelled"];
const LOCALES = ["ko", "ja", "en", "zh-CN"];

export default function EventForm({ initialData }: EventFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState(initialData?.type ?? "concert");
  const [status, setStatus] = useState(initialData?.status ?? "scheduled");
  const [eventSeriesId, setEventSeriesId] = useState(
    initialData?.eventSeriesId?.toString() ?? ""
  );
  const [date, setDate] = useState(initialData?.date ?? "");
  const [country, setCountry] = useState(initialData?.country ?? "");
  const [posterUrl, setPosterUrl] = useState(initialData?.posterUrl ?? "");
  const [startTime, setStartTime] = useState(initialData?.startTime ?? "");
  const [translations, setTranslations] = useState<Translation[]>(
    initialData?.translations.length
      ? initialData.translations
      : [{ locale: "ko", name: "", shortName: "" }]
  );

  const [seriesList, setSeriesList] = useState<
    { id: number; translations: { locale: string; name: string }[] }[]
  >([]);

  useEffect(() => {
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
      setTranslations((prev) => [...prev, { locale: next, name: "", shortName: "" }]);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!startTime) {
      alert("시작 시각은 필수입니다.");
      return;
    }

    setLoading(true);

    const payload = {
      type,
      status,
      eventSeriesId: eventSeriesId || null,
      date: date || null,
      country: country || null,
      posterUrl: posterUrl || null,
      startTime: `${startTime}Z`,
      translations: translations
        .filter((t) => t.name.trim())
        .map((t) => ({ locale: t.locale, name: t.name, shortName: t.shortName || null })),
    };

    const url = initialData
      ? `/api/admin/events/${initialData.id}`
      : "/api/admin/events";
    const method = initialData ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      router.push("/admin/events");
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
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">상태</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2"
          >
            {EVENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">시리즈</label>
        <select
          value={eventSeriesId}
          onChange={(e) => setEventSeriesId(e.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2"
        >
          <option value="">없음</option>
          {seriesList.map((s) => {
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

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">날짜</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">시작 시각 (UTC) *</label>
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
            className="w-full rounded border border-zinc-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">국가 코드</label>
          <input
            placeholder="JP"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-32 rounded border border-zinc-300 px-3 py-2"
            maxLength={2}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">포스터 URL (선택)</label>
        <input
          placeholder="https://..."
          value={posterUrl}
          onChange={(e) => setPosterUrl(e.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2"
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
              className="flex items-center gap-2 rounded border border-zinc-200 bg-white p-3"
            >
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
              <input
                placeholder="이벤트명"
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
              {translations.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setTranslations((prev) =>
                      prev.filter((_, j) => j !== i)
                    )
                  }
                  className="text-sm text-red-500"
                >
                  삭제
                </button>
              )}
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
