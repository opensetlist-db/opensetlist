"use client";

import { useState } from "react";

export default function SlugGeneratorPage() {
  const [input, setInput] = useState("");
  const [prefix, setPrefix] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{ original: string; slug: string }[]>(
    []
  );

  async function handleGenerate() {
    const names = input
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (names.length === 0) return;

    setLoading(true);
    const res = await fetch("/api/admin/slug-generator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names, prefix: prefix.trim() || undefined }),
    });
    const data = await res.json();
    setResults(data);
    setLoading(false);
  }

  function handleCopy() {
    const text = results.map((r) => r.slug).join("\n");
    navigator.clipboard.writeText(text);
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold">Slug 생성기</h1>

      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium">
          접두사 (선택)
        </label>
        <input
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          placeholder="hasunosora"
          className="w-64 rounded border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium">
          이름 (한 줄에 하나씩)
        </label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={10}
          placeholder={"Dream Believers\nハナムスビ\n永遠のEuphoria"}
          className="w-full rounded border border-zinc-300 px-3 py-2 font-mono text-sm"
        />
      </div>

      <button
        onClick={handleGenerate}
        disabled={loading || !input.trim()}
        className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "생성 중..." : "생성"}
      </button>

      {results.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">{results.length}개 생성됨</p>
            <button
              onClick={handleCopy}
              className="text-sm text-blue-600 hover:underline"
            >
              slug만 복사
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left">
                <th className="py-2 pr-4">입력</th>
                <th className="py-2">slug</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className="border-b border-zinc-100">
                  <td className="py-1.5 pr-4 text-zinc-500">{r.original}</td>
                  <td className="py-1.5 font-mono">{r.slug}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
