"use client";

import { useState } from "react";

const IMPORT_TYPES = [
  {
    value: "artists",
    label: "1. 아티스트 (Artists)",
    columns: ["slug*", "type*", "parentArtist_slug", "ja_name", "ja_shortName", "ko_name", "ko_shortName"],
    note: "ja_name 또는 ko_name 최소 1개 필수",
  },
  {
    value: "members",
    label: "2. 멤버 (Members)",
    columns: ["character_slug*", "character_type", "ja_name", "ja_shortName", "ko_name", "ko_shortName", "color", "artist_slugs*", "va_ja_name", "va_ko_name", "startDate", "endDate", "note"],
    note: "ja/ko_name 최소 1개 필수 · artist_slugs: 공백 구분 · startDate/endDate: 유닛 소속 기간 · note: graduated 등",
  },
  {
    value: "albums",
    label: "3. 앨범 (Albums)",
    columns: ["slug*", "type*", "artist_slugs", "releaseDate", "ja_title*", "ko_title", "labelName"],
    note: "ja_title 또는 ko_title 최소 1개 필수 · type: single, album, ep, live_album, soundtrack · artist_slugs: 공백 구분 (스플릿 싱글: 여러 아티스트, 컴필레이션: 비워두기)",
  },
  {
    value: "songs",
    label: "4. 곡 (Songs)",
    columns: ["slug*", "originalTitle*", "originalLanguage", "artist_slugs", "releaseDate", "variantLabel", "baseVersion_slug", "ja_title", "ko_title", "sourceNote", "album_slug", "disc_number", "track_number"],
    note: "originalLanguage: ja(기본값), en, ko, zh 등 · artist_slugs: 공백 구분 (콜라보곡: 여러 아티스트) · album_slug + track_number: 앨범 트랙 연결 · disc_number: 멀티디스크 앨범용 (기본값 1)",
  },
  {
    value: "events",
    label: "5. 이벤트 (Events)",
    columns: ["series_slug", "series_ja_name", "series_ja_shortName", "series_ko_name", "series_ko_shortName", "series_type", "event_slug*", "parentEvent_slug", "event_type", "date", "country", "ja_name", "ja_shortName", "ja_city", "ja_venue", "ko_name", "ko_shortName", "ko_city", "ko_venue", "artist_slug", "event_performer_slugs", "event_guest_slugs"],
    note: "ja_name 또는 ko_name 최소 1개 필수 · event_performer_slugs: 공백 구분 정규 출연진 · event_guest_slugs: 공백 구분 게스트",
  },
  {
    value: "setlistitems",
    label: "6. 셋리스트 (SetlistItems)",
    columns: ["event_slug*", "position*", "song_slug", "isEncore", "itemType", "performanceType", "stageType", "artist_slugs", "unitName", "performer_slugs", "note", "status"],
    note: "artist_slugs: 공백 구분 artist slug · performer_slugs: 공백 구분 character slug (SI name 매칭) · 가져오기 시 해당 이벤트의 기존 셋리스트가 모두 삭제되고 새로 생성됩니다",
  },
];

export default function ImportPage() {
  const [selectedType, setSelectedType] = useState("artists");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ count: number; log: string[] } | null>(null);
  const [error, setError] = useState("");

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvText(ev.target?.result as string);
    };
    reader.readAsText(file, "utf-8");
  }

  async function handleImport() {
    if (!csvText.trim()) {
      setError("CSV 데이터가 없습니다.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    const res = await fetch("/api/admin/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: selectedType, csv: csvText }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "가져오기에 실패했습니다.");
    } else {
      setResult(data);
    }
  }

  const currentType = IMPORT_TYPES.find((t) => t.value === selectedType);

  return (
    <div className="max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold">CSV 가져오기</h1>

      <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        반드시 순서대로 가져오세요: 아티스트 → 멤버 → 앨범 → 곡 → 이벤트 → 셋리스트
      </div>

      {/* Type selector */}
      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium">데이터 유형</label>
        <select
          value={selectedType}
          onChange={(e) => {
            setSelectedType(e.target.value);
            setResult(null);
            setError("");
          }}
          className="w-full rounded border border-zinc-300 px-3 py-2"
        >
          {IMPORT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {currentType && (
          <div className="mt-2 text-xs">
            <p className="mb-1 font-mono text-zinc-600">
              {currentType.columns.map((col, i) => (
                <span key={col}>
                  {i > 0 && ", "}
                  {col.endsWith("*") ? (
                    <span className="font-semibold text-zinc-900">{col.slice(0, -1)}<span className="text-red-500">*</span></span>
                  ) : (
                    <span className="text-zinc-400">{col}</span>
                  )}
                </span>
              ))}
            </p>
            {"note" in currentType && currentType.note && (
              <p className="text-zinc-500">{currentType.note}</p>
            )}
          </div>
        )}
      </div>

      {/* File upload */}
      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium">CSV 파일</label>
        <input
          type="file"
          accept=".csv,.txt"
          onChange={handleFileUpload}
          className="block w-full text-sm text-zinc-500 file:mr-4 file:rounded file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
        />
        {fileName && (
          <p className="mt-1 text-xs text-zinc-500">{fileName}</p>
        )}
      </div>

      {/* Or paste CSV */}
      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium">
          또는 CSV 직접 입력
        </label>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          rows={10}
          placeholder="slug,type,ja_name,ko_name&#10;hasunosora,group,蓮ノ空女学院スクールアイドルクラブ,하스노소라"
          className="w-full rounded border border-zinc-300 px-3 py-2 font-mono text-sm"
        />
      </div>

      {/* Preview */}
      {csvText && (
        <div className="mb-4">
          <p className="text-xs text-zinc-500">
            {csvText.trim().split("\n").length - 1}행 감지됨
          </p>
        </div>
      )}

      {/* Import button */}
      <button
        onClick={handleImport}
        disabled={loading || !csvText.trim()}
        className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "가져오는 중..." : "가져오기"}
      </button>

      {/* Error */}
      {error && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="mt-4 rounded border border-green-200 bg-green-50 p-3">
          <p className="mb-2 font-medium text-green-800">
            {result.count}건 가져오기 완료
          </p>
          <pre className="max-h-60 overflow-y-auto text-xs text-green-700">
            {result.log.join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
}
