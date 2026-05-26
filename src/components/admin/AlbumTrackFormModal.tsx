"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SongSearch, type SongSearchResult } from "@/components/SongSearch";
import {
  PATTERN2_ALBUM_TRACK_VARIANTS,
  PATTERN3_ALBUM_TRACK_VARIANTS,
  ALBUM_TRACK_VARIANT_SUFFIX_KO,
} from "@/lib/albumTrackVariants";

export type TrackPattern = "vocal" | "off_vocal_w_parent" | "direct";

export type TrackInitial = {
  id?: string;
  albumId: string;
  pattern: TrackPattern;
  discNumber: number;
  trackNumber: number;
  // Pattern 1: songId set
  // Pattern 2: parentSongId + variant
  // Pattern 3: variant + title + titleLanguage + translations
  songId: number | null;
  parentSongId: number | null;
  variant: string | null;
  title: string | null;
  titleLanguage: string | null;
  translations: { locale: string; title: string }[];
  // Display-only label for the currently-selected vocal/parent song.
  // Populated by the parent (edit path); empty string when adding new.
  selectedSongLabel: string;
};

type Props = {
  albumId: string;
  initialData?: TrackInitial;
  onClose: () => void;
};

const LOCALES = ["ko", "ja", "en"];
const LANGUAGES = [
  { value: "ja", label: "일본어 (ja)" },
  { value: "en", label: "영어 (en)" },
  { value: "ko", label: "한국어 (ko)" },
];

// Korean labels for the live preview + variant select come from
// `ALBUM_TRACK_VARIANT_SUFFIX_KO` in `@/lib/albumTrackVariants` so
// the admin surface and the import-side allowlist stay in lockstep.
// Indexed lookups fall back to the raw variant string if a future
// schema change adds a value before this map catches up.

