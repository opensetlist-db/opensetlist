"use client";

import { useState } from "react";

const LOCALES = ["ko", "ja", "en"] as const;
type Locale = (typeof LOCALES)[number];

type DebugResponse = {
  pairs: { source: string; target: string }[];
  processed: string;
  rawTranslation: string;
  restored: string;
};

export default function TranslationDebugPage() {
  const [eventId, setEventId] = useState("");
  const [sourceLocale, setSourceLocale] = useState<Locale>("ko");
  const [targetLocale, setTargetLocale] = useState<Locale>("ja");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DebugResponse | null>(null);

  async function runTranslation() {
    // Clear prior output first so validation failures don't leave a stale
    // result on-screen — the debug tool is easy to misread otherwise.
    setResult(null);
    if (!eventId.trim() || !/^\d+$/.test(eventId.trim())) {
      setError("이벤트 ID는 숫자여야 합니다.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/translation-debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: eventId.trim(),
          sourceLocale,
          targetLocale,
          text,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `요청 실패 (${res.status})`);
        // Even on error, show partial result if the API returned pairs/processed
        if (data.pairs && data.processed) {
          setResult({
            pairs: data.pairs,
            processed: data.processed,
            rawTranslation: "",
            restored: "",
          });
        }
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(`네트워크 오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 text-2xl font-bold">번역 디버그</h1>

      <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        글로서리 캐시 + 번역 캐시 모두 우회. 매 요청마다 DB 읽기 + 번역기 호출이 발생합니다.
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <div>
          <label htmlFor="td-event-id" className="mb-1 block text-sm font-medium">
            이벤트 ID
          </label>
          <input
            id="td-event-id"
            type="text"
            inputMode="numeric"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            placeholder="예: 42"
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="td-source-locale" className="mb-1 block text-sm font-medium">
            원본 로케일
          </label>
          <select
            id="td-source-locale"
            value={sourceLocale}
            onChange={(e) => setSourceLocale(e.target.value as Locale)}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="td-target-locale" className="mb-1 block text-sm font-medium">
            대상 로케일
          </label>
          <select
            id="td-target-locale"
            value={targetLocale}
            onChange={(e) => setTargetLocale(e.target.value as Locale)}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-4">
        <label htmlFor="td-source-text" className="mb-1 block text-sm font-medium">
          원본 텍스트
        </label>
        <textarea
          id="td-source-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="번역할 텍스트를 입력하세요"
          className="w-full rounded border border-zinc-300 px-3 py-2 font-mono text-sm"
        />
      </div>

      <button
        onClick={runTranslation}
        disabled={loading || !eventId.trim() || !text.trim()}
        className="mb-6 rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "처리 중..." : "번역 실행"}
      </button>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <DebugBlock
            label={`글로서리 (${result.pairs.length}건, ${sourceLocale} → ${targetLocale})`}
            content={
              result.pairs.length === 0
                ? "(빈 글로서리)"
                : result.pairs
                    .map((p) => `${p.source}  →  ${p.target}`)
                    .join("\n")
            }
          />
          <DebugBlock
            label="치환된 입력 (LLM에 전달)"
            content={result.processed}
          />
          <DebugBlock
            label="LLM 원본 출력 (플레이스홀더 포함)"
            content={result.rawTranslation || "(번역기 호출 안됨)"}
          />
          <DebugBlock label="복원된 최종 텍스트" content={result.restored} />
        </div>
      )}
    </div>
  );
}

function DebugBlock({ label, content }: { label: string; content: string }) {
  return (
    <div>
      <div className="mb-1 text-sm font-medium text-zinc-700">{label}</div>
      <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs">
        {content}
      </pre>
    </div>
  );
}
