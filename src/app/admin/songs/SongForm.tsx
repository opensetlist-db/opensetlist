"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { locales } from "@/i18n/routing";
import { songNameError, songNameSnapshot, type SongTranslationEdit } from "@/lib/admin/songNames";
import {
  fetchAdminArtists,
  UnlistedArtistOption,
} from "@/components/admin/artistPicker";

type Translation = { locale: string; title: string; variantLabel?: string | null };
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

const LOCALES = [...locales, "zh-CN"];
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
  const [reviewedNames, setReviewedNames] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
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
  const [translations, setTranslations] = useState<Translation[]>(() =>
    [...new Set([...LOCALES, ...(initialData?.translations.map((row) => row.locale) ?? [])])]
      .map((locale) => initialData?.translations.find((row) => row.locale === locale) ?? { locale, title: "" }),
  );
  const [artistCredits, setArtistCredits] = useState<ArtistCredit[]>(
    initialData?.artistCredits ?? []
  );

  const [artists, setArtists] = useState<
    { id: number; translations: { locale: string; name: string }[] }[]
  >([]);

  useEffect(() => {
    fetchAdminArtists<(typeof artists)[number]>().then(setArtists);
  }, []);

  function updateTranslation(
    index: number,
    field: "title" | "variantLabel",
    value: string
  ) {
    setTranslations((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t))
    );
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
    setSaveError(null);
    const originalVariant = variantLabel === (initialData?.variantLabel ?? "")
      ? initialData?.variantLabel ?? null
      : variantLabel.trim() ? variantLabel : null;
    const languageChanged = originalLanguage !== initialData?.originalLanguage;
    const titleChanged = languageChanged || originalTitle !== initialData?.originalTitle;
    const variantChanged = languageChanged || originalVariant !== initialData?.variantLabel;
    const translationRows = translations.map((row) => {
      const saved = initialData?.translations.find((item) => item.locale === row.locale);
      return {
        ...row,
        title: row.title === saved?.title || row.title.trim() ? row.title : "",
        variantLabel: row.variantLabel === saved?.variantLabel || row.variantLabel?.trim()
          ? row.variantLabel ?? null : null,
      };
    });
    const edits = translationRows.flatMap((row): SongTranslationEdit[] => {
      const saved = initialData?.translations.find((item) => item.locale === row.locale);
      const title = row.title !== (saved?.title ?? "") ||
        (row.title.trim() && (titleChanged || (reviewedNames && row.title === originalTitle)))
        ? row.title : undefined;
      const variantLabel = row.variantLabel !== (saved?.variantLabel ?? null) ||
        (row.variantLabel?.trim() && (variantChanged || (reviewedNames && row.variantLabel === originalVariant)))
        ? row.variantLabel : undefined;
      return title !== undefined || variantLabel !== undefined ? [{ locale: row.locale, title, variantLabel }] : [];
    });
    const error = songNameError(
      { originalTitle, originalLanguage, variantLabel: originalVariant, translations: translationRows },
      edits, reviewedNames, initialData,
    );
    if (error) {
      setSaveError(error);
      return;
    }

    const payload = {
      originalTitle: originalTitle !== initialData?.originalTitle ? originalTitle : undefined,
      originalLanguage: languageChanged ? originalLanguage : undefined,
      variantLabel: originalVariant !== initialData?.variantLabel ? originalVariant : undefined,
      sourceNote: sourceNote !== (initialData?.sourceNote ?? "") ? sourceNote || null : undefined,
      releaseDate: releaseDate !== (initialData?.releaseDate ?? "") ? releaseDate || null : undefined,
      baseVersionId: baseVersionId !== (initialData?.baseVersionId?.toString() ?? "") ? baseVersionId || null : undefined,
      translations: edits,
      artistCredits: artistCredits !== initialData?.artistCredits ? artistCredits : undefined,
      reviewedNames,
      expectedNames: initialData && (titleChanged || variantChanged || edits.length > 0)
        ? songNameSnapshot(initialData) : undefined,
    };

    const url = initialData
      ? `/api/admin/songs/${initialData.id}`
      : "/api/admin/songs";
    const method = initialData ? "PUT" : "POST";

    setLoading(true);
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
      // message and forcing the operator to dig in Sentry.
      const body = await res.json().catch(() => null);
      setSaveError(body?.error ?? "저장에 실패했습니다.");
    } catch {
      // Network error / fetch reject — without this the submit button
      // stays locked until refresh because setLoading(false) lived on
      // the !res.ok branch only.
      setSaveError("저장에 실패했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      onChange={(event) => {
        setSaveError(null);
        if (!(event.target instanceof HTMLInputElement) || event.target.name !== "reviewedNames") {
          setReviewedNames(false);
        }
      }}
      className="max-w-2xl space-y-6"
    >
      <div className="grid grid-cols-[1fr_auto] gap-4">
        <div>
          <label htmlFor="song-original-title" className="mb-1 block text-sm font-medium">원제</label>
          <input
            id="song-original-title"
            value={originalTitle}
            onChange={(e) => setOriginalTitle(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2"
            required
          />
        </div>
        <div>
          <label htmlFor="song-original-language" className="mb-1 block text-sm font-medium">원어</label>
          <select
            id="song-original-language"
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
          <label htmlFor="song-variant-label" className="mb-1 block text-sm font-medium">
            버전 라벨 (선택)
          </label>
          <input
            id="song-variant-label"
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

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">언어별 표기</legend>
        <p className="text-sm text-zinc-600">
          공개 언어의 통용 표기를 입력해 주세요. 로마자·숫자 제목은 제외됩니다.
          버전 라벨에 인물명이 있으면 검수된 인물 표기를 재사용해 주세요.
        </p>
        <div className="space-y-3">
          {translations.map((tr, i) => (
            <div
              key={tr.locale}
              className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded border border-zinc-200 bg-white p-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]"
            >
              <span className="row-span-2 text-sm sm:row-span-1">{tr.locale}</span>
              <input
                placeholder="제목"
                aria-label={`${tr.locale} 제목`}
                value={tr.title}
                onChange={(e) => updateTranslation(i, "title", e.target.value)}
                className="min-w-0 rounded border border-zinc-300 px-3 py-2 text-sm"
              />
              <input
                placeholder="버전 라벨"
                aria-label={`${tr.locale} 버전 라벨`}
                value={tr.variantLabel ?? ""}
                onChange={(e) => updateTranslation(i, "variantLabel", e.target.value)}
                className="min-w-0 rounded border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="reviewedNames"
            checked={reviewedNames}
            onChange={(event) => setReviewedNames(event.target.checked)}
          />
          원문과 같은 표기 및 원문 변경 후의 언어별 표기를 출처와 대조했습니다.
        </label>
      </fieldset>

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
                <UnlistedArtistOption
                  value={ac.artistId}
                  options={artists}
                  label={ac.artistName}
                />
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

      {saveError && <p role="alert" className="text-sm text-red-700">{saveError}</p>}
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