export default function AlbumTrackFormModal({
  albumId,
  initialData,
  onClose,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const [pattern, setPattern] = useState<TrackPattern>(
    initialData?.pattern ?? "vocal",
  );
  const [discNumber, setDiscNumber] = useState(initialData?.discNumber ?? 1);
  const [trackNumber, setTrackNumber] = useState(
    initialData?.trackNumber ?? 1,
  );

  // Pattern 1 / 2 — selected song. We hold a {id, label} pair because
  // SongSearch's onSelect fires with the full SongSearchResult; we
  // shrink it to id+label for display.
  const [songId, setSongId] = useState<number | null>(
    initialData?.songId ?? null,
  );
  const [songLabel, setSongLabel] = useState<string>(
    initialData?.selectedSongLabel ?? "",
  );
  const [parentSongId, setParentSongId] = useState<number | null>(
    initialData?.parentSongId ?? null,
  );
  const [parentLabel, setParentLabel] = useState<string>(
    initialData?.pattern === "off_vocal_w_parent"
      ? (initialData?.selectedSongLabel ?? "")
      : "",
  );

  // Pattern 2/3 variant — distinct allowlists per pattern.
  const [variant, setVariant] = useState<string>(
    initialData?.variant ??
      (pattern === "off_vocal_w_parent"
        ? PATTERN2_ALBUM_TRACK_VARIANTS[0]
        : pattern === "direct"
          ? PATTERN3_ALBUM_TRACK_VARIANTS[0]
          : ""),
  );

  // Pattern 3 fields
  const [title, setTitle] = useState(initialData?.title ?? "");
  const [titleLanguage, setTitleLanguage] = useState(
    initialData?.titleLanguage ?? "ja",
  );
  const [translations, setTranslations] = useState<
    { locale: string; title: string }[]
  >(initialData?.translations ?? []);

  function changePattern(next: TrackPattern) {
    setPattern(next);
    if (next === "off_vocal_w_parent") {
      setVariant(PATTERN2_ALBUM_TRACK_VARIANTS[0]);
      setSongId(null);
      setSongLabel("");
    } else if (next === "direct") {
      setVariant(PATTERN3_ALBUM_TRACK_VARIANTS[0]);
      setSongId(null);
      setSongLabel("");
      setParentSongId(null);
      setParentLabel("");
    } else {
      setVariant("");
      setParentSongId(null);
      setParentLabel("");
      setTitle("");
      setTranslations([]);
    }
  }

  function addTranslation() {
    const used = new Set(translations.map((t) => t.locale));
    const next = LOCALES.find((l) => !used.has(l));
    if (next) setTranslations((p) => [...p, { locale: next, title: "" }]);
  }

  function labelForSong(s: SongSearchResult): string {
    const tr = s.translations.find((t) => t.locale === "ko");
    return tr?.title ?? s.originalTitle;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    // Build a discriminated payload so the server can branch on
    // `pattern` rather than infer from field presence — cleaner
    // contract than the importer's heuristic dispatch.
    let payload: Record<string, unknown>;
    if (pattern === "vocal") {
      if (!songId) {
        alert("곡을 선택해 주세요.");
        setLoading(false);
        return;
      }
      payload = {
        albumId,
        pattern,
        discNumber,
        trackNumber,
        songId,
      };
    } else if (pattern === "off_vocal_w_parent") {
      if (!parentSongId) {
        alert("원곡 (보컬 부모)을 선택해 주세요.");
        setLoading(false);
        return;
      }
      payload = {
        albumId,
        pattern,
        discNumber,
        trackNumber,
        parentSongId,
        variant,
      };
    } else {
      if (!title.trim()) {
        alert("트랙 제목 (원어)을 입력해 주세요.");
        setLoading(false);
        return;
      }
      payload = {
        albumId,
        pattern,
        discNumber,
        trackNumber,
        variant,
        title: title.trim(),
        titleLanguage,
        translations: translations
          .map((t) => ({ locale: t.locale, title: t.title.trim() }))
          .filter((t) => t.title),
      };
    }

    const url = initialData?.id
      ? `/api/admin/album-tracks/${initialData.id}`
      : "/api/admin/album-tracks";
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

  // Preview for Pattern 2 — derived title in KO using the inline
  // variant suffix map (mirrors getAlbumTrackTitle's Pattern 2 path).
  const previewKo =
    pattern === "off_vocal_w_parent" && parentLabel && variant
      ? `${parentLabel} (${ALBUM_TRACK_VARIANT_SUFFIX_KO[variant as keyof typeof ALBUM_TRACK_VARIANT_SUFFIX_KO] ?? variant})`
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
      >
        <h2 className="mb-4 text-xl font-bold">
          {initialData?.id ? "수록곡 편집" : "새 수록곡"}
        </h2>

        <fieldset className="mb-4 space-y-2 rounded border border-zinc-200 p-3">
          <legend className="px-1 text-sm font-medium">패턴</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="pattern"
              value="vocal"
              checked={pattern === "vocal"}
              onChange={() => changePattern("vocal")}
            />
            <span>
              <strong>Vocal</strong> — 기존 Song에 연결 (세트리스트 대상)
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="pattern"
              value="off_vocal_w_parent"
              checked={pattern === "off_vocal_w_parent"}
              onChange={() => changePattern("off_vocal_w_parent")}
            />
            <span>
              <strong>오프 보컬 / 인스트루멘탈 / 가라오케</strong> — 같은
              앨범의 보컬 Song을 부모로
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="pattern"
              value="direct"
              checked={pattern === "direct"}
              onChange={() => changePattern("direct")}
            />
            <span>
              <strong>드라마 / BGM</strong> — Song 연결 없음 (제목 직접 입력)
            </span>
          </label>
        </fieldset>

        <div className="mb-4 grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">디스크 #</label>
            <input
              type="number"
              min={1}
              value={discNumber}
              onChange={(e) => setDiscNumber(Number(e.target.value))}
              className="w-full rounded border border-zinc-300 px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">트랙 #</label>
            <input
              type="number"
              min={1}
              value={trackNumber}
              onChange={(e) => setTrackNumber(Number(e.target.value))}
              className="w-full rounded border border-zinc-300 px-3 py-2"
              required
            />
          </div>
        </div>

        {pattern === "vocal" && (
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium">곡 검색</label>
            {songId && songLabel && (
              <div className="mb-2 flex items-center gap-2 rounded bg-blue-50 px-3 py-2 text-sm">
                <span className="flex-1">{songLabel}</span>
                <button
                  type="button"
                  onClick={() => {
                    setSongId(null);
                    setSongLabel("");
                  }}
                  className="text-xs text-red-500 hover:underline"
                >
                  변경
                </button>
              </div>
            )}
            {!songId && (
              <SongSearch
                locale="ko"
                includeVariants
                texts={{
                  placeholder: "곡 이름으로 검색",
                  loading: "검색 중...",
                  noResults: "결과 없음",
                }}
                onSelect={(s) => {
                  setSongId(s.id);
                  setSongLabel(labelForSong(s));
                }}
              />
            )}
          </div>
        )}

        {pattern === "off_vocal_w_parent" && (
          <>
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium">
                원곡 (보컬 부모)
              </label>
              {parentSongId && parentLabel && (
                <div className="mb-2 flex items-center gap-2 rounded bg-blue-50 px-3 py-2 text-sm">
                  <span className="flex-1">{parentLabel}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setParentSongId(null);
                      setParentLabel("");
                    }}
                    className="text-xs text-red-500 hover:underline"
                  >
                    변경
                  </button>
                </div>
              )}
              {!parentSongId && (
                <SongSearch
                  locale="ko"
                  includeVariants
                  texts={{
                    placeholder: "원곡(보컬) 이름으로 검색",
                    loading: "검색 중...",
                    noResults: "결과 없음",
                  }}
                  onSelect={(s) => {
                    setParentSongId(s.id);
                    setParentLabel(labelForSong(s));
                  }}
                />
              )}
            </div>
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium">변형</label>
              <select
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
                className="w-full rounded border border-zinc-300 px-3 py-2"
              >
                {PATTERN2_ALBUM_TRACK_VARIANTS.map((v) => (
                  <option key={v} value={v}>
                    {ALBUM_TRACK_VARIANT_SUFFIX_KO[v] ?? v}
                  </option>
                ))}
              </select>
            </div>
            {previewKo && (
              <div className="mb-4 rounded bg-zinc-50 px-3 py-2 text-sm">
                <span className="text-zinc-500">표시 미리보기 (KO):</span>{" "}
                <span className="font-medium">{previewKo}</span>
              </div>
            )}
          </>
        )}

        {pattern === "direct" && (
          <>
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium">변형</label>
              <select
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
                className="w-full rounded border border-zinc-300 px-3 py-2"
              >
                {PATTERN3_ALBUM_TRACK_VARIANTS.map((v) => (
                  <option key={v} value={v}>
                    {ALBUM_TRACK_VARIANT_SUFFIX_KO[v] ?? v}
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-4 grid grid-cols-[1fr_auto] gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  원어 제목
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  className="w-full rounded border border-zinc-300 px-3 py-2"
                  placeholder="예: ドラマパート — 第1話"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">원어</label>
                <select
                  value={titleLanguage}
                  onChange={(e) => setTitleLanguage(e.target.value)}
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
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">
                  로케일 별 제목 (선택)
                </label>
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
                      {LOCALES.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <input
                      placeholder="제목"
                      value={tr.title}
                      onChange={(e) =>
                        setTranslations((prev) =>
                          prev.map((t, j) =>
                            j === i ? { ...t, title: e.target.value } : t,
                          ),
                        )
                      }
                      className="rounded border border-zinc-300 px-2 py-1 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setTranslations((prev) =>
                          prev.filter((_, j) => j !== i),
                        )
                      }
                      className="text-sm text-red-500"
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

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
