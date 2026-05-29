"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CreateJobClient() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [albumId, setAlbumId] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let candidates: unknown;
    try {
      candidates = JSON.parse(text);
    } catch {
      setError("candidates JSON 파싱 실패 — 형식을 확인하세요.");
      return;
    }

    setSubmitting(true);
    try {
      const resp = await fetch("/api/admin/album-bonuses/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          candidates,
          albumId: albumId.trim() || undefined,
          sourceUrl: sourceUrl.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `요청 실패 (HTTP ${resp.status})`);
        setSubmitting(false);
        return;
      }
      const { job } = (await resp.json()) as { job: { id: string } };
      router.push(`/admin/album-bonuses/import-review/${job.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청 실패");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder='{ "listings": [ … ], "warnings": [ … ], … }'
        className="w-full rounded border border-zinc-300 px-2 py-1 font-mono text-xs"
        required
      />
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <input
          type="text"
          inputMode="numeric"
          value={albumId}
          onChange={(e) => setAlbumId(e.target.value)}
          placeholder="앨범 ID (선택)"
          className="rounded border border-zinc-300 px-2 py-1 text-sm"
        />
        <input
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="소스 URL (公式 뉴스, 선택)"
          className="rounded border border-zinc-300 px-2 py-1 text-sm"
        />
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="메모 (선택)"
          className="rounded border border-zinc-300 px-2 py-1 text-sm"
        />
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <button
        type="submit"
        disabled={submitting || !text.trim()}
        className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitting ? "생성 중…" : "검토 큐에 추가"}
      </button>
    </form>
  );
}
