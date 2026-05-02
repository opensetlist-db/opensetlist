"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Translation = { locale: string; title: string };
type ArtistCredit = { artistId: number; role: string; artistName?: string };

type SongFormProps = {
  initialData?: {
    id: number;
    originalTitle: string;
    originalLanguage: string;
    variantLabel: string | null;
    sourceNote: string | null;
    releaseDate: string | null;
    baseVersionId: number | null;
    translations: Translation[];
    artistCredits: ArtistCredit[];
  };
};

const LOCALES = ["ko", "ja", "en", "zh-CN"];
const LANGUAGES = [
  { value: "ja", label: "일본어 (ja)" },
  { value: "en", label: "영어 (en)" },
  { value: "ko", label: "한국어 (ko)" },
  { value: "zh", label: "중국어 (zh)" },
];
const ROLES = ["primary", "featured", "cover"];

export default function SongForm({ initialData }: SongFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [originalTitle, setOriginalTitle] = useState(
    initialData?.originalTitle ?? ""
  );
  const [originalLanguage, setOriginalLanguage] = useState(
    initialData?.originalLanguage ?? "ja"
  );
  const [variantLabel, setVariantLabel] = useState(
    initialData?.variantLabel ?? ""
  );
  const [sourceNote, setSourceNote] = useState(
    initialData?.sourceNote ?? ""
  );
  const [releaseDate, setReleaseDate] = useState(
    initialData?.releaseDate ?? ""
  );
  const [baseVersionId, setBaseVersionId] = useState(
    initialData?.baseVersionId?.toString() ?? ""
  );
  const [translations, setTranslations] = useState<Translation[]>(
    initialData?.translations.length
      ? initialData.translations
      : [{ locale: "ko", title: "" }]
  );
  const [artistCredits, setArtistCredits] = useState<ArtistCredit[]>(
    initialData?.artistCredits ?? []
  );

  const [artists, setArtists] = useState<
    { id: number; translations: { locale: string; name: string }[] }[]
  >([]);

  useEffect(() => {
    fetch("/api/admin/artists")
      .then((r) => r.json())
      .then(setArtists);
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
      setTranslations((prev) => [...prev, { locale: next, title: "" }]);
    }
  }

  function addArtistCredit() {
    if (artists.length > 0) {
      setArtistCredits((prev) => [
        ...prev,
        { artistId: artists[0].id, role: "primary" },
      ]);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const payload = {
      originalTitle,
      originalLanguage,
      variantLabel: variantLabel || null,
      sourceNote: sourceNote || null,
      releaseDate: releaseDate || null,
      baseVersionId: baseVersionId || null,
      translations: translations.filter((t) => t.title.trim()),
      artistCredits,
    };

    const url = initialData
      ? `/api/admin/songs/${initialData.id}`
      : "/api/admin/songs";
    const method = initialData ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        router.push("/admin/songs");
        router.refresh();
        return;
      }

      // Surface the API's `error` field (e.g. slug collision message)
      // instead of bouncing every failure through the same generic
      // alert and forcing the operator to dig in Sentry.
      const body = await res.json().catch(() => null);
      alert(body?.error ?? "저장에 실패했습니다.");
    } catch {
      // Network error / fetch reject — without this the submit button
      // stays locked until refresh because setLoading(false) lived on
      // the !res.ok branch only.
      alert("저장에 실패했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      <div className="grid grid-cols-[1fr_auto] gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">원제</label>
          <input
            value={originalTitle}
            onChange={(e) => setOriginalTitle(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2"
            required
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
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">
            버전 라벨 (선택)
          </label>
          <input
            placeholder="SAKURA Ver."
            value={variantLabel}
            onChange={(e) => setVariantLabel(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">
            발매일 (선택)
          </label>
          <input
            type="date"
            value={releaseDate}
            onChange={(e) => setReleaseDate(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">
            원곡 ID (버전인 경우)
          </label>
          <input
            placeholder="원곡 Song ID"
            value={baseVersionId}
            onChange={(e) => setBaseVersionId(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">
            출처 (선택)
          </label>
          <input
            placeholder="예: 러브라이브! 하스노소라 여학원 스쿨 아이돌 클럽"
            value={sourceNote}
            onChange={(e) => setSourceNote(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2"
          />
        </div>
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
                onChange={(e) => updateTranslation(i, "locale", e.target.value)}
                className="rounded border border-zinc-300 px-2 py-1 text-sm"
              >
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <input
                placeholder="제목"
                value={tr.title}
                onChange={(e) => updateTranslation(i, "title", e.target.value)}
                className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm"
              />
              {translations.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setTranslations((prev) => prev.filter((_, j) => j !== i))
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

      {/* Artist Credits */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium">아티스트</label>
          <button
            type="button"
            onClick={addArtistCredit}
            className="text-sm text-blue-600 hover:underline"
          >
            + 아티스트 추가
          </button>
        </div>
        <div className="space-y-2">
          {artistCredits.map((ac, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={ac.artistId}
                onChange={(e) =>
                  setArtistCredits((prev) =>
                    prev.map((c, j) =>
                      j === i
                        ? { ...c, artistId: Number(e.target.value) }
                        : c
                    )
                  )
                }
                className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm"
              >
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
              <select
                value={ac.role}
                onChange={(e) =>
                  setArtistCredits((prev) =>
                    prev.map((c, j) =>
                      j === i ? { ...c, role: e.target.value } : c
                    )
                  )
                }
                className="rounded border border-zinc-300 px-2 py-2 text-sm"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  setArtistCredits((prev) => prev.filter((_, j) => j !== i))
                }
                className="text-sm text-red-500"
              >
                삭제
              </button>
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
