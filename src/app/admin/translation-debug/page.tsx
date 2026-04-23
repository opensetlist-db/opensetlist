"use client";

import { useState } from "react";

const LOCALES = ["ko", "ja", "en"] as const;
type Locale = (typeof LOCALES)[number];

type DebugResponse = {
  systemPrompt: string;
  input: string;
  raw: string;
  parsed: { ko: string; ja: string; en: string } | null;
  parseError: string | null;
  sourceLocale: Locale;
};

export default function TranslationDebugPage() {
  const [sourceLocale, setSourceLocale] = useState<Locale>("ko");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DebugResponse | null>(null);

  async function runTranslation() {
    // Clear prior output first so validation failures don't leave a stale
    // result on-screen — the debug tool is easy to misread otherwise.
    setResult(null);
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/translation-debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceLocale, text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `요청 실패 (${res.status})`);
        // Show the echoed prompt + input if the API returned them — useful
        // for confirming which prompt would have been sent.
        if (data.systemPrompt && data.input) {
          setResult({
            systemPrompt: data.systemPrompt,
            input: data.input,
            raw: "",
            parsed: null,
            parseError: null,
            sourceLocale: data.sourceLocale ?? sourceLocale,
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
        번역 캐시를 우회합니다. 매 요청마다 번역기 호출이 발생합니다.
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
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
        disabled={loading || !text.trim()}
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
          <SystemPromptBlock content={result.systemPrompt} />

          {result.parseError && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <div className="font-medium">JSON 파싱 실패</div>
              <div className="mt-1 font-mono text-xs">{result.parseError}</div>
            </div>
          )}

          <DebugBlock
            label="LLM 원본 출력"
            content={result.raw || "(번역기 호출 안됨)"}
          />

          {result.parsed && (
            <ParsedTable parsed={result.parsed} sourceLocale={result.sourceLocale} />
          )}
        </div>
      )}
    </div>
  );
}

function SystemPromptBlock({ content }: { content: string }) {
  const lineCount = content.split("\n").length;
  return (
    <details className="rounded border border-zinc-200 bg-zinc-50">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-zinc-700">
        시스템 프롬프트 (캐시되는 접두부, {lineCount}줄 / {content.length}자)
      </summary>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t border-zinc-200 bg-white p-3 font-mono text-xs">
        {content}
      </pre>
    </details>
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

function ParsedTable({
  parsed,
  sourceLocale,
}: {
  parsed: { ko: string; ja: string; en: string };
  sourceLocale: Locale;
}) {
  return (
    <div>
      <div className="mb-1 text-sm font-medium text-zinc-700">파싱된 출력</div>
      <table className="w-full border-collapse overflow-hidden rounded border border-zinc-200 text-sm">
        <tbody>
          {LOCALES.map((loc) => {
            const isSource = loc === sourceLocale;
            return (
              <tr
                key={loc}
                className={isSource ? "bg-zinc-100 text-zinc-500" : "bg-white"}
              >
                <td className="w-24 border-r border-zinc-200 px-3 py-2 align-top font-mono text-xs">
                  {loc}
                  {isSource && (
                    <span className="ml-1 rounded bg-zinc-300 px-1 text-[10px] text-zinc-700">
                      source
                    </span>
                  )}
                </td>
                <td
                  className={`whitespace-pre-wrap px-3 py-2 ${isSource ? "text-xs" : ""}`}
                >
                  {parsed[loc] || <span className="text-zinc-400">(빈 값)</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
